import { db, auth } from "./firebase";
import { collection, getDocs, addDoc, serverTimestamp, doc, getDoc, query, where } from "firebase/firestore";
import { invalidateCache } from "./analyticsService";
import { sendCriticalAlertEmail } from "./resend";

/* Helper to scope a root-collection fetch to the current school. EVERY
   getDocs in this file MUST go through this — without the schoolId filter,
   Owner sees students/attendance/scores from EVERY school in the database
   (depends on Firestore rules to block, which is too brittle for privacy). */
function scopedDocs(collName: string, uid: string) {
  return getDocs(query(collection(db, collName), where("schoolId", "==", uid)))
    .catch(() => ({ docs: [] as any[] }));
}

/* ────────────────────────────────────────────────────────────────────────
   Module-level snapshot cache.

   Why: the previous `fetchRisksOverview` re-fetched 7 collections + the
   school settings doc + the branches subcollection on EVERY call, including
   every time the Owner toggled the branch dropdown. Branch switch is a pure
   filter operation, but it was paying a 1-2s Firestore round-trip each time.

   Now: raw fetches cached at module level for 5 minutes, keyed by uid.
   Branch switch reuses the cache and re-runs only the in-memory filter +
   compute (instant). resolveAlert calls invalidateRisksCache to ensure the
   next read picks up the fresh resolution. uid mismatch invalidates the
   cache (covers user switching in same SPA tab).
   ──────────────────────────────────────────────────────────────────────── */
type RisksRawSnapshot = {
  uid: string;
  ts:  number;
  thresholds: { attendanceCritical: number; attendanceWarning: number };
  schoolEmail: string;
  schoolOwnerName: string;
  schoolName: string;
  notifCriticalAlerts: boolean;
  branches: { id: string; name: string }[];
  branchesSnap: { docs: any[] };
  anyIdToCanonical: Map<string, string>;
  testScoresSnap:  { docs: any[] };
  attendanceSnap:  { docs: any[] };
  incidentsSnap:   { docs: any[] };
  studentsSnap:    { docs: any[] };
  teachersSnap:    { docs: any[] };
  enrollmentsSnap: { docs: any[] };
};

const RISKS_CACHE_TTL_MS = 5 * 60 * 1000;
let risksCache: RisksRawSnapshot | null = null;

export function invalidateRisksCache(): void {
  risksCache = null;
}

async function loadRisksSnapshot(uid: string): Promise<RisksRawSnapshot> {
  if (risksCache && risksCache.uid === uid && Date.now() - risksCache.ts < RISKS_CACHE_TTL_MS) {
    return risksCache;
  }

  // School settings: thresholds + notification prefs
  let thresholds = { attendanceCritical: 65, attendanceWarning: 80 };
  let schoolEmail = "";
  let schoolOwnerName = "";
  let schoolName = "";
  let notifCriticalAlerts = true;
  try {
    const schoolSnap = await getDoc(doc(db, "schools", uid));
    if (schoolSnap.exists()) {
      const sd = schoolSnap.data();
      if (sd.thresholds) thresholds = { ...thresholds, ...sd.thresholds };
      schoolEmail         = sd.email       || "";
      schoolOwnerName     = sd.ownerName   || "Owner";
      schoolName          = sd.schoolName  || "School";
      notifCriticalAlerts = sd.notifications?.criticalAlerts ?? true;
    }
  } catch { /* defaults */ }

  // Branches subcollection
  const branchesSnap = await getDocs(collection(db, "schools", uid, "branches"));
  const branches = branchesSnap.docs.map(d => ({
    id:   d.data().branchId || d.id,
    name: d.data().name || d.data().schoolName || "Branch",
  }));

  const anyIdToCanonical = new Map<string, string>();
  branchesSnap.docs.forEach(d => {
    const canonical = d.data().branchId || d.id;
    [d.id, d.data().branchId, d.data().schoolId, d.data().uid]
      .filter(Boolean)
      .forEach((v: string) => anyIdToCanonical.set(v, canonical));
  });

  // Parallel fetch of every needed root collection — single round-trip.
  const [testScoresSnap, attendanceSnap, incidentsSnap, studentsSnap, teachersSnap, enrollmentsSnap] = await Promise.all([
    scopedDocs("test_scores",  uid),
    scopedDocs("attendance",   uid),
    scopedDocs("incidents",    uid),
    scopedDocs("students",     uid),
    scopedDocs("teachers",     uid),
    scopedDocs("enrollments",  uid),
  ]);

  const snapshot: RisksRawSnapshot = {
    uid,
    ts: Date.now(),
    thresholds,
    schoolEmail, schoolOwnerName, schoolName, notifCriticalAlerts,
    branches,
    branchesSnap: { docs: branchesSnap.docs },
    anyIdToCanonical,
    testScoresSnap, attendanceSnap, incidentsSnap, studentsSnap, teachersSnap, enrollmentsSnap,
  };
  risksCache = snapshot;
  return snapshot;
}

