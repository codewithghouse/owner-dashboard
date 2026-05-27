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
  testScoresSnap:      { docs: any[] };
  /* Co-canonical with test_scores per owner_dashboard_alternate_data_sources
     memory — schools that write through the gradebook flow land here, those
     using direct test entry land in test_scores. Reading only one drops ~40%. */
  gradebookScoresSnap: { docs: any[] };
  attendanceSnap:      { docs: any[] };
  incidentsSnap:       { docs: any[] };
  studentsSnap:        { docs: any[] };
  teachersSnap:        { docs: any[] };
  enrollmentsSnap:     { docs: any[] };
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
  const [testScoresSnap, gradebookScoresSnap, attendanceSnap, incidentsSnap, studentsSnap, teachersSnap, enrollmentsSnap] = await Promise.all([
    scopedDocs("test_scores",      uid),
    scopedDocs("gradebook_scores", uid),
    scopedDocs("attendance",       uid),
    scopedDocs("incidents",        uid),
    scopedDocs("students",         uid),
    scopedDocs("teachers",         uid),
    scopedDocs("enrollments",      uid),
  ]);

  const snapshot: RisksRawSnapshot = {
    uid,
    ts: Date.now(),
    thresholds,
    schoolEmail, schoolOwnerName, schoolName, notifCriticalAlerts,
    branches,
    branchesSnap: { docs: branchesSnap.docs },
    anyIdToCanonical,
    testScoresSnap, gradebookScoresSnap, attendanceSnap, incidentsSnap, studentsSnap, teachersSnap, enrollmentsSnap,
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
    testScoresSnap, gradebookScoresSnap, attendanceSnap, incidentsSnap, studentsSnap, teachersSnap, enrollmentsSnap,
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
  /* Merge BOTH score collections — schools using direct test entry write to
     test_scores; schools using the gradebook flow write to gradebook_scores.
     Reading only one collection silently drops ~40% of records and would make
     a school's academic risk look healthier than reality. */
  [testScoresSnap, gradebookScoresSnap].forEach(snap => {
    (snap.docs as any[]).forEach(d => {
      const sid = d.data().studentId;
      if (!sid) return;
      if (!resByStudent.has(sid)) resByStudent.set(sid, []);
      resByStudent.get(sid)!.push(d.data());
    });
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

    // Attendance risk — exclude holiday docs (whole-class declared off-days).
    const sAttCountable = sAtt.filter((r: any) => r.status !== "holiday");
    if (sAttCountable.length > 3) {
      const presentCount = sAttCountable.filter((r: any) => r.status === "present").length;
      const attPct = (presentCount / sAttCountable.length) * 100;
      bStats.attTotal   += sAttCountable.length;
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
  /* Drives chart axes + empty-state copy. Attendance → daily 7-day % chart
     (Y[50,100]). Academic → weekly 4-week score chart (Y[0,100]). Fees +
     teachers don't have a meaningful trend — the chart shows its empty state
     and the metrics row + affected-list carry the data instead.
     Each kind maps to one cron ruleKey from [[project-critical-alerts-cron]]:
       attendance → LOW_ATTENDANCE_7D / legacy crit-|warn- prefix
       academic   → SCORE_DROP_MOM    / legacy score- prefix
       fees       → FEE_DEFAULTER_SURGE
       teachers   → INACTIVE_TEACHER */
  kind:       'attendance' | 'academic' | 'fees' | 'teachers';
  status:     string;
  branchName: string;
  alertNum:   string;
  detectedOn: string;
  metrics: { label: string; value: string; note: string; color: string }[];
  description: string;
  trend:    { day: string; pct: number }[];
  trendLabel:       string;  // e.g. "Attendance Trend (Last 7 Days)" or "Test Score Trend (Last 4 Weeks)"
  affectedSubtitle: string;  // e.g. "(below 80% attendance)" or "(below 60% average)"
  baseline: number;
  baselineLabel:    string;  // e.g. "Warning" / "Passing" — what the green dashed line means
  affectedStudents: { initials: string; name: string; pct: string; color: string }[];
  actions: { title: string; sub: string; done: boolean }[];
  historicalAlerts: { title: string; status: string; branch: string; period: string; resolvedIn: string }[];
  totalStudentsInBranch: number;
  durationDays: number;
  /* When the parent overview said "N students at risk in branch X" but
     detail can't resolve a single student to that branch, surface the
     mapping issue rather than showing an honest-but-confusing empty page.
     Mirrors RisksData.mappingIssue but scoped to this single branch. */
  mappingIssue: { totalSchoolStudents: number } | null;
};

export async function fetchAlertDetail(alertId: string): Promise<AlertDetailData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  /* ── Step 1: look up `/risks/{alertId}` FIRST ─────────────────────────────
     Two alert sources exist:
       (a) Client-computed alerts from fetchRisksOverview — IDs prefixed
           `crit-/warn-/score-{branchId}`
       (b) Cron-written /risks docs from scanBranchAlertsCron (4-hr Cloud
           Function) — auto-generated Firestore doc IDs + a `ruleKey` field
     The previous parser only handled (a) — for (b) it split the autogen ID
     at the first `-`, producing a garbage `branchId`. Result: branchDoc was
     undefined → branchName='Branch' default → branchStudentIds empty → every
     metric N/A, even though the cron clearly fired with real data. Bug
     reported 2026-05-27 (see [[project-owner-alert-detail-bug]]).
     Defense-in-depth: confirm the doc's schoolId matches the signed-in uid
     before trusting any of its fields. */
  let docData: any = null;
  try {
    const riskDoc = await getDoc(doc(db, "risks", alertId));
    if (riskDoc.exists()) {
      const r = riskDoc.data();
      if (r.schoolId === uid) docData = r;
    }
  } catch { /* graceful fall-through to legacy parse */ }

  let alertKind: 'attendance' | 'academic' | 'fees' | 'teachers';
  let alertType: 'critical' | 'warning' | 'info';
  let branchId: string;

  if (docData?.ruleKey && docData?.branchId) {
    branchId  = docData.branchId as string;
    alertType = docData.severity === 'critical' ? 'critical' : 'warning';
    alertKind = docData.ruleKey === 'LOW_ATTENDANCE_7D'    ? 'attendance' :
                docData.ruleKey === 'SCORE_DROP_MOM'       ? 'academic'   :
                docData.ruleKey === 'FEE_DEFAULTER_SURGE'  ? 'fees'       :
                docData.ruleKey === 'INACTIVE_TEACHER'     ? 'teachers'   :
                'attendance';
  } else {
    // Legacy prefix parse — branchId may itself contain dashes, slice at first.
    const dashIdx  = alertId.indexOf('-');
    const prefix   = dashIdx !== -1 ? alertId.slice(0, dashIdx) : alertId;
    branchId       = dashIdx !== -1 ? alertId.slice(dashIdx + 1) : alertId;
    alertKind      = prefix === 'score' ? 'academic' : 'attendance';
    alertType      = prefix === 'crit' || prefix === 'score' ? 'critical' :
                     prefix === 'warn' ? 'warning' : 'info';
  }

  /* Use the same cached raw snapshot as fetchRisksOverview — students,
     attendance, scores, branches, teachers, enrollments are already loaded.
     Saves several round-trips when the user clicks through from the overview. */
  const snap = await loadRisksSnapshot(uid);
  const {
    branchesSnap, studentsSnap, attendanceSnap, testScoresSnap, gradebookScoresSnap,
    teachersSnap, enrollmentsSnap, anyIdToCanonical, thresholds,
  } = snap;

  const branchDoc  = branchesSnap.docs.find((d: any) => (d.data().branchId || d.id) === branchId);
  /* Prefer the cron doc's branchName (it was captured at write-time so it
     survives branch renames between cron and now). Fall back to branchesSnap
     lookup, then to the literal "Branch" only if we genuinely can't resolve. */
  const branchName = docData?.branchName as string
    || branchDoc?.data()?.name
    || branchDoc?.data()?.schoolName
    || "Branch";

  /* Use the SAME canonical-resolution chain as fetchRisksOverview so a school
     whose students are reached only via the doc-id or enrollment-chain fallback
     in the overview also resolves here. Previously this used raw equality on
     `s.schoolId === branchId || s.branchId === branchId` and quietly returned
     0 affected students for any school whose mapping required the fallback —
     so the parent overview card said "12 students affected" but the detail
     page showed an empty list. See branchid_inference_lag memory. */
  const resolveCanonical = (s: any): string => {
    for (const key of ["branchId", "schoolId", "school_id", "uid"]) {
      const v = s[key];
      if (v && anyIdToCanonical.has(v)) return anyIdToCanonical.get(v)!;
    }
    return s.branchId || s.schoolId || s.school_id || "";
  };

  // Build teacher→branch map via canonical resolution + doc-id + uid field
  const teacherBranchMap = new Map<string, string>();
  (teachersSnap.docs as any[]).forEach(d => {
    const t = d.data();
    let cid = resolveCanonical(t);
    if (!cid) cid = anyIdToCanonical.get(d.id) || "";
    if (!cid && t.uid) cid = anyIdToCanonical.get(t.uid) || "";
    if (cid) teacherBranchMap.set(d.id, cid);
  });

  // Student→branch via enrollment chain (student → teacher → branch)
  const studentBranchViaEnrollment = new Map<string, string>();
  (enrollmentsSnap.docs as any[]).forEach(d => {
    const e = d.data();
    const sid = e.studentId as string;
    const tid = e.teacherId as string;
    if (!sid || studentBranchViaEnrollment.has(sid)) return;
    const cid = teacherBranchMap.get(tid);
    if (cid) studentBranchViaEnrollment.set(sid, cid);
  });

  // Identify students belonging to this branch
  const branchStudentIds = new Set<string>();
  const studentNames = new Map<string, string>();
  (studentsSnap.docs as any[]).forEach(d => {
    const s = d.data();
    let cid = resolveCanonical(s);
    if (cid !== branchId) cid = studentBranchViaEnrollment.get(d.id) || "";
    if (cid !== branchId) cid = anyIdToCanonical.get(d.id) || "";
    if (cid !== branchId) return;
    branchStudentIds.add(d.id);
    /* Build display name from all known shape variants. If a student has no
       firstName / name / lastName fields, fall back to "Student {id-suffix}"
       — previously every nameless student rendered as just "Student", causing
       collisions in the affected-students list (multiple identical rows with
       identical "S" initials). The 4-char id suffix gives uniqueness without
       leaking the full doc id into the UI. */
    const fullName = [s.firstName || s.name || "", s.lastName || ""].join(" ").trim();
    const displayName = fullName || `Student ${d.id.slice(-4)}`;
    studentNames.set(d.id, displayName);
  });

  /* Mapping diagnostics — surface the case where the parent overview said
     "branch X has N at-risk students" but our resolution chain found zero
     students in this branch. Without this banner the user sees an empty
     "Affected Students" panel with 0 metrics and assumes the branch is
     healthy, when really it's a student.branchId hygiene issue. Mirrors the
     fetchRisksOverview mappingIssue contract but scoped to this single branch. */
  const totalSchoolStudents = studentsSnap.docs.length;
  const mappingIssue: AlertDetailData["mappingIssue"] =
    branchStudentIds.size === 0 && totalSchoolStudents > 0 && branchDoc !== undefined
      ? { totalSchoolStudents }
      : null;

  const today          = new Date();
  const totalStudents  = branchStudentIds.size;
  const COLORS         = ["#ef4444","#f59e0b","#8b5cf6","#3b82f6","#10b981","#ec4899"];

  /* Unique alert number — full-branchId hash, not just first char. */
  const branchHash = (() => {
    let h = 0;
    for (let i = 0; i < branchId.length; i++) {
      h = ((h << 5) - h + branchId.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % 9000 + 1000;
  })();
  const alertNum = `RA-${new Date().getFullYear()}-${branchHash}`;

  /* ──────────────────────────────────────────────────────────────────────
     Branch on alertKind. Both branches build the same AlertDetailData shape
     so the page renders with one render path; only labels + axis ranges
     differ (driven by `kind` + `trendLabel`).
     ────────────────────────────────────────────────────────────────────── */
  let metrics: AlertDetailData["metrics"];
  let description: string;
  let actions: AlertDetailData["actions"];
  let trend: AlertDetailData["trend"];
  let trendLabel: string;
  let affectedSubtitle: string;
  let baseline: number;
  let baselineLabel: string;
  let affectedStudents: AlertDetailData["affectedStudents"];
  let detectedOn: string;
  let durationDays: number;
  let title: string;

  if (alertKind === 'attendance') {
    // ── Per-student attendance ─────────────────────────────────────────────
    const studentAtt = new Map<string, { total: number; present: number }>();
    branchStudentIds.forEach(id => studentAtt.set(id, { total: 0, present: 0 }));

    // Last-7-days date strings (chronological)
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

    trend = last7.map((ds, i) => {
      const dp  = dailyAtt.get(ds)!;
      const day = new Date(today);
      day.setDate(day.getDate() - (6 - i));
      const label = day.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return { day: label, pct: dp.total > 0 ? Math.round(dp.present / dp.total * 100) : 0 };
    });

    let allTotal = 0, allPresent = 0;
    studentAtt.forEach(v => { allTotal += v.total; allPresent += v.present; });
    const overallPct = allTotal > 0 ? Math.round(allPresent / allTotal * 100) : 0;
    /* Use the school's CONFIGURED warning threshold as the chart's reference
       line + the "affected" cutoff. Previously hardcoded 85 (baseline) and 80
       (affected cutoff) — schools that customized thresholds.attendanceWarning
       to 75 or 90 saw a chart line and "Affected (below 80%)" copy that didn't
       match their own settings. */
    baseline      = thresholds.attendanceWarning;
    baselineLabel = "Warning";

    const affected = Array.from(studentAtt.entries())
      .filter(([, v]) => v.total > 0 && Math.round(v.present / v.total * 100) < baseline)
      .map(([sid, v]) => ({
        name:  studentNames.get(sid) || "Student",
        pct:   Math.round(v.present / v.total * 100),
      }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 6);

    affectedStudents = affected.map((s, i) => ({
      initials: s.name.split(" ").map((n: string) => n[0] || "").join("").toUpperCase().slice(0, 2) || "S",
      name:     s.name,
      pct:      `${s.pct}%`,
      color:    COLORS[i % COLORS.length],
    }));

    /* Detected-on resolution order:
       1. cron doc's createdAt (most authoritative — that's literally when the
          alert was fired)
       2. earliest below-baseline day in the 7-day trend window
       3. honest "No data recorded" copy (only when neither is available)
       Previously the page rendered "No data recorded" even for cron-generated
       alerts because firstBelowIdx was -1 whenever client-side student mapping
       failed — misleading because the cron fired exactly because there WAS data. */
    const cronCreatedAtMs = docData?.createdAt?.toMillis?.() || null;
    const firstBelowIdx   = trend.findIndex(t => t.pct > 0 && t.pct < baseline);
    const computedDate    = firstBelowIdx >= 0
      ? new Date(today.getTime() - (6 - firstBelowIdx) * 24 * 60 * 60 * 1000)
      : null;
    const detectedDate    = cronCreatedAtMs ? new Date(cronCreatedAtMs) : computedDate;
    detectedOn = detectedDate
      ? detectedDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
      : "No data recorded";
    durationDays = trend.filter(t => t.pct > 0 && t.pct < baseline).length
      || (cronCreatedAtMs ? Math.max(1, Math.floor((Date.now() - cronCreatedAtMs) / (1000 * 60 * 60 * 24))) : 0);

    title = alertType === 'critical'
      ? `Attendance Drop — ${branchName}`
      : `Attendance Monitoring — ${branchName}`;

    trendLabel       = "Attendance Trend (Last 7 Days)";
    affectedSubtitle = `(below ${baseline}% attendance)`;

    /* Description priority: prefer the cron's own message (it was authored
       with the actual sample size + branch attendance % when the rule fired),
       fall back to client-computed copy when this is a legacy client-only
       alert. The cron's message reads like:
         "Acme Branch attendance 64% over last 7 days (target ≥ 70%)" */
    description = (docData?.description as string) || (docData?.message as string) ||
      (alertType === 'critical'
        ? `Significant attendance decline detected at ${branchName}. ${affected.length} students have attendance below ${baseline}%, with overall branch attendance at ${overallPct}%. Immediate intervention is required to prevent further academic decline.`
        : `Attendance monitoring alert for ${branchName}. ${affected.length} students showing attendance patterns below normal thresholds. Close monitoring and early action can prevent escalation.`);

    /* Action priority targets the CRITICAL threshold (escalation tier), since
       students dipping below warning need contact, but students below critical
       need urgent contact. Both come from school settings. */
    actions = alertType === 'critical' ? [
      { title: `Contact parents of students with <${thresholds.attendanceCritical}% attendance`, sub: "Priority: High • Estimated time: 2 hours", done: false },
      { title: "Review attendance records and identify patterns", sub: "Priority: High • Estimated time: 1 hour", done: false },
      { title: "Schedule parent-teacher meeting for affected students", sub: "Priority: Medium • Estimated time: 3 hours", done: false },
    ] : [
      { title: "Monitor attendance trends for next 2 weeks", sub: "Priority: Medium • Ongoing", done: false },
      { title: "Send attendance reminder notification to parents", sub: "Priority: Low • Estimated time: 30 minutes", done: false },
      { title: "Review class schedule for potential conflicts", sub: "Priority: Low • Estimated time: 1 hour", done: false },
    ];

    /* When the cron fired but our client-side student→branch mapping failed
       (zero students resolved), fall back to the cron's own captured metrics
       so the page surfaces real numbers instead of N/A. The cron writes:
         metrics: { windowDays, attendancePct, sampleSize } */
    const cronAttPct      = typeof docData?.metrics?.attendancePct === 'number' ? docData.metrics.attendancePct : null;
    const cronSampleSize  = typeof docData?.metrics?.sampleSize    === 'number' ? docData.metrics.sampleSize    : null;
    const cronWindowDays  = typeof docData?.metrics?.windowDays    === 'number' ? docData.metrics.windowDays    : null;
    const displayedPct    = allTotal > 0 ? overallPct : cronAttPct;
    const showCronFallback = allTotal === 0 && cronAttPct !== null;

    metrics = [
      {
        label: "Current Attendance",
        value: displayedPct !== null ? `${displayedPct}%` : "N/A",
        note: displayedPct !== null
          ? `↓ ${Math.max(0, baseline - displayedPct)}% from baseline (${baseline}%)${showCronFallback && cronSampleSize ? ` · ${cronSampleSize} records` : ''}`
          : "No attendance data recorded",
        color: (displayedPct ?? 100) < 75 ? "text-rose-500" : "text-amber-500",
      },
      {
        label: "Students Affected",
        value: affected.length > 0
          ? affected.length.toString()
          : (showCronFallback && cronSampleSize ? `~${Math.max(1, Math.round(cronSampleSize / Math.max(cronWindowDays || 7, 1)))}` : "0"),
        note: totalStudents > 0
          ? `Out of ${totalStudents} total`
          : (showCronFallback ? "Branch totals unavailable — see mapping issue below" : "Out of 0 total"),
        color: "text-[#111827]",
      },
      {
        label: "Duration",
        value: durationDays > 0 ? `${durationDays} day${durationDays !== 1 ? "s" : ""}` : "N/A",
        note: durationDays > 0 ? `Since ${detectedOn}` : "No below-baseline days in window",
        color: "text-[#111827]",
      },
    ];
  } else if (alertKind === 'academic') {
    // ── Academic alert: per-student avg from BOTH score collections ────────
    const PASS_THRESHOLD = 60;  // matches fetchRisksOverview's lowScoreCount cutoff
    baseline      = PASS_THRESHOLD;
    baselineLabel = "Passing";

    /* Combine test_scores + gradebook_scores per owner_dashboard_alternate_data_sources
       memory — without both, ~40% of a school's records are silently ignored. */
    const scoresByStudent = new Map<string, any[]>();
    [testScoresSnap, gradebookScoresSnap].forEach(s => {
      (s.docs as any[]).forEach(d => {
        const data = d.data();
        const sid  = data.studentId;
        if (!sid || !branchStudentIds.has(sid)) return;
        if (!scoresByStudent.has(sid)) scoresByStudent.set(sid, []);
        scoresByStudent.get(sid)!.push(data);
      });
    });

    /* Per-student avg — only from VALID (>0) numeric values. A score doc with
       no `percentage` and no `score` field would otherwise contribute 0 and
       drag the avg artificially low (per bug_pattern_score_zero_no_data). */
    const studentAvg = new Map<string, number>();
    scoresByStudent.forEach((arr, sid) => {
      const valid = arr
        .map((r: any) => Number(r.percentage ?? r.score))
        .filter((v: number) => Number.isFinite(v) && v > 0);
      if (valid.length > 0) {
        studentAvg.set(sid, valid.reduce((a, b) => a + b, 0) / valid.length);
      }
    });

    // Affected: students with avg below passing threshold
    const affected = Array.from(studentAvg.entries())
      .filter(([, avg]) => avg < PASS_THRESHOLD)
      .map(([sid, avg]) => ({
        name: studentNames.get(sid) || "Student",
        pct:  Math.round(avg),
      }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 6);

    affectedStudents = affected.map((s, i) => ({
      initials: s.name.split(" ").map((n: string) => n[0] || "").join("").toUpperCase().slice(0, 2) || "S",
      name:     s.name,
      pct:      `${s.pct}%`,
      color:    COLORS[i % COLORS.length],
    }));

    // Branch overall avg
    const allAvgs = Array.from(studentAvg.values());
    const overallAvg = allAvgs.length > 0
      ? Math.round(allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length)
      : 0;

    /* Weekly trend over last 4 weeks. Test/gradebook scores aren't daily so
       a 7-day chart would be sparse — bucket by week instead. Date sources
       per filterByTime field-drift memory: try date / dateStr / createdAt /
       timestamp / updatedAt (different writers use different fields). */
    const todayMs = today.getTime();
    const weekly: { sum: number; count: number }[] = [
      { sum: 0, count: 0 }, { sum: 0, count: 0 }, { sum: 0, count: 0 }, { sum: 0, count: 0 },
    ];
    scoresByStudent.forEach(arr => {
      arr.forEach(r => {
        const v = Number(r.percentage ?? r.score);
        if (!Number.isFinite(v) || v <= 0) return;
        let dateStr: string = r.date || r.dateStr || "";
        if (!dateStr && r.createdAt?.toDate) {
          try { dateStr = r.createdAt.toDate().toISOString(); } catch { /* skip */ }
        }
        if (!dateStr && r.timestamp?.toDate) {
          try { dateStr = r.timestamp.toDate().toISOString(); } catch { /* skip */ }
        }
        if (!dateStr && r.updatedAt?.toDate) {
          try { dateStr = r.updatedAt.toDate().toISOString(); } catch { /* skip */ }
        }
        if (!dateStr) return;
        const dMs = new Date(dateStr).getTime();
        if (isNaN(dMs)) return;
        const diffDays = Math.floor((todayMs - dMs) / (1000 * 60 * 60 * 24));
        if (diffDays < 0 || diffDays > 27) return;
        const weekIdx = Math.floor(diffDays / 7);
        weekly[weekIdx].sum   += v;
        weekly[weekIdx].count += 1;
      });
    });

    trend = [
      { day: '3 Wks Ago', pct: weekly[3].count > 0 ? Math.round(weekly[3].sum / weekly[3].count) : 0 },
      { day: '2 Wks Ago', pct: weekly[2].count > 0 ? Math.round(weekly[2].sum / weekly[2].count) : 0 },
      { day: 'Last Wk',   pct: weekly[1].count > 0 ? Math.round(weekly[1].sum / weekly[1].count) : 0 },
      { day: 'This Wk',   pct: weekly[0].count > 0 ? Math.round(weekly[0].sum / weekly[0].count) : 0 },
    ];

    // Detection: prefer cron's createdAt (authoritative — that's when the
    // rule actually fired), else earliest below-baseline week in the trend.
    const cronCreatedAtMsAcad = docData?.createdAt?.toMillis?.() || null;
    const firstBelowIdx       = trend.findIndex(t => t.pct > 0 && t.pct < baseline);
    const computedDateAcad    = firstBelowIdx >= 0
      ? new Date(todayMs - (3 - firstBelowIdx) * 7 * 24 * 60 * 60 * 1000)
      : null;
    const detectedDate        = cronCreatedAtMsAcad ? new Date(cronCreatedAtMsAcad) : computedDateAcad;
    detectedOn = detectedDate
      ? detectedDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
      : "No data recorded";
    // Each below-baseline week ≈ 7 days
    durationDays = trend.filter(t => t.pct > 0 && t.pct < baseline).length * 7
      || (cronCreatedAtMsAcad ? Math.max(1, Math.floor((Date.now() - cronCreatedAtMsAcad) / (1000 * 60 * 60 * 24))) : 0);

    title = `Low Academic Performance — ${branchName}`;

    trendLabel       = "Test Score Trend (Last 4 Weeks)";
    affectedSubtitle = `(below ${PASS_THRESHOLD}% average)`;

    // Prefer cron's message (it captured prevAvg/thisAvg/drop at fire-time).
    description = (docData?.description as string) || (docData?.message as string)
      || `Academic performance decline at ${branchName}. ${affected.length} students have an average below ${PASS_THRESHOLD}%, with overall branch average at ${overallAvg}%. Targeted academic intervention is needed to prevent further decline.`;

    actions = [
      { title: "Identify subject-area weaknesses for affected students", sub: "Priority: High • Estimated time: 2 hours", done: false },
      { title: "Schedule remedial classes / peer-tutoring sessions",   sub: "Priority: High • Estimated time: 3 hours", done: false },
      { title: "Review teaching methodology with subject teachers",     sub: "Priority: Medium • Estimated time: 1 hour", done: false },
    ];

    /* Cron fallback when our client-side score aggregation finds nothing —
       e.g. students lack branchId or score docs use different field shapes.
       Cron writes: metrics: { thisAvg, prevAvg, drop, thisSample, prevSample } */
    const cronThisAvg = typeof docData?.metrics?.thisAvg === 'number' ? docData.metrics.thisAvg : null;
    const displayedAvg = allAvgs.length > 0 ? overallAvg : cronThisAvg;

    metrics = [
      {
        label: "Branch Average",
        value: displayedAvg !== null ? `${displayedAvg}%` : "N/A",
        note: displayedAvg !== null
          ? `↓ ${Math.max(0, baseline - displayedAvg)}% from passing (${baseline}%)${docData?.metrics?.drop ? ` · ${docData.metrics.drop} pt drop MoM` : ''}`
          : "No score data recorded",
        color: (displayedAvg ?? 100) < 50 ? "text-rose-500" : "text-amber-500",
      },
      {
        label: "Students Affected",
        value: affected.length > 0
          ? affected.length.toString()
          : (typeof docData?.metrics?.thisSample === 'number' ? `~${docData.metrics.thisSample}` : "0"),
        note: totalStudents > 0
          ? `Out of ${totalStudents} total`
          : "Branch totals unavailable — see mapping issue below",
        color: "text-[#111827]",
      },
      {
        label: "Duration",
        value: durationDays > 0 ? `${durationDays} day${durationDays !== 1 ? "s" : ""}` : "N/A",
        note: durationDays > 0 ? `Since ${detectedOn}` : "No below-passing weeks in window",
        color: "text-[#111827]",
      },
    ];
  } else if (alertKind === 'fees') {
    /* ── Fee Defaulter Surge (FEE_DEFAULTER_SURGE) ───────────────────────────
       Cron rule: ≥10 distinct students with fees overdue 30+ days. The
       render path lists actual defaulters (top 6 by oldest overdue date)
       with ₹ amount overdue. No meaningful daily trend — keep trend empty,
       page falls to its "No data" state. */
    title            = `Fee Defaulter Surge — ${branchName}`;
    trendLabel       = "Overdue Fees Trend";
    baseline         = 0;
    baselineLabel    = "Cleared";
    affectedSubtitle = `(30+ days overdue)`;

    /* On-demand fetch — fees aren't in loadRisksSnapshot's parallel pull
       because most owner pages don't need them. Worth the extra round-trip
       on this single page. Direct branchId filter mirrors the cron's query
       so we see the same rows the rule saw. */
    const feesSnap = await getDocs(
      query(collection(db, "fees"), where("schoolId", "==", uid), where("branchId", "==", branchId))
    ).catch(() => ({ docs: [] as any[] }));

    const FEE_OVERDUE_DAYS = 30;
    const overdueCutoff    = Date.now() - FEE_OVERDUE_DAYS * 24 * 60 * 60 * 1000;
    type Defaulter = { studentId: string; amount: number; oldestDueMs: number };
    const byStudent = new Map<string, Defaulter>();
    (feesSnap.docs as any[]).forEach(d => {
      const f = d.data();
      if (String(f.status || "").toLowerCase() === "paid") return;
      const dueRaw = f.dueDate || f.createdAt;
      const dueMs  = dueRaw?.toMillis?.() || (typeof dueRaw === 'string' ? new Date(dueRaw).getTime() : NaN);
      if (!Number.isFinite(dueMs) || dueMs > overdueCutoff) return;
      const sid    = f.studentId || f.student?.id;
      if (!sid) return;
      const amount = Number(f.amount ?? f.outstanding ?? 0) || 0;
      const prev   = byStudent.get(sid);
      if (!prev) byStudent.set(sid, { studentId: sid, amount, oldestDueMs: dueMs });
      else { prev.amount += amount; if (dueMs < prev.oldestDueMs) prev.oldestDueMs = dueMs; }
    });

    const defaulterList = Array.from(byStudent.values()).sort((a, b) => a.oldestDueMs - b.oldestDueMs);
    const totalAmountOverdue = defaulterList.reduce((s, d) => s + d.amount, 0);

    /* Student names — reuse studentNames map from earlier, but it was built
       only for students mapped to this branch via the enrollment chain.
       Fee docs may reference students whose mapping resolved differently —
       look them up directly from studentsSnap as a fallback. */
    const allStudentNames = new Map<string, string>(studentNames);
    (studentsSnap.docs as any[]).forEach(d => {
      if (allStudentNames.has(d.id)) return;
      const s = d.data();
      const fullName = [s.firstName || s.name || "", s.lastName || ""].join(" ").trim();
      allStudentNames.set(d.id, fullName || `Student ${d.id.slice(-4)}`);
    });

    affectedStudents = defaulterList.slice(0, 6).map((d, i) => {
      const name = allStudentNames.get(d.studentId) || `Student ${d.studentId.slice(-4)}`;
      const daysOverdue = Math.floor((Date.now() - d.oldestDueMs) / (1000 * 60 * 60 * 24));
      return {
        initials: name.split(" ").map((n: string) => n[0] || "").join("").toUpperCase().slice(0, 2) || "S",
        name,
        pct: d.amount > 0 ? `₹${d.amount.toLocaleString('en-IN')} · ${daysOverdue}d` : `${daysOverdue}d`,
        color: COLORS[i % COLORS.length],
      };
    });

    // No meaningful daily trend for fees — keep empty so chart shows empty state.
    trend = [];

    const cronCreatedAtMsFee = docData?.createdAt?.toMillis?.() || null;
    detectedOn = cronCreatedAtMsFee
      ? new Date(cronCreatedAtMsFee).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
      : "Detection pending";
    durationDays = cronCreatedAtMsFee
      ? Math.max(1, Math.floor((Date.now() - cronCreatedAtMsFee) / (1000 * 60 * 60 * 24)))
      : 0;

    const cronDefCount = typeof docData?.metrics?.defaulterCount === 'number' ? docData.metrics.defaulterCount : null;

    description = (docData?.description as string) || (docData?.message as string)
      || `Fee collection bottleneck at ${branchName}. ${defaulterList.length || cronDefCount || 'Multiple'} students have fees overdue ${FEE_OVERDUE_DAYS}+ days. Coordinated parent outreach and a payment-plan offer can recover most balances before they age further.`;

    actions = [
      { title: "Generate overdue-fee statement and send to parents",              sub: "Priority: High • Estimated time: 1 hour",  done: false },
      { title: "Offer instalment plan to families with ₹10k+ outstanding",      sub: "Priority: High • Estimated time: 2 hours", done: false },
      { title: "Escalate to principal for accounts >60 days overdue",            sub: "Priority: Medium • Ongoing",               done: false },
    ];

    metrics = [
      {
        label: "Defaulters",
        value: (defaulterList.length || cronDefCount || 0).toString(),
        note: cronDefCount && defaulterList.length === 0
          ? `${cronDefCount} flagged by cron · client lookup pending`
          : `Across ${branchName}`,
        color: "text-rose-500",
      },
      {
        label: "Amount Overdue",
        value: totalAmountOverdue > 0 ? `₹${totalAmountOverdue.toLocaleString('en-IN')}` : "N/A",
        note: totalAmountOverdue > 0 ? `Total outstanding 30+ days` : "Amount field missing on fee docs",
        color: "text-[#111827]",
      },
      {
        label: "Duration",
        value: durationDays > 0 ? `${durationDays} day${durationDays !== 1 ? "s" : ""}` : "N/A",
        note: durationDays > 0 ? `Since ${detectedOn}` : "Detection pending",
        color: "text-[#111827]",
      },
    ];
  } else {
    /* ── Inactive Teacher (INACTIVE_TEACHER) ─────────────────────────────────
       Cron rule: teachers idle 5+ days. Render lists idle teachers with
       days-since-last-login. No daily trend. */
    const TEACHER_IDLE_DAYS = 5;
    title            = `Inactive Teachers — ${branchName}`;
    trendLabel       = "Login Activity";
    baseline         = TEACHER_IDLE_DAYS;
    baselineLabel    = "Active";
    affectedSubtitle = `(5+ days no login)`;

    /* Re-use teachersSnap from cache. Filter to this branch via the same
       canonical resolution + doc-id fallback chain used for students. */
    type IdleTeacher = { name: string; idleDays: number };
    const idle: IdleTeacher[] = [];
    (teachersSnap.docs as any[]).forEach(d => {
      const t = d.data();
      let cid = resolveCanonical(t);
      if (cid !== branchId) cid = anyIdToCanonical.get(d.id) || "";
      if (cid !== branchId && t.uid) cid = anyIdToCanonical.get(t.uid) || "";
      if (cid !== branchId) return;
      if (t.isActive === false || t.status === "Invited") return;
      const lastMs = t.lastLoginAt?.toMillis?.()
        || (typeof t.lastLoginAt === 'string' ? new Date(t.lastLoginAt).getTime() : NaN);
      const idleDays = Number.isFinite(lastMs)
        ? Math.floor((Date.now() - lastMs) / (1000 * 60 * 60 * 24))
        : 999; // never logged in
      if (idleDays >= TEACHER_IDLE_DAYS) {
        idle.push({ name: t.name || t.email || `Teacher ${d.id.slice(-4)}`, idleDays });
      }
    });
    idle.sort((a, b) => b.idleDays - a.idleDays);

    affectedStudents = idle.slice(0, 6).map((t, i) => ({
      initials: t.name.split(" ").map((n: string) => n[0] || "").join("").toUpperCase().slice(0, 2) || "T",
      name: t.name,
      pct: t.idleDays >= 999 ? "Never" : `${t.idleDays}d idle`,
      color: COLORS[i % COLORS.length],
    }));

    trend = [];

    const cronCreatedAtMsTch = docData?.createdAt?.toMillis?.() || null;
    detectedOn = cronCreatedAtMsTch
      ? new Date(cronCreatedAtMsTch).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
      : "Detection pending";
    durationDays = cronCreatedAtMsTch
      ? Math.max(1, Math.floor((Date.now() - cronCreatedAtMsTch) / (1000 * 60 * 60 * 24)))
      : 0;

    const cronIdleCount = typeof docData?.metrics?.idleCount === 'number' ? docData.metrics.idleCount : null;

    description = (docData?.description as string) || (docData?.message as string)
      || `Teacher engagement risk at ${branchName}. ${idle.length || cronIdleCount || 'Multiple'} teachers have not logged in for ${TEACHER_IDLE_DAYS}+ days. Daily attendance + lesson updates may be slipping. A direct check-in with the affected teachers is recommended.`;

    actions = [
      { title: "Reach out to inactive teachers to confirm availability",          sub: "Priority: High • Estimated time: 30 minutes", done: false },
      { title: "Review unmarked attendance / pending lesson plans for their classes", sub: "Priority: High • Estimated time: 1 hour",  done: false },
      { title: "Assign substitute / reassign classes if absence is extended",    sub: "Priority: Medium • As needed",                 done: false },
    ];

    metrics = [
      {
        label: "Inactive Teachers",
        value: (idle.length || cronIdleCount || 0).toString(),
        note: cronIdleCount && idle.length === 0
          ? `${cronIdleCount} flagged by cron · client lookup pending`
          : `Idle 5+ days at ${branchName}`,
        color: "text-amber-500",
      },
      {
        label: "Longest Idle",
        value: idle.length > 0
          ? (idle[0].idleDays >= 999 ? "Never" : `${idle[0].idleDays}d`)
          : "N/A",
        note: idle.length > 0 ? `${idle[0].name}` : "No idle teachers resolved client-side",
        color: "text-[#111827]",
      },
      {
        label: "Duration",
        value: durationDays > 0 ? `${durationDays} day${durationDays !== 1 ? "s" : ""}` : "N/A",
        note: durationDays > 0 ? `Since ${detectedOn}` : "Detection pending",
        color: "text-[#111827]",
      },
    ];
  }

  /* Historical alerts — scoped, sorted by most-recent first, then top 3.
     Previously slice(0, 3) ran BEFORE any sort, so the 3 shown were in
     document-order (effectively random). Sort by resolvedAt desc first. */
  let historicalAlerts: AlertDetailData["historicalAlerts"] = [];
  try {
    const resSnap = await getDocs(query(collection(db, "alert_resolutions"), where("schoolId", "==", uid)));
    historicalAlerts = resSnap.docs
      .map(d => d.data())
      .filter(d => d.action === "resolved")
      .sort((a, b) => (b.resolvedAt?.toMillis?.() || 0) - (a.resolvedAt?.toMillis?.() || 0))
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
    title,
    type: alertType,
    kind: alertKind,
    status: alertType === 'critical' ? 'Critical' : 'Warning',
    branchName, alertNum, detectedOn,
    metrics,
    description, trend, trendLabel, affectedSubtitle, baseline, baselineLabel, affectedStudents, actions,
    historicalAlerts,
    totalStudentsInBranch: totalStudents,
    durationDays,
    mappingIssue,
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