export type RiskStat = {
  label: string;
  value: string;
  change: string;
  col: string;
};

export type AlertItem = {
  id: string;
  title: string;
  status: string;
  desc: string;
  type: 'critical' | 'warning' | 'info';
  branchId?: string;
  branchName?: string;
  timing?: string;          // e.g. "Started 5 days ago"
  studentCount?: number;    // affected students count
  totalStudents?: number;   // total students in branch
  attendancePct?: number;   // current attendance %
};

export type RiskMappingIssue = {
  unmapped: number;
  total: number;
  fallbackTriggered: boolean;
};

export type RisksData = {
  stats: RiskStat[];
  distribution: { name: string; value: number; fill: string }[];
  trend: { name: string; critical: number; warning: number }[];
  branchRisks: { name: string; value: number; color: string }[];
  alerts: AlertItem[];
  /* Surfaces broken student→branch attribution so the Owner sees a banner
     instead of silently-skewed risk counts. Mirrors the analyticsService
     mappingIssue pattern used in BranchesComparison. */
  mappingIssue: RiskMappingIssue | null;
};

export async function fetchRisksOverview(selectedBranchId: string = "all"): Promise<RisksData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("User not authenticated");

  /* Load (or reuse cached) raw snapshot. First call pays the 7-collection
     round-trip; subsequent calls within 5 min reuse the cache and run only
     the in-memory filter + compute below — branch switch becomes instant. */
  const snap = await loadRisksSnapshot(uid);
  const {
    thresholds, schoolEmail, schoolOwnerName, schoolName, notifCriticalAlerts,
    branches, anyIdToCanonical,
    testScoresSnap, attendanceSnap, incidentsSnap, studentsSnap, teachersSnap, enrollmentsSnap,
  } = snap;

  /* Cross-page cache coordination: analyticsService caches the same kinds of
     raw data for branchesService. When risks data is stale enough that we
     re-fetched (cache miss above), it's likely the analytics cache is stale
     too — bust it so BranchesComparison sees fresh numbers on its next render. */
  invalidateCache(`core:${uid}`);

  const resolveCanonical = (s: any): string => {
    for (const key of ["branchId", "schoolId", "school_id", "uid"]) {
      const v = s[key];
      if (v && anyIdToCanonical.has(v)) return anyIdToCanonical.get(v)!;
    }
    return s.branchId || s.schoolId || s.school_id || "";
  };

  const targetSet = selectedBranchId === "all"
    ? new Set(branches.map(b => b.id))
    : new Set([selectedBranchId]);

  // Build teacher→branch map — CRITICAL: also try teacher doc ID (auth uid)
  const teacherBranchMap = new Map<string, string>();
  (teachersSnap.docs as any[]).forEach(d => {
    const t = d.data();
    let cid = resolveCanonical(t);
    // Teacher's doc ID (auth uid) may directly match a branch's `uid` field
    if (!cid) cid = anyIdToCanonical.get(d.id) || "";
    // Also try teacher.uid field if present
    if (!cid && t.uid) cid = anyIdToCanonical.get(t.uid) || "";
    if (cid) teacherBranchMap.set(d.id, cid);
  });

  // Build student→branch via enrollments → teacher → branch
  const studentBranchViaEnrollment = new Map<string, string>();
  (enrollmentsSnap.docs as any[]).forEach(d => {
    const e = d.data();
    const sid = e.studentId as string;
    const tid = e.teacherId as string;
    if (!sid || studentBranchViaEnrollment.has(sid)) return;
    const cid = teacherBranchMap.get(tid);
    if (cid) studentBranchViaEnrollment.set(sid, cid);
  });

  // Build attendance & test-scores index keyed by studentId for O(1) lookup
  const attByStudent = new Map<string, any[]>();
  const resByStudent = new Map<string, any[]>();
  const incByStudent = new Map<string, any[]>();
  (attendanceSnap.docs as any[]).forEach(d => {
    const sid = d.data().studentId;
    if (!sid) return;
    if (!attByStudent.has(sid)) attByStudent.set(sid, []);
    attByStudent.get(sid)!.push(d.data());
  });
  (testScoresSnap.docs as any[]).forEach(d => {
    const sid = d.data().studentId;
    if (!sid) return;
    if (!resByStudent.has(sid)) resByStudent.set(sid, []);
    resByStudent.get(sid)!.push(d.data());
  });
  (incidentsSnap.docs as any[]).forEach(d => {
    const sid = d.data().studentId;
    if (!sid) return;
    if (!incByStudent.has(sid)) incByStudent.set(sid, []);
    incByStudent.get(sid)!.push(d.data());
  });

  // Index students — try direct → enrollment chain → doc ID
  const studentMap = new Map<string, any>();
  (studentsSnap.docs as any[]).forEach(d => {
    const s = d.data();
    let cid = resolveCanonical(s);
    if (!targetSet.has(cid)) cid = studentBranchViaEnrollment.get(d.id) || "";
    if (!targetSet.has(cid)) cid = anyIdToCanonical.get(d.id) || "";
    if (!cid || !targetSet.has(cid)) return;
    studentMap.set(d.id, { ...s, _cid: cid, id: d.id });
  });

  /* Mapping diagnostics — surface broken attribution to the UI. Without this,
     a school whose students lack matching branchId fields ends up with every
     metric dragged to fallback-branch, making Owner think one branch is
     full of risk students when it's actually a data hygiene issue. */
  const totalStudentsInScope = studentsSnap.docs.length;
  const mappedBeforeFallback = studentMap.size;
  let fallbackTriggered = false;
  /* Last-resort fallback — STRICTLY for "All Branches" view only.
     Previously this fired for any selection, dumping every student into the
     selected branch when their `branchId` field didn't resolve. That caused
     identical risk counts no matter which branch the Owner clicked, hiding a
     real data hygiene problem behind misleading parity. Restricting to "all"
     means specific-branch views honestly show 0 students mapped, and the
     user can compare "All vs each branch" to spot the discrepancy. */
  if (
    studentMap.size === 0 &&
    totalStudentsInScope > 0 &&
    branches.length > 0 &&
    selectedBranchId === "all"
  ) {
    const fallbackBranchId = branches[0].id;
    (studentsSnap.docs as any[]).forEach(d => {
      studentMap.set(d.id, { ...d.data(), _cid: fallbackBranchId, id: d.id });
    });
    fallbackTriggered = true;
  }
  /* Unmapped count: students who never resolved to any in-scope branch.
     For "All branches" filter this equals `total - mappedBeforeFallback`.
     For a single-branch filter, this is harder to interpret (some students
     may belong to OTHER branches and be intentionally excluded), so we only
     report mappingIssue at the "all" view to avoid false alarms. */
  const unmapped = selectedBranchId === "all"
    ? Math.max(0, totalStudentsInScope - mappedBeforeFallback)
    : 0;
  const mappingIssue: RiskMappingIssue | null =
    (fallbackTriggered || unmapped > 0) && totalStudentsInScope > 0
      ? { unmapped: fallbackTriggered ? totalStudentsInScope : unmapped, total: totalStudentsInScope, fallbackTriggered }
      : null;

  const alerts: AlertItem[] = [];
  let criticalCount = 0, warningCount = 0, infoCount = 0;

  // Track detailed per-branch stats including attendance % and counts
  const branchStats = new Map<string, {
    critical: number; warning: number; info: number;
    totalStudents: number;
    attTotal: number; attPresent: number;
    lowAttCount: number; // students below 80%
    lowScoreCount: number; // students below 60%
  }>();
  branches.forEach(b => branchStats.set(b.id, {
    critical: 0, warning: 0, info: 0,
    totalStudents: 0, attTotal: 0, attPresent: 0,
    lowAttCount: 0, lowScoreCount: 0,
  }));

  // ── Risk calculation per student ──────────────────────────────────────────
  studentMap.forEach((s, sid) => {
    const sAtt = attByStudent.get(sid) || [];
    const sRes = resByStudent.get(sid) || [];
    const sInc = incByStudent.get(sid) || [];
    const bStats = branchStats.get(s._cid);
    if (!bStats) return;

    bStats.totalStudents++;

    let level: 'critical' | 'warning' | 'info' | null = null;

    // Attendance risk
    if (sAtt.length > 3) {
      const presentCount = sAtt.filter((r: any) => r.status === "present").length;
      const attPct = (presentCount / sAtt.length) * 100;
      bStats.attTotal   += sAtt.length;
      bStats.attPresent += presentCount;
      if (attPct < 80) bStats.lowAttCount++;
      if (attPct < thresholds.attendanceCritical)  level = 'critical';
      else if (attPct < thresholds.attendanceWarning) level = 'warning';
    }

    // Academic risk — extract numeric values FIRST, then average only over
    // entries that actually have data. Previously a score doc with neither
    // `percentage` nor `score` field contributed 0 to the avg, dragging it
    // below the warning threshold and falsely flagging the student as at-risk
    // (per `bug_pattern_score_zero_no_data` memory rule).
    const validScores = sRes
      .map((r: any) => Number(r.percentage ?? r.score))
      .filter((v: number) => Number.isFinite(v) && v > 0);
    if (validScores.length > 0) {
      const avg = validScores.reduce((acc: number, v: number) => acc + v, 0) / validScores.length;
      if (avg < 60) bStats.lowScoreCount++;
      if (avg < 45) level = 'critical';
      else if (avg < 60 && !level) level = 'warning';
    }

    // Discipline risk
    if (sInc.length >= 2) level = 'critical';
    else if (sInc.length === 1 && !level) level = 'warning';

    if (level) {
      bStats[level]++;
      if (level === 'critical') criticalCount++;
      else if (level === 'warning') warningCount++;
      else infoCount++;
    }
  });

  // ── Build Alerts ──────────────────────────────────────────────────────────
  branches.forEach(b => {
    if (selectedBranchId !== "all" && b.id !== selectedBranchId) return;
    const stats = branchStats.get(b.id);
    if (!stats) return;

    const branchAttPct = stats.attTotal > 0
      ? Math.round((stats.attPresent / stats.attTotal) * 100)
      : null;

    if (stats.critical > 0) {
      const affectedCount = stats.lowAttCount + stats.lowScoreCount;
      alerts.push({
        id: `crit-${b.id}`,
        title: `Attendance Drop - ${b.name}`,
        status: 'Critical',
        desc: branchAttPct != null
          ? `Average attendance dropped to ${branchAttPct}% • ${affectedCount} students affected`
          : `${stats.critical} students require immediate academic or attendance intervention.`,
        type: 'critical',
        branchId: b.id,
        branchName: b.name,
        studentCount: stats.lowAttCount,
        totalStudents: stats.totalStudents,
        attendancePct: branchAttPct ?? undefined,
        timing: 'Active',
      });
    }
    if (stats.lowScoreCount > 2) {
      alerts.push({
        id: `score-${b.id}`,
        title: `Low Academic Performance - ${b.name}`,
        status: 'Critical',
        desc: `${stats.lowScoreCount} students scoring below 60% • Immediate academic intervention needed.`,
        type: 'critical',
        branchId: b.id,
        branchName: b.name,
        studentCount: stats.lowScoreCount,
        totalStudents: stats.totalStudents,
        timing: 'Active',
      });
    }
    if (stats.warning > 3) {
      alerts.push({
        id: `warn-${b.id}`,
        title: `Attendance Monitoring - ${b.name}`,
        status: 'Warning',
        desc: `Unusual attendance patterns detected across multiple grades in ${b.name}.`,
        type: 'warning',
        branchId: b.id,
        branchName: b.name,
        studentCount: stats.warning,
        totalStudents: stats.totalStudents,
        timing: 'Monitoring',
      });
    }
  });

  // Fallback if no alerts
  if (alerts.length === 0) {
    alerts.push({
      id: 'no-alerts',
      title: 'No Critical Alerts',
      status: 'Healthy',
      desc: 'All branches are performing within normal parameters.',
      type: 'info'
    });
  }

  // ── Charts Data ──────────────────────────────────────────────────────────
  const distribution = [
    { name: 'Critical', value: criticalCount, fill: '#ef4444' },
    { name: 'Warning', value: warningCount, fill: '#f59e0b' },
    { name: 'Info', value: infoCount, fill: '#3b82f6' },
  ].filter(d => d.value > 0);

  if (distribution.length === 0) {
    distribution.push({ name: 'Healthy', value: 1, fill: '#22c55e' });
  }

  /* No more `.slice(0, 5)` — silently capping at 5 branches hid risk volume
     for schools with 6+ branches. The chart already supports horizontal scroll
     on mobile (BranchesComparison.tsx pattern), and on desktop the bars just
     get thinner. Showing the full picture > arbitrary cap. */
  const branchRisks = branches.map(b => {
    const stats = branchStats.get(b.id) || { critical: 0, warning: 0 };
    return {
      name: b.name,
      value: stats.critical + stats.warning,
      color: stats.critical > 0 ? '#ef4444' : '#f59e0b'
    };
  }).filter(b => b.value > 0);

  if (branchRisks.length === 0) {
      branchRisks.push({ name: 'All Clear', value: 0, color: '#22c55e' });
  }

  // ── Real 4-week trend from actual attendance data ─────────────────────────
  const todayTrendMs = Date.now();
  // weeklyStudentAtt[0] = current week, weeklyStudentAtt[3] = 3 weeks ago
  const weeklyStudentAtt: Map<string, { total: number; present: number }>[] = [
    new Map(), new Map(), new Map(), new Map(),
  ];

  (attendanceSnap.docs as any[]).forEach(d => {
    const a = d.data();
    const sid = a.studentId as string;
    if (!sid || !studentMap.has(sid)) return;
    let dateStr: string = a.date || a.dateStr || "";
    if (!dateStr && a.createdAt?.toDate) {
      try { dateStr = a.createdAt.toDate().toLocaleDateString("en-CA"); } catch { /* skip */ }
    }
    if (!dateStr) return;
    const dMs = new Date(dateStr).getTime();
    if (isNaN(dMs)) return;
    const diffDays = Math.floor((todayTrendMs - dMs) / (1000 * 60 * 60 * 24));
    if (diffDays < 0 || diffDays > 27) return; // only last 4 weeks
    const weekIdx = Math.floor(diffDays / 7); // 0=current, 3=oldest
    const wMap = weeklyStudentAtt[weekIdx];
    if (!wMap.has(sid)) wMap.set(sid, { total: 0, present: 0 });
    const wAtt = wMap.get(sid)!;
    wAtt.total++;
    if ((a.status ?? "").toString().toLowerCase() === "present") wAtt.present++;
  });

  const computeWeekRisks = (wMap: Map<string, { total: number; present: number }>) => {
    let critical = 0, warning = 0;
    wMap.forEach(att => {
      if (att.total < 2) return; // need ≥2 records for a meaningful % in that week
      const pct = (att.present / att.total) * 100;
      if (pct < thresholds.attendanceCritical) critical++;
      else if (pct < thresholds.attendanceWarning) warning++;
    });
    return { critical, warning };
  };

  const trend = [
    { name: '3 Wks Ago', ...computeWeekRisks(weeklyStudentAtt[3]) },
    { name: '2 Wks Ago', ...computeWeekRisks(weeklyStudentAtt[2]) },
    { name: 'Last Wk',   ...computeWeekRisks(weeklyStudentAtt[1]) },
    { name: 'This Wk',   ...computeWeekRisks(weeklyStudentAtt[0]) },
  ];

  // ── Fetch resolutions — count resolved + build recently-resolved filter set ─
  let resolvedCount = 0;
  const recentlyResolved = new Set<string>();
  try {
    const resolutionsSnap = await getDocs(query(collection(db, "alert_resolutions"), where("schoolId", "==", uid)));
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const oneDayAgo     = Date.now() -      24 * 60 * 60 * 1000;
    resolutionsSnap.docs.forEach(d => {
      const data = d.data();
      const ts = data.resolvedAt?.toMillis?.() || 0;
      if (ts > thirtyDaysAgo) resolvedCount++;
      // Filter resolved alerts from active display for 24h window
      if (data.action === "resolved" && ts > oneDayAgo && data.alertId) {
        recentlyResolved.add(data.alertId as string);
      }
    });
  } catch { /* graceful fail */ }

  // Filter out alerts resolved in the last 24h so they don't re-appear immediately
  const visibleAlerts = alerts.filter(a => !recentlyResolved.has(a.id));
  if (visibleAlerts.length === 0) {
    visibleAlerts.push({
      id: 'no-alerts',
      title: 'No Active Alerts',
      status: 'Healthy',
      desc: 'All active alerts have been resolved. Great work!',
      type: 'info'
    });
  }

  // ── Fire-and-forget critical alert email (respects notification prefs) ────
  if (criticalCount > 0 && notifCriticalAlerts && schoolEmail) {
    const worstBranch = branchRisks[0]?.name;
    sendCriticalAlertEmail({
      to:            schoolEmail,
      ownerName:     schoolOwnerName,
      schoolName:    schoolName,
      criticalCount,
      warningCount,
      branchName:    worstBranch,
    }).catch(() => {}); // fire-and-forget, never blocks UI
  }

  const totalAlerts = criticalCount + warningCount;
  const resolutionRate = totalAlerts > 0 ? Math.round((resolvedCount / (resolvedCount + totalAlerts)) * 100) : 0;

  return {
    stats: [
      {
        label: "Active Alerts",
        value: visibleAlerts.filter(a => a.id !== 'no-alerts').length.toString(),
        change: totalAlerts > 0 ? `${criticalCount} critical, ${warningCount} warning` : "All clear",
        col: totalAlerts > 0 ? "text-rose-500" : "text-emerald-500"
      },
      { label: "Critical", value: criticalCount.toString(), change: "Immediate action required", col: "text-rose-500" },
      { label: "Warning", value: warningCount.toString(), change: "Monitor closely", col: "text-amber-500" },
      {
        label: "Resolved (30d)",
        value: resolvedCount.toString(),
        change: resolutionRate > 0 ? `${resolutionRate}% resolution rate` : "Tracking active",
        col: "text-emerald-500"
      },
    ],
    distribution,
    trend,
    branchRisks,
    alerts: visibleAlerts,
    mappingIssue,
  };
}

// ── Alert Detail ──────────────────────────────────────────────────────────────
export type AlertDetailData = {
  alertId:    string;
  title:      string;
  type:       'critical' | 'warning' | 'info';
  status:     string;
  branchName: string;
  alertNum:   string;
  detectedOn: string;
  metrics: { label: string; value: string; note: string; color: string }[];
  description: string;
  trend:    { day: string; pct: number }[];
  baseline: number;
  affectedStudents: { initials: string; name: string; pct: string; color: string }[];
  actions: { title: string; sub: string; done: boolean }[];
  historicalAlerts: { title: string; status: string; branch: string; period: string; resolvedIn: string }[];
  totalStudentsInBranch: number;
  durationDays: number;
};

export async function fetchAlertDetail(alertId: string): Promise<AlertDetailData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  // Parse alertId → type + branchId  e.g. "crit-abc123" or "warn-abc123"
  const dashIdx  = alertId.indexOf('-');
  const prefix   = dashIdx !== -1 ? alertId.slice(0, dashIdx) : alertId;
  const branchId = dashIdx !== -1 ? alertId.slice(dashIdx + 1) : alertId;
  const alertType: 'critical' | 'warning' | 'info' =
    prefix === 'crit' ? 'critical' : prefix === 'warn' ? 'warning' : 'info';

  /* Use the same cached raw snapshot as fetchRisksOverview — students,
     attendance, and branches are already loaded. Saves three round-trips
     when the user clicks an alert from the overview list. */
  const snap = await loadRisksSnapshot(uid);
  const { branchesSnap, studentsSnap, attendanceSnap } = snap;

  const branchDoc  = branchesSnap.docs.find((d: any) => (d.data().branchId || d.id) === branchId);
  const branchName = branchDoc?.data()?.name || branchDoc?.data()?.schoolName || "Branch";

  // Students belonging to this branch
  const branchStudentIds = new Set<string>();
  const studentNames = new Map<string, string>();
  (studentsSnap.docs as any[]).forEach(d => {
    const s = d.data();
    if (s.schoolId === branchId || s.branchId === branchId) {
      branchStudentIds.add(d.id);
      const name = [s.firstName || s.name || "Student", s.lastName || ""].join(" ").trim();
      studentNames.set(d.id, name);
    }
  });

  // Per-student attendance
  const studentAtt = new Map<string, { total: number; present: number }>();
  branchStudentIds.forEach(id => studentAtt.set(id, { total: 0, present: 0 }));

  // Last-7-days date strings
  const today = new Date();
  const last7: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    last7.push(d.toLocaleDateString("en-CA")); // YYYY-MM-DD
  }
  const dailyAtt = new Map<string, { total: number; present: number }>();
  last7.forEach(ds => dailyAtt.set(ds, { total: 0, present: 0 }));

  (attendanceSnap.docs as any[]).forEach(d => {
    const a    = d.data();
    const sid  = a.studentId || "";
    if (!branchStudentIds.has(sid)) return;
    const prev = studentAtt.get(sid)!;
    prev.total++;
    if (a.status?.toLowerCase() === "present") prev.present++;

    const dateStr = a.date || a.dateStr || a.createdAt?.toDate?.()?.toLocaleDateString("en-CA") || "";
    if (dailyAtt.has(dateStr)) {
      const dp = dailyAtt.get(dateStr)!;
      dp.total++;
      if (a.status?.toLowerCase() === "present") dp.present++;
    }
  });

  // Trend for chart
  const trend = last7.map((ds, i) => {
    const dp  = dailyAtt.get(ds)!;
    const day = new Date(today);
    day.setDate(day.getDate() - (6 - i));
    const label = day.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { day: label, pct: dp.total > 0 ? Math.round(dp.present / dp.total * 100) : 0 };
  });

  // Overall branch attendance
  let allTotal = 0, allPresent = 0;
  studentAtt.forEach(v => { allTotal += v.total; allPresent += v.present; });
  const overallPct = allTotal > 0 ? Math.round(allPresent / allTotal * 100) : 0;
  const baseline   = 85;

  // Affected students (below 80%)
  const affected = Array.from(studentAtt.entries())
    .filter(([, v]) => v.total > 0 && Math.round(v.present / v.total * 100) < 80)
    .map(([sid, v]) => ({
      name:  studentNames.get(sid) || "Student",
      pct:   Math.round(v.present / v.total * 100),
    }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 6);

  const COLORS = ["#ef4444","#f59e0b","#8b5cf6","#3b82f6","#10b981","#ec4899"];
  const affectedStudents = affected.map((s, i) => ({
    initials: s.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2),
    name:     s.name,
    pct:      `${s.pct}%`,
    color:    COLORS[i % COLORS.length],
  }));

  const totalStudents = branchStudentIds.size;
  /* Unique alert number — full-branchId hash, not just first char.
     Previously two branches starting with the same letter got identical
     alert numbers (e.g. "Banjarahills" and "Bandra" both → RA-2026-XXXX). */
  const branchHash = (() => {
    let h = 0;
    for (let i = 0; i < branchId.length; i++) {
      h = ((h << 5) - h + branchId.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % 9000 + 1000;
  })();
  const alertNum = `RA-${new Date().getFullYear()}-${branchHash}`;

  /* Real "detected on" — earliest day in the 7-day trend window that fell
     below baseline. Previously this was always today's date, even for an
     alert that started a week ago. The trend array is in chronological
     order (oldest → newest), so findIndex gives us the first below-baseline
     day. The date is reconstructed from the index offset. */
  const firstBelowIdx = trend.findIndex(t => t.pct > 0 && t.pct < baseline);
  const detectedDate  = firstBelowIdx >= 0
    ? new Date(today.getTime() - (6 - firstBelowIdx) * 24 * 60 * 60 * 1000)
    : new Date();
  const detectedOn = detectedDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  // Duration: actual count of days below baseline in the trend window.
  const durationDays = trend.filter(t => t.pct > 0 && t.pct < baseline).length || 1;

  const description = alertType === 'critical'
    ? `Significant attendance decline detected at ${branchName}. ${affected.length} students have attendance below 80%, with overall branch attendance at ${overallPct}%. Immediate intervention is required to prevent further academic decline.`
    : `Attendance monitoring alert for ${branchName}. ${affected.length} students showing attendance patterns below normal thresholds. Close monitoring and early action can prevent escalation.`;

  const actions = alertType === 'critical' ? [
    { title: "Contact parents of students with <70% attendance", sub: "Priority: High • Estimated time: 2 hours", done: false },
    { title: "Review attendance records and identify patterns", sub: "Priority: High • Estimated time: 1 hour", done: false },
    { title: "Schedule parent-teacher meeting for affected students", sub: "Priority: Medium • Estimated time: 3 hours", done: false },
  ] : [
    { title: "Monitor attendance trends for next 2 weeks", sub: "Priority: Medium • Ongoing", done: false },
    { title: "Send attendance reminder notification to parents", sub: "Priority: Low • Estimated time: 30 minutes", done: false },
    { title: "Review class schedule for potential conflicts", sub: "Priority: Low • Estimated time: 1 hour", done: false },
  ];

  /* Historical alerts from resolved alert_resolutions collection — scoped.
     Previously this block was largely fabricated:
       - title alternated between "Attendance Drop" / "Academic Risk" by
         array index (i === 0 ? ... : ...) regardless of the actual alertId
         type prefix
       - branch was always the CURRENT branchName, ignoring which branch
         the resolution was actually about
       - resolvedIn was `Math.random() * 7 + 3` — pure fiction
     Now: parse the alertId (format: "{prefix}-{branchId}") to recover the
     real type + real branch. Drop the fake resolvedIn since we don't track
     the alert's first-detection time anywhere — making one up was
     misleading. */
  let historicalAlerts: AlertDetailData["historicalAlerts"] = [];
  try {
    const resSnap = await getDocs(query(collection(db, "alert_resolutions"), where("schoolId", "==", uid)));
    historicalAlerts = resSnap.docs
      .map(d => d.data())
      .filter(d => d.action === "resolved")
      .slice(0, 3)
      .map((d) => {
        const altId = String(d.alertId || "");
        const dashIdx = altId.indexOf("-");
        const altPrefix   = dashIdx >= 0 ? altId.slice(0, dashIdx) : altId;
        const altBranchId = dashIdx >= 0 ? altId.slice(dashIdx + 1) : "";

        const altBranchDoc = branchesSnap.docs.find(b => (b.data().branchId || b.id) === altBranchId);
        const altBranchName = altBranchDoc?.data()?.name
          || altBranchDoc?.data()?.schoolName
          || branchName; // fallback only if we can't resolve

        const titleByPrefix =
          altPrefix === "crit"  ? `Attendance Drop - ${altBranchName}` :
          altPrefix === "score" ? `Low Academic Performance - ${altBranchName}` :
          altPrefix === "warn"  ? `Attendance Monitoring - ${altBranchName}` :
                                  `Resolved Alert - ${altBranchName}`;

        const resolvedAtDate = d.resolvedAt?.toDate ? d.resolvedAt.toDate() : null;
        const period = resolvedAtDate
          ? resolvedAtDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : "Recent";

        return {
          title:      titleByPrefix,
          status:     "Resolved",
          branch:     altBranchName,
          period,
          resolvedIn: "", // honest empty — alert createdAt isn't tracked
        };
      });
  } catch { /* graceful fail */ }

  return {
    alertId,
    title: alertType === 'critical'
      ? `Attendance Drop — ${branchName}`
      : `Attendance Monitoring — ${branchName}`,
    type: alertType,
    status: alertType === 'critical' ? 'Critical' : 'Warning',
    branchName, alertNum, detectedOn,
    metrics: [
      {
        label: "Current Attendance",
        value: allTotal > 0 ? `${overallPct}%` : "N/A",
        note: allTotal > 0
          ? `↓ ${Math.max(0, baseline - overallPct)}% from baseline (${baseline}%)`
          : "No attendance data recorded",
        color: overallPct < 75 ? "text-rose-500" : "text-amber-500",
      },
      {
        label: "Students Affected",
        value: affected.length.toString(),
        note: `Out of ${totalStudents} total`,
        color: "text-[#111827]",
      },
      {
        label: "Duration",
        value: `${durationDays} day${durationDays !== 1 ? "s" : ""}`,
        note: `Since ${detectedOn}`,
        color: "text-[#111827]",
      },
    ],
    description, trend, baseline, affectedStudents, actions,
    historicalAlerts,
    totalStudentsInBranch: totalStudents,
    durationDays,
  };
}

// ── Resolve / Acknowledge alert (writes to Firestore) ─────────────────────────
export async function resolveAlert(
  alertId: string,
  action: "resolved" | "acknowledged" | "assigned",
  assignedTo?: string,
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await addDoc(collection(db, "alert_resolutions"), {
    /* schoolId on write so the scoped read in fetchRisksOverview can find it.
       Without this field, the where("schoolId", "==", uid) filter would
       silently exclude the just-written resolution row. */
    schoolId: uid,
    alertId, action, resolvedBy: uid, resolvedAt: serverTimestamp(),
    ...(assignedTo ? { assignedTo } : {}),
  });
  /* Bust the snapshot cache so the next fetchRisksOverview / fetchAlertDetail
     re-pulls fresh `alert_resolutions` (which we DON'T cache because they
     change with every resolve action). The 5-min raw cache is still useful
     for student/attendance/test_scores which change less frequently. */
  invalidateRisksCache();
}
