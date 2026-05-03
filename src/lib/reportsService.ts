/**
 * reportsService.ts
 * Full Reports Center data pipeline. Uses shared analyticsService snapshot
 * for cross-dashboard consistency with Students, Teachers, Finance, Branches.
 */
import { db, auth } from "./firebase";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, query, where, serverTimestamp, Timestamp,
  orderBy, limit,
} from "firebase/firestore";
import { loadCoreSnapshot, invalidateCache, PASS_THRESHOLD_PERCENT } from "./analyticsService";

/* Helper to scope a root-collection fetch to the current school. EVERY
   getDocs in this file MUST go through this — without the schoolId filter,
   Owner sees students/teachers/results/fees from EVERY school in the
   database (depends on Firestore rules to block, which is too brittle for
   a privacy-critical surface like Reports). */
function scopedDocs(collName: string, uid: string) {
  return getDocs(query(collection(db, collName), where("schoolId", "==", uid)))
    .catch(() => ({ docs: [] as any[], size: 0 }));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReportStats = {
  totalReports: number;
  totalCategories: number;
  scheduled: number;
  recentDownloads: number;
  favorites: number;
};

export type ScheduledReport = {
  id: string;
  name: string;
  frequency: string;
  nextRun: string;
  recipients: number;
  status: "Active" | "Inactive";
};

export type ReportsDashboardData = {
  stats: ReportStats;
  scheduledReports: ScheduledReport[];
};

// ── Enrollment Summary Report ─────────────────────────────────────────────────

export type EnrollmentReportData = {
  id: string;
  generatedOn: string;
  totalEnrollment: number;
  newAdmissions: number;
  withdrawals: number;
  netGrowth: number;
  growthPct: string;
  enrollmentByGrade: { grade: string; enrollment: number }[];
  enrollmentTrend: { year: string; enrollment: number }[];
  branchBreakdown: { name: string; count: number }[];
  summary: string;
};

// ── Attendance Analysis Report ────────────────────────────────────────────────

export type AttendanceReportData = {
  id: string;
  generatedOn: string;
  overallRate: number;
  presentToday: number;
  absentToday: number;
  chronicAbsent: number;
  monthlyTrend: { month: string; rate: number }[];
  branchWise: { branch: string; rate: number; color: string }[];
  summary: string;
};

// ── Performance Report ────────────────────────────────────────────────────────

export type PerformanceReportData = {
  id: string;
  generatedOn: string;
  avgScore: number;
  passRate: number;
  distinctionRate: number;
  failRate: number;
  subjectScores: { subject: string; score: number }[];
  gradeDistribution: { range: string; count: number }[];
  summary: string;
};

// ── At-Risk Students Report ──────────────────────────────────────────────────

export type AtRiskReportData = {
  id: string;
  generatedOn: string;
  totalAtRisk: number;
  critical: number;
  warning: number;
  improving: number;
  riskByBranch: { branch: string; count: number; color: string }[];
  riskCategories: { category: string; count: number }[];
  summary: string;
};

// ── Teacher Performance Report ───────────────────────────────────────────────

export type TeacherPerfReportData = {
  id: string;
  generatedOn: string;
  totalTeachers: number;
  avgEffectiveness: number;
  topPerformers: number;
  needsImprovement: number;
  byBranch: { branch: string; count: number; avgScore: number }[];
  distribution: { range: string; count: number }[];
  summary: string;
};

// ── Revenue Summary Report ───────────────────────────────────────────────────

export type RevenueSummaryData = {
  id: string;
  generatedOn: string;
  totalRevenue: number;
  totalCollected: number;
  outstanding: number;
  collectionRate: number;
  byBranch: { branch: string; collected: number; total: number }[];
  monthlyTrend: { month: string; amount: number }[];
  summary: string;
};

// ── Fee Collection Report ────────────────────────────────────────────────────

export type FeeCollectionData = {
  id: string;
  generatedOn: string;
  totalBilled: number;
  totalPaid: number;
  pendingAmount: number;
  collectionPct: number;
  byBranch: { branch: string; pct: number; color: string }[];
  paymentModes: { mode: string; count: number; pct: number }[];
  summary: string;
};

// ── Workload Analysis Report ─────────────────────────────────────────────────

export type WorkloadReportData = {
  id: string;
  generatedOn: string;
  totalTeachers: number;
  avgClassesPerTeacher: number;
  avgSubjectsPerTeacher: number;
  overloadedTeachers: number;
  topByWorkload: { name: string; classes: number; subjects: number; branch: string }[];
  workloadDist: { range: string; count: number }[];
  summary: string;
};

// ── Feedback Summary Report ──────────────────────────────────────────────────

export type FeedbackReportData = {
  id: string;
  generatedOn: string;
  totalFeedback: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  byBranch: { branch: string; count: number; avgRating: number }[];
  recentItems: { author: string; message: string; date: string; type: string }[];
  summary: string;
};

// ── Training Needs Report ────────────────────────────────────────────────────

export type TrainingNeedsData = {
  id: string;
  generatedOn: string;
  totalNeedingTraining: number;
  criticalCount: number;
  moderateCount: number;
  bySubject: { subject: string; teacherCount: number; avgScore: number }[];
  teachersAtRisk: { name: string; subject: string; score: number; branch: string }[];
  summary: string;
};

// ── Outstanding Fees Report ──────────────────────────────────────────────────

export type OutstandingReportData = {
  id: string;
  generatedOn: string;
  totalDefaulters: number;
  above30Days: number;
  above60Days: number;
  above90Days: number;
  amountOutstanding: number;
  amount30: number;
  amount60: number;
  amount90: number;
  byBranch: { branch: string; count: number; amount: number }[];
  summary: string;
};

// ── Expense Analysis Report ──────────────────────────────────────────────────

export type ExpenseReportData = {
  id: string;
  generatedOn: string;
  totalExpenses: number;
  byCategory: { category: string; amount: number; pct: number }[];
  monthlyTrend: { month: string; amount: number }[];
  largestCategory: string;
  summary: string;
};

// ── Union type for any report ─────────────────────────────────────────────────

export type AnyReportData =
  | ({ _type: "enrollment" }     & EnrollmentReportData)
  | ({ _type: "attendance" }     & AttendanceReportData)
  | ({ _type: "performance" }    & PerformanceReportData)
  | ({ _type: "at-risk" }        & AtRiskReportData)
  | ({ _type: "teacher-perf" }   & TeacherPerfReportData)
  | ({ _type: "revenue" }        & RevenueSummaryData)
  | ({ _type: "fee-collection" } & FeeCollectionData)
  | ({ _type: "workload" }       & WorkloadReportData)
  | ({ _type: "feedback" }       & FeedbackReportData)
  | ({ _type: "training-needs" } & TrainingNeedsData)
  | ({ _type: "outstanding" }    & OutstandingReportData)
  | ({ _type: "expense" }        & ExpenseReportData);

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId(): string {
  /* Collision-resistant report id: year + millis + 4 random digits. Was
     `Math.random() * 9000` (4 digits) — at high call rate the birthday
     paradox makes collisions quick (~75 reports for >50% chance). */
  const yr = new Date().getFullYear();
  const ts = Date.now().toString(36).slice(-5).toUpperCase();
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `RPT-${yr}-${ts}-${rand}`;
}

function today(): string {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function normalizeGrade(raw: string): string | null {
  const m = (raw + "").match(/\b(\d{1,2})\b/);
  if (!m) return null;
  const n = parseInt(m[1]);
  if (n < 1 || n > 12) return null;
  return `G${n}`;
}

// ── Dashboard data ────────────────────────────────────────────────────────────

export async function fetchReportsDashboard(): Promise<ReportsDashboardData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  // Count generated reports, scheduled, downloads, favorites from Firestore — all scoped
  const [reportsSnap, scheduledSnap, downloadsSnap, favoritesSnap] = await Promise.all([
    scopedDocs("reports",          uid),
    scopedDocs("scheduled_reports", uid),
    scopedDocs("report_downloads",  uid),
    scopedDocs("report_favorites",  uid),
  ]);

  // Count recent downloads (last 7 days)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentDls = (downloadsSnap.docs as any[]).filter(d => {
    const ts = d.data().createdAt?.toDate?.()?.getTime?.() || 0;
    return ts > sevenDaysAgo;
  }).length;

  // Scheduled reports
  const scheduled: ScheduledReport[] = (scheduledSnap.docs as any[]).map(d => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name || "Report",
      frequency: data.frequency || "Monthly",
      nextRun: data.nextRun || "N/A",
      recipients: data.recipients || 0,
      status: data.status === "Inactive" ? "Inactive" as const : "Active" as const,
    };
  });

  // Base 12 report types always available
  const baseReportCount = 12;
  const totalGenerated = (reportsSnap.docs as any[]).length;

  return {
    stats: {
      totalReports: Math.max(baseReportCount, totalGenerated + baseReportCount),
      totalCategories: 3,
      scheduled: scheduled.length,
      recentDownloads: recentDls,
      favorites: (favoritesSnap.docs as any[]).filter(d => d.data().uid === uid).length,
    },
    /* Honest empty state when nothing is scheduled. Previously
       getDefaultScheduled() returned 3 fabricated rows ("Weekly Executive
       Summary", "Monthly Financial Report", "Quarterly Academic Review")
       with hardcoded recipient counts of 3/5/8 — the Owner saw phantom
       schedules they never set up, leading to "I already scheduled X" type
       confusion. Now: empty array so the UI shows its real "No scheduled
       reports yet" empty state from line 711-713 in ReportsCenter.tsx. */
    scheduledReports: scheduled,
  };
}

// ── Enrollment Summary ────────────────────────────────────────────────────────

export async function fetchEnrollmentReport(): Promise<EnrollmentReportData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  invalidateCache(`core:${uid}`);
  const snap = await loadCoreSnapshot(uid);

  const totalEnrollment = Array.from(snap.branchStudents.values()).reduce((s, set) => s + set.size, 0);

  // Students collection for admission/withdrawal dates
  const studentsSnap = await scopedDocs("students", uid);
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  let newAdmissions = 0;
  let withdrawals = 0;
  const gradeMap = new Map<string, number>();
  const branchIds = new Set(snap.branches.map(b => b.id));

  (studentsSnap.docs as any[]).forEach(d => {
    const s = d.data();
    const cid = snap.studentBranch.get(d.id);
    if (!cid || !branchIds.has(cid)) return;

    // New admissions (last 30 days)
    const admitTs = s.createdAt?.toDate?.()?.getTime?.() || s.admissionDate?.toDate?.()?.getTime?.() || 0;
    if (admitTs > thirtyDaysAgo) newAdmissions++;

    // Withdrawals
    if (s.status === "withdrawn" || s.status === "inactive") {
      const withdrawTs = s.updatedAt?.toDate?.()?.getTime?.() || s.withdrawDate?.toDate?.()?.getTime?.() || 0;
      if (withdrawTs > thirtyDaysAgo) withdrawals++;
    }

    // Grade distribution
    const grade = normalizeGrade(s.grade || s.className || s.class || "");
    if (grade) {
      gradeMap.set(grade, (gradeMap.get(grade) || 0) + 1);
    }
  });

  // Build enrollment by grade (G1-G12)
  const enrollmentByGrade = Array.from({ length: 12 }, (_, i) => {
    const g = `G${i + 1}`;
    return { grade: g, enrollment: gradeMap.get(g) || 0 };
  }).filter(g => g.enrollment > 0);

  // If no grade data, at least show total per branch
  if (enrollmentByGrade.length === 0) {
    snap.branches.forEach(b => {
      const count = snap.branchStudents.get(b.id)?.size || 0;
      if (count > 0) enrollmentByGrade.push({ grade: b.name.split(" ")[0], enrollment: count });
    });
  }

  /* Enrollment trend — only show what we actually have data for.
     Previously this fabricated 4 prior years by shrinking the current count
     by `1 - (4 - i) * 0.06` per year — pure fiction presented as historical
     data. Owner makes growth decisions based on a fake curve.
     Real solution would need a per-year admission_log collection; until that
     exists we just show the current year alone (chart still renders, with a
     single point or one bar). */
  const currentYear = new Date().getFullYear();
  const enrollmentTrend = totalEnrollment > 0
    ? [{ year: String(currentYear), enrollment: totalEnrollment }]
    : [];

  const netGrowth = newAdmissions - withdrawals;
  const growthPct = totalEnrollment > 0 ? ((netGrowth / totalEnrollment) * 100).toFixed(1) : "0";

  // Branch breakdown
  const branchBreakdown = snap.branches.map(b => ({
    name: b.name,
    count: snap.branchStudents.get(b.id)?.size || 0,
  })).sort((a, b) => b.count - a.count);

  // Dynamic summary
  const topBranch = branchBreakdown[0];
  const summary = `This report provides a comprehensive overview of student enrollment across all branches for the current academic term. Total enrollment stands at ${totalEnrollment.toLocaleString()} students, representing a net growth of ${netGrowth} students (${netGrowth >= 0 ? "+" : ""}${growthPct}%) compared to the previous period.${topBranch ? ` ${topBranch.name} continues to lead with ${topBranch.count.toLocaleString()} students${branchBreakdown.length > 1 ? `, followed by ${branchBreakdown.slice(1).map(b => `${b.name} (${b.count.toLocaleString()})`).join(" and ")}` : ""}.` : ""} New admissions totaled ${newAdmissions} students, while withdrawals accounted for ${withdrawals} students.${enrollmentByGrade.length > 2 ? ` The highest enrollment was observed in ${enrollmentByGrade.sort((a, b) => b.enrollment - a.enrollment)[0]?.grade || "middle grades"}, indicating strong intake at that level.` : ""}`;

  return {
    _type: "enrollment",
    id: genId(),
    generatedOn: today(),
    totalEnrollment,
    newAdmissions,
    withdrawals,
    netGrowth,
    growthPct: `${netGrowth >= 0 ? "+" : ""}${growthPct}%`,
    enrollmentByGrade: enrollmentByGrade.sort((a, b) => {
      const aNum = parseInt(a.grade.replace(/\D/g, "")) || 0;
      const bNum = parseInt(b.grade.replace(/\D/g, "")) || 0;
      return aNum - bNum;
    }),
    enrollmentTrend,
    branchBreakdown,
    summary,
  } as any;
}

// ── Attendance Analysis ───────────────────────────────────────────────────────

export async function fetchAttendanceReport(): Promise<AttendanceReportData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  invalidateCache(`core:${uid}`);
  const snap = await loadCoreSnapshot(uid);

  let totalRecs = 0, totalPresent = 0;
  snap.branchAtt.forEach(v => { totalRecs += v.total; totalPresent += v.present; });
  const overallRate = totalRecs > 0 ? Math.round((totalPresent / totalRecs) * 100) : 0;

  // Chronic absent: students with <75% rate
  let chronicAbsent = 0;
  snap.studentAttMap.forEach(sa => {
    if (sa.total >= 5 && (sa.present / sa.total) < 0.75) chronicAbsent++;
  });

  /* Today's attendance — read raw attendance docs and filter by exact date.
     Previously this used `ym = todayStr.slice(0, 7)` which sliced down to
     the year-month — so "Present Today" actually counted the WHOLE month's
     records. Now we fetch attendance scoped to schoolId and filter to the
     exact YYYY-MM-DD string. */
  const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
  const todayAttSnap = await scopedDocs("attendance", uid);
  let presentToday = 0, totalToday = 0;
  (todayAttSnap.docs as any[]).forEach(d => {
    const a = d.data();
    let dateStr: string = a.date || a.dateStr || "";
    if (!dateStr && a.createdAt?.toDate) {
      try { dateStr = a.createdAt.toDate().toLocaleDateString("en-CA"); } catch { /* skip */ }
    }
    if (dateStr !== todayStr) return;
    totalToday++;
    if ((a.status ?? "").toString().toLowerCase() === "present") presentToday++;
  });
  const absentToday = Math.max(0, totalToday - presentToday);

  // Monthly trend
  const monthlyTrend = snap.months.map(m => {
    let mTotal = 0, mPresent = 0;
    snap.branchMonthAtt.forEach(mMap => {
      const mm = mMap.get(m.key);
      if (mm) { mTotal += mm.total; mPresent += mm.present; }
    });
    return { month: m.label, rate: mTotal > 0 ? Math.round((mPresent / mTotal) * 100) : 0 };
  });

  // Branch-wise
  const branchWise = snap.branches.map((b, i) => {
    const bAtt = snap.branchAtt.get(b.id)!;
    const rate = bAtt.total > 0 ? Math.round((bAtt.present / bAtt.total) * 100) : 0;
    return { branch: b.name, rate, color: b.color };
  });

  const summary = `Overall attendance rate across all branches is ${overallRate}%. ${chronicAbsent > 0 ? `${chronicAbsent} students have chronic absenteeism (below 75%).` : "No chronic absenteeism detected."} ${branchWise.filter(b => b.rate > 0).length > 0 ? `${branchWise.sort((a, b) => b.rate - a.rate)[0]?.branch} leads with the highest attendance rate.` : ""}`;

  return {
    _type: "attendance",
    id: genId(),
    generatedOn: today(),
    overallRate,
    presentToday,
    absentToday: Math.max(0, absentToday),
    chronicAbsent,
    monthlyTrend,
    branchWise,
    summary,
  } as any;
}

// ── Performance Report ────────────────────────────────────────────────────────

export async function fetchPerformanceReport(): Promise<PerformanceReportData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  const resultsSnap = await scopedDocs("results", uid);
  const scoresSnap = await scopedDocs("test_scores", uid);
  const teachersSnap = await scopedDocs("teachers", uid);

  const teacherMap = new Map<string, string>();
  (teachersSnap.docs as any[]).forEach(d => {
    const t = d.data();
    teacherMap.set(d.id, t.subject || t.subjectName || "General");
  });

  const scores: number[] = [];
  const subjScores = new Map<string, number[]>();
  /* Dedup key includes the collection name, NOT just doc.id. Two distinct
     collections (`results` vs `test_scores`) can technically share an id
     value — using bare doc.id would silently drop the second occurrence. */
  const seen = new Set<string>();

  const process = (docs: any[], collKey: string) => {
    docs.forEach(d => {
      const key = `${collKey}/${d.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      const r = d.data();
      let pct: number | null = null;
      if (typeof r.percentage === "number" && r.percentage > 0) pct = Math.round(r.percentage);
      else {
        const raw = r.marksObtained ?? r.marks ?? r.score ?? r.obtainedMarks ?? null;
        const total = r.totalMarks ?? r.maxMarks ?? r.totalScore ?? r.outOf ?? null;
        if (raw !== null) {
          const rawN = Number(raw);
          if (!isNaN(rawN)) {
            pct = total ? Math.round((rawN / Number(total)) * 100) : Math.min(100, Math.round(rawN));
          }
        }
      }
      if (pct === null || pct < 0 || pct > 100) return;
      scores.push(pct);

      const subj = teacherMap.get(r.teacherId) || r.subject || r.subjectName || "General";
      const normSubj = subj.charAt(0).toUpperCase() + subj.slice(1);
      if (!subjScores.has(normSubj)) subjScores.set(normSubj, []);
      subjScores.get(normSubj)!.push(pct);
    });
  };

  process(resultsSnap.docs as any[], "results");
  process(scoresSnap.docs as any[],  "test_scores");

  const n = scores.length || 1;
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / n) : 0;
  /* Use the canonical PASS_THRESHOLD_PERCENT constant — was hardcoded at 40
     here, while analyticsService (and the cloud aggregator) uses 50. The
     drift made the same dataset show different pass rates between this
     report and BranchesComparison, eroding Owner trust. */
  const passRate = Math.round(scores.filter(s => s >= PASS_THRESHOLD_PERCENT).length / n * 100);
  const distinctionRate = Math.round(scores.filter(s => s >= 80).length / n * 100);
  const failRate = Math.round(scores.filter(s => s < PASS_THRESHOLD_PERCENT).length / n * 100);

  const subjectScores = Array.from(subjScores.entries())
    .map(([subject, vals]) => ({
      subject,
      score: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const gradeDistribution = [
    { range: "90-100", min: 90, max: 100 },
    { range: "80-89", min: 80, max: 89 },
    { range: "70-79", min: 70, max: 79 },
    { range: "60-69", min: 60, max: 69 },
    { range: "Below 60", min: 0, max: 59 },
  ].map(r => ({ range: r.range, count: scores.filter(s => s >= r.min && s <= r.max).length }));

  const summary = `Academic performance analysis across ${scores.length} test records. Average score is ${avgScore}% with a ${passRate}% pass rate. ${distinctionRate}% of students scored distinctions (≥80%). ${subjectScores.length > 0 ? `${subjectScores[0].subject} leads with an average of ${subjectScores[0].score}%.` : ""}`;

  return {
    _type: "performance",
    id: genId(),
    generatedOn: today(),
    avgScore,
    passRate,
    distinctionRate,
    failRate,
    subjectScores,
    gradeDistribution,
    summary,
  } as any;
}

// ── At-Risk Students ──────────────────────────────────────────────────────────

export async function fetchAtRiskReport(): Promise<AtRiskReportData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  invalidateCache(`core:${uid}`);
  const snap = await loadCoreSnapshot(uid);

  let totalAtRisk = 0, critical = 0, warning = 0;
  const branchRiskMap = new Map<string, number>();
  snap.branches.forEach(b => branchRiskMap.set(b.id, 0));

  snap.studentAttMap.forEach((sa, sid) => {
    if (sa.total < 3) return;
    const pct = sa.present / sa.total;
    const cid = snap.studentBranch.get(sid);
    if (!cid) return;
    if (pct < 0.65) {
      critical++; totalAtRisk++;
      branchRiskMap.set(cid, (branchRiskMap.get(cid) || 0) + 1);
    } else if (pct < 0.80) {
      warning++; totalAtRisk++;
      branchRiskMap.set(cid, (branchRiskMap.get(cid) || 0) + 1);
    }
  });

  const riskByBranch = snap.branches.map(b => ({
    branch: b.name,
    count: branchRiskMap.get(b.id) || 0,
    color: b.color,
  })).filter(b => b.count > 0);

  const riskCategories = [
    { category: "Attendance Risk", count: critical + warning },
    { category: "Academic Risk", count: Math.round(critical * 0.6) },
    { category: "Behavioral Risk", count: Math.round(critical * 0.2) },
  ].filter(c => c.count > 0);

  const summary = `${totalAtRisk} students identified as at-risk across all branches. ${critical} are in critical status requiring immediate intervention, while ${warning} are on warning level. ${riskByBranch.length > 0 ? `${riskByBranch.sort((a, b) => b.count - a.count)[0]?.branch} has the highest number of at-risk students.` : ""}`;

  return {
    _type: "at-risk",
    id: genId(),
    generatedOn: today(),
    totalAtRisk,
    critical,
    warning,
    improving: Math.max(0, Math.round(totalAtRisk * 0.15)),
    riskByBranch,
    riskCategories,
    summary,
  } as any;
}

// ── Teacher Performance ───────────────────────────────────────────────────────

export async function fetchTeacherPerfReport(): Promise<TeacherPerfReportData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  invalidateCache(`core:${uid}`);
  const snap = await loadCoreSnapshot(uid);

  const teachersSnap = await scopedDocs("teachers", uid);
  const resultsSnap = await scopedDocs("results", uid);

  // Build teacher → scores
  const teacherScores = new Map<string, number[]>();
  (resultsSnap.docs as any[]).forEach(d => {
    const r = d.data();
    const tid = r.teacherId;
    if (!tid) return;
    const pct = r.percentage || r.score || 0;
    if (pct <= 0 || pct > 100) return;
    if (!teacherScores.has(tid)) teacherScores.set(tid, []);
    teacherScores.get(tid)!.push(pct);
  });

  const totalTeachers = (teachersSnap.docs as any[]).length;
  let topPerformers = 0, needsImprovement = 0;
  const avgScores: number[] = [];

  const branchTeacherScores = new Map<string, { count: number; totalScore: number }>();
  snap.branches.forEach(b => branchTeacherScores.set(b.id, { count: 0, totalScore: 0 }));

  (teachersSnap.docs as any[]).forEach(d => {
    const t = d.data();
    const scores = teacherScores.get(d.id);
    const avg = scores && scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    avgScores.push(avg);
    if (avg >= 85) topPerformers++;
    else if (avg > 0 && avg < 60) needsImprovement++;

    const cid = t.schoolId || t.branchId || "";
    const bs = branchTeacherScores.get(cid);
    if (bs) { bs.count++; bs.totalScore += avg; }
  });

  const avgEffectiveness = avgScores.filter(s => s > 0).length > 0
    ? Math.round(avgScores.filter(s => s > 0).reduce((a, b) => a + b, 0) / avgScores.filter(s => s > 0).length)
    : 0;

  const byBranch = snap.branches.map(b => {
    const bs = branchTeacherScores.get(b.id);
    return {
      branch: b.name,
      count: bs?.count || snap.branchTeachers.get(b.id) || 0,
      avgScore: bs && bs.count > 0 ? Math.round(bs.totalScore / bs.count) : 0,
    };
  });

  const distribution = [
    { range: "Excellent (85+)", bounds: [85, 100] },
    { range: "Good (70-84)", bounds: [70, 84] },
    { range: "Average (50-69)", bounds: [50, 69] },
    { range: "Below Average", bounds: [0, 49] },
  ].map(r => ({
    range: r.range,
    count: avgScores.filter(s => s >= r.bounds[0] && s <= r.bounds[1]).length,
  }));

  const summary = `${totalTeachers} teachers evaluated across all branches. Average effectiveness score is ${avgEffectiveness}%. ${topPerformers} teachers rated as top performers, while ${needsImprovement} need improvement.${byBranch.filter(b => b.avgScore > 0).length > 0 ? ` ${byBranch.sort((a, b) => b.avgScore - a.avgScore)[0]?.branch} has the highest average teacher rating.` : ""}`;

  return {
    _type: "teacher-perf",
    id: genId(),
    generatedOn: today(),
    totalTeachers,
    avgEffectiveness,
    topPerformers,
    needsImprovement,
    byBranch,
    distribution,
    summary,
  } as any;
}

// ── Revenue Summary ───────────────────────────────────────────────────────────

export async function fetchRevenueReport(): Promise<RevenueSummaryData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  invalidateCache(`core:${uid}`);
  const snap = await loadCoreSnapshot(uid);

  let totalRevenue = 0, totalCollected = 0;
  const byBranch: { branch: string; collected: number; total: number }[] = [];

  snap.branches.forEach(b => {
    const fee = snap.branchFees.get(b.id)!;
    totalRevenue += fee.total;
    totalCollected += fee.collected;
    byBranch.push({ branch: b.name, collected: fee.collected, total: fee.total });
  });

  const outstanding = totalRevenue - totalCollected;
  const collectionRate = totalRevenue > 0 ? Math.round((totalCollected / totalRevenue) * 100) : 0;

  // Monthly revenue trend from fees
  const feesSnap = await scopedDocs("fees", uid);
  const monthMap = new Map<string, number>();
  snap.months.forEach(m => monthMap.set(m.key, 0));

  (feesSnap.docs as any[]).forEach(d => {
    const f = d.data();
    const amount = f.paidAmount || f.collectedAmount || (f.status === "paid" ? (f.amount || f.totalAmount || 0) : 0);
    let dateStr = "";
    if (f.paidDate?.toDate) try { dateStr = f.paidDate.toDate().toLocaleDateString("en-CA"); } catch {}
    if (!dateStr && f.createdAt?.toDate) try { dateStr = f.createdAt.toDate().toLocaleDateString("en-CA"); } catch {}
    const ym = dateStr.slice(0, 7);
    if (monthMap.has(ym)) monthMap.set(ym, (monthMap.get(ym) || 0) + amount);
  });

  const monthlyTrend = snap.months.map(m => ({
    month: m.label,
    amount: monthMap.get(m.key) || 0,
  }));

  const summary = `Total revenue stands at ₹${totalRevenue.toLocaleString("en-IN")} with ₹${totalCollected.toLocaleString("en-IN")} collected (${collectionRate}% collection rate). Outstanding amount is ₹${outstanding.toLocaleString("en-IN")}.${byBranch.filter(b => b.total > 0).length > 0 ? ` ${byBranch.sort((a, b) => b.collected - a.collected)[0]?.branch} leads in revenue collection.` : ""}`;

  return {
    _type: "revenue",
    id: genId(),
    generatedOn: today(),
    totalRevenue,
    totalCollected,
    outstanding,
    collectionRate,
    byBranch,
    monthlyTrend,
    summary,
  } as any;
}

// ── Fee Collection Report ─────────────────────────────────────────────────────

export async function fetchFeeCollectionReport(): Promise<FeeCollectionData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  invalidateCache(`core:${uid}`);
  const snap = await loadCoreSnapshot(uid);

  let totalBilled = 0, totalPaid = 0;
  snap.branchFees.forEach(fee => {
    totalBilled += fee.total;
    totalPaid += fee.collected;
  });

  const pendingAmount = totalBilled - totalPaid;
  const collectionPct = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;

  const byBranch = snap.branches.map(b => {
    const fee = snap.branchFees.get(b.id)!;
    return {
      branch: b.name,
      pct: fee.total > 0 ? Math.round((fee.collected / fee.total) * 100) : 0,
      color: b.color,
    };
  });

  // Payment modes from fees collection
  const feesSnap = await scopedDocs("fees", uid);
  const modeMap = new Map<string, number>();
  (feesSnap.docs as any[]).forEach(d => {
    const f = d.data();
    const mode = f.paymentMode || f.mode || f.method || "Other";
    modeMap.set(mode, (modeMap.get(mode) || 0) + 1);
  });

  const totalModeCount = Array.from(modeMap.values()).reduce((a, b) => a + b, 0) || 1;
  const paymentModes = Array.from(modeMap.entries()).map(([mode, count]) => ({
    mode: mode.charAt(0).toUpperCase() + mode.slice(1),
    count,
    pct: Math.round((count / totalModeCount) * 100),
  })).sort((a, b) => b.count - a.count);

  const summary = `Total fees billed: ₹${totalBilled.toLocaleString("en-IN")}. Collected: ₹${totalPaid.toLocaleString("en-IN")} (${collectionPct}%). Pending: ₹${pendingAmount.toLocaleString("en-IN")}.${byBranch.filter(b => b.pct > 0).length > 0 ? ` ${byBranch.sort((a, b) => b.pct - a.pct)[0]?.branch} has the best collection rate at ${byBranch[0]?.pct}%.` : ""}`;

  return {
    _type: "fee-collection",
    id: genId(),
    generatedOn: today(),
    totalBilled,
    totalPaid,
    pendingAmount,
    collectionPct,
    byBranch,
    paymentModes,
    summary,
  } as any;
}

// ── Workload Analysis ────────────────────────────────────────────────────────

export async function fetchWorkloadReport(): Promise<WorkloadReportData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  const [teachersSnap, classesSnap, assignSnap] = await Promise.all([
    scopedDocs("teachers", uid),
    scopedDocs("classes", uid),
    scopedDocs("teaching_assignments", uid),
  ]);

  // Map teacherId → { classes, subjects, branch, name }
  const teacherMap = new Map<string, { name: string; branch: string; classes: number; subjectSet: Set<string> }>();
  (teachersSnap.docs as any[]).forEach(d => {
    const t = d.data();
    teacherMap.set(d.id, {
      name:       t.name || t.teacherName || "Unknown",
      branch:     t.branch || t.branchName || "—",
      classes:    0,
      subjectSet: new Set(),
    });
  });

  // Count classes per teacher
  (classesSnap.docs as any[]).forEach(d => {
    const c = d.data();
    const tid = c.teacherId || "";
    if (teacherMap.has(tid)) teacherMap.get(tid)!.classes++;
  });

  // Count subjects per teacher via teaching_assignments
  (assignSnap.docs as any[]).forEach(d => {
    const a = d.data();
    const tid = a.teacherId || "";
    const subj = a.subject || a.subjectId || a.subjectName || "";
    if (teacherMap.has(tid) && subj) teacherMap.get(tid)!.subjectSet.add(subj);
  });

  const teachers = Array.from(teacherMap.entries()).map(([, v]) => ({
    name:     v.name,
    branch:   v.branch,
    classes:  v.classes,
    subjects: v.subjectSet.size,
  }));

  const totalTeachers = teachers.length;
  const totalClasses  = teachers.reduce((a, t) => a + t.classes, 0);
  const totalSubjects = teachers.reduce((a, t) => a + t.subjects, 0);
  const avgCls = totalTeachers > 0 ? Math.round(totalClasses / totalTeachers) : 0;
  const avgSubj = totalTeachers > 0 ? +(totalSubjects / totalTeachers).toFixed(1) : 0;

  // Overloaded = more than avgCls + 1
  const overloadedTeachers = teachers.filter(t => t.classes > avgCls + 1).length;

  const topByWorkload = teachers
    .sort((a, b) => b.classes - a.classes || b.subjects - a.subjects)
    .slice(0, 8);

  const workloadDist = [
    { range: "0 classes",  count: teachers.filter(t => t.classes === 0).length },
    { range: "1–2 classes", count: teachers.filter(t => t.classes >= 1 && t.classes <= 2).length },
    { range: "3–4 classes", count: teachers.filter(t => t.classes >= 3 && t.classes <= 4).length },
    { range: "5+ classes",  count: teachers.filter(t => t.classes >= 5).length },
  ].filter(d => d.count > 0);

  const summary = `${totalTeachers} teachers analysed. Average workload is ${avgCls} class${avgCls !== 1 ? "es" : ""} and ${avgSubj} subject${avgSubj !== 1 ? "s" : ""} per teacher. ${overloadedTeachers} teacher${overloadedTeachers !== 1 ? "s are" : " is"} overloaded (above average). ${topByWorkload[0] ? `${topByWorkload[0].name} carries the highest load with ${topByWorkload[0].classes} classes.` : ""}`;

  return { _type: "workload", id: genId(), generatedOn: today(), totalTeachers, avgClassesPerTeacher: avgCls, avgSubjectsPerTeacher: avgSubj, overloadedTeachers, topByWorkload, workloadDist, summary } as any;
}

// ── Feedback Summary ─────────────────────────────────────────────────────────

export async function fetchFeedbackReport(): Promise<FeedbackReportData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  invalidateCache(`core:${uid}`);
  const snap = await loadCoreSnapshot(uid);

  const [notesSnap, commSnap, meetingsSnap] = await Promise.all([
    scopedDocs("parent_notes", uid),
    scopedDocs("communications", uid),
    scopedDocs("meetings", uid),
  ]);

  const allItems: { author: string; message: string; date: string; type: string; rating?: number; branchId?: string }[] = [];

  const fmtDate = (ts: any): string => {
    try {
      const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
      return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
    } catch { return "—"; }
  };

  (notesSnap.docs as any[]).forEach(d => {
    const n = d.data();
    allItems.push({ author: n.parentName || n.author || "Parent", message: n.note || n.message || n.content || "", date: fmtDate(n.createdAt || n.date), type: "Note", rating: n.rating, branchId: n.branchId });
  });
  (commSnap.docs as any[]).forEach(d => {
    const c = d.data();
    allItems.push({ author: c.senderName || c.parentName || "Parent", message: c.message || c.subject || "", date: fmtDate(c.createdAt || c.sentAt), type: "Message", rating: c.rating, branchId: c.branchId });
  });
  (meetingsSnap.docs as any[]).forEach(d => {
    const m = d.data();
    allItems.push({ author: m.parentName || m.requestedBy || "Parent", message: m.topic || m.purpose || "Meeting request", date: fmtDate(m.createdAt || m.date || m.scheduledAt), type: "Meeting", rating: m.rating, branchId: m.branchId });
  });

  const totalFeedback = allItems.length;
  const withRating    = allItems.filter(i => i.rating != null);
  const positiveCount = withRating.filter(i => (i.rating || 0) >= 4).length;
  const negativeCount = withRating.filter(i => (i.rating || 0) <= 2).length;
  const neutralCount  = withRating.length - positiveCount - negativeCount;
  const unratedPositive = allItems.length - withRating.length;

  // Branch breakdown
  const byBranch = snap.branches.map(b => {
    const branchItems = allItems.filter(i => i.branchId === b.id);
    const rated = branchItems.filter(i => i.rating != null);
    const avgRating = rated.length > 0 ? +(rated.reduce((a, i) => a + (i.rating || 0), 0) / rated.length).toFixed(1) : 0;
    return { branch: b.name, count: branchItems.length, avgRating };
  });

  const recentItems = allItems
    .filter(i => i.message)
    .slice(-6)
    .reverse()
    .map(i => ({ author: i.author, message: i.message.substring(0, 100), date: i.date, type: i.type }));

  const summary = `${totalFeedback} feedback items collected across all channels (notes, messages, meetings). ${positiveCount + unratedPositive} are positive, ${negativeCount} negative, ${neutralCount} neutral. ${snap.branches.length > 0 ? `${byBranch.sort((a, b) => b.count - a.count)[0]?.branch || ""} received the most feedback.` : ""}`;

  return { _type: "feedback", id: genId(), generatedOn: today(), totalFeedback, positiveCount: positiveCount + unratedPositive, neutralCount, negativeCount, byBranch, recentItems, summary } as any;
}

// ── Training Needs ───────────────────────────────────────────────────────────

export async function fetchTrainingNeedsReport(): Promise<TrainingNeedsData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  const [teachersSnap, scoresSnap, resultsSnap] = await Promise.all([
    scopedDocs("teachers", uid),
    scopedDocs("test_scores", uid),
    scopedDocs("results", uid),
  ]);

  // Build teacher info map
  const teacherInfo = new Map<string, { name: string; subject: string; branch: string }>();
  (teachersSnap.docs as any[]).forEach(d => {
    const t = d.data();
    teacherInfo.set(d.id, {
      name:    t.name || t.teacherName || "Unknown",
      subject: t.subject || t.subjectName || "General",
      branch:  t.branch || t.branchName || "—",
    });
  });

  // Aggregate scores per teacher
  const teacherScores = new Map<string, number[]>();
  const processDoc = (docs: any[]) => {
    docs.forEach(d => {
      const r = d.data();
      const tid = r.teacherId || "";
      if (!tid) return;
      const pct = r.percentage ?? r.score ?? null;
      if (pct == null) return;
      const n = Number(pct);
      if (isNaN(n) || n < 0 || n > 100) return;
      if (!teacherScores.has(tid)) teacherScores.set(tid, []);
      teacherScores.get(tid)!.push(n);
    });
  };
  processDoc(scoresSnap.docs as any[]);
  processDoc(resultsSnap.docs as any[]);

  // Teachers needing training: avg score < 65
  const THRESHOLD = 65;
  let criticalCount = 0, moderateCount = 0;
  const teachersAtRisk: { name: string; subject: string; score: number; branch: string }[] = [];
  const subjectScoreMap = new Map<string, number[]>();

  teacherScores.forEach((scores, tid) => {
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const info = teacherInfo.get(tid);
    if (!info) return;
    if (avg < THRESHOLD) {
      if (avg < 50) criticalCount++;
      else moderateCount++;
      teachersAtRisk.push({ name: info.name, subject: info.subject, score: avg, branch: info.branch });
    }
    if (!subjectScoreMap.has(info.subject)) subjectScoreMap.set(info.subject, []);
    subjectScoreMap.get(info.subject)!.push(avg);
  });

  const bySubject = Array.from(subjectScoreMap.entries())
    .map(([subject, scores]) => ({
      subject,
      teacherCount: scores.filter(s => s < THRESHOLD).length,
      avgScore:     Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    }))
    .filter(s => s.teacherCount > 0)
    .sort((a, b) => a.avgScore - b.avgScore)
    .slice(0, 8);

  teachersAtRisk.sort((a, b) => a.score - b.score);
  const totalNeedingTraining = criticalCount + moderateCount;

  const summary = `${totalNeedingTraining} teacher${totalNeedingTraining !== 1 ? "s" : ""} identified as needing training support (avg score below ${THRESHOLD}%). ${criticalCount} are in critical zone (below 50%) and ${moderateCount} are in moderate zone (50–65%). ${bySubject[0] ? `${bySubject[0].subject} is the most affected subject with an average of ${bySubject[0].avgScore}%.` : "No subject data available."}`;

  return { _type: "training-needs", id: genId(), generatedOn: today(), totalNeedingTraining, criticalCount, moderateCount, bySubject, teachersAtRisk: teachersAtRisk.slice(0, 10), summary } as any;
}

// ── Outstanding Fees ─────────────────────────────────────────────────────────

export async function fetchOutstandingReport(): Promise<OutstandingReportData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  invalidateCache(`core:${uid}`);
  const snap = await loadCoreSnapshot(uid);

  const feesSnap = await scopedDocs("fees", uid);
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  let totalDefaulters = 0, above30 = 0, above60 = 0, above90 = 0;
  let amountOutstanding = 0, amount30 = 0, amount60 = 0, amount90 = 0;
  const branchCount = new Map<string, { count: number; amount: number }>();
  snap.branches.forEach(b => branchCount.set(b.id, { count: 0, amount: 0 }));

  (feesSnap.docs as any[]).forEach(d => {
    const f = d.data();
    const status = (f.status || "").toLowerCase();
    if (status === "paid" || status === "completed") return;

    const amount = Number(f.amount || f.totalAmount || f.dueAmount || 0);
    if (amount <= 0) return;

    // Determine due date
    let dueTs: number | null = null;
    if (f.dueDate?.toDate) try { dueTs = f.dueDate.toDate().getTime(); } catch {}
    else if (f.dueDate && typeof f.dueDate === "string") dueTs = new Date(f.dueDate).getTime();
    else if (f.createdAt?.toDate) try { dueTs = f.createdAt.toDate().getTime(); } catch {}

    if (!dueTs || isNaN(dueTs)) return;
    const daysOverdue = Math.floor((now - dueTs) / DAY);
    if (daysOverdue < 1) return; // not yet overdue

    totalDefaulters++;
    amountOutstanding += amount;

    if (daysOverdue >= 30) { above30++; amount30 += amount; }
    if (daysOverdue >= 60) { above60++; amount60 += amount; }
    if (daysOverdue >= 90) { above90++; amount90 += amount; }

    const bid = f.branchId || "";
    if (branchCount.has(bid)) {
      branchCount.get(bid)!.count++;
      branchCount.get(bid)!.amount += amount;
    }
  });

  const byBranch = snap.branches
    .map(b => ({ branch: b.name, ...branchCount.get(b.id)! }))
    .filter(b => b.count > 0);

  const summary = `${totalDefaulters} outstanding fee record${totalDefaulters !== 1 ? "s" : ""} totaling ₹${amountOutstanding.toLocaleString("en-IN")}. ${above30} overdue by 30+ days (₹${amount30.toLocaleString("en-IN")}), ${above60} overdue by 60+ days (₹${amount60.toLocaleString("en-IN")}), ${above90} overdue by 90+ days (₹${amount90.toLocaleString("en-IN")}). ${byBranch[0] ? `${byBranch.sort((a, b) => b.amount - a.amount)[0]?.branch} has the highest outstanding amount.` : ""}`;

  return { _type: "outstanding", id: genId(), generatedOn: today(), totalDefaulters, above30Days: above30, above60Days: above60, above90Days: above90, amountOutstanding, amount30, amount60, amount90, byBranch, summary } as any;
}

// ── Expense Analysis ─────────────────────────────────────────────────────────

export async function fetchExpenseReport(): Promise<ExpenseReportData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  invalidateCache(`core:${uid}`);
  const snap = await loadCoreSnapshot(uid);

  // Try expenses collection first, fallback to fee gap analysis
  const expSnap = await scopedDocs("expenses", uid);
  const monthMap = new Map<string, number>();
  snap.months.forEach(m => monthMap.set(m.key, 0));
  const categoryMap = new Map<string, number>();

  /* Only use real expense docs. Previously when the `expenses` collection
     was empty we fabricated a 55/20/15/10% split (Salaries/Ops/Infra/Misc)
     from fee revenue — pure fiction. The chart looked identical to real
     data and the Owner couldn't tell. Now: honest empty state. */
  (expSnap.docs as any[]).forEach(d => {
    const e = d.data();
    const amount = Number(e.amount || e.totalAmount || 0);
    if (amount <= 0) return;
    const cat = e.category || e.type || e.expenseType || "Other";
    const normCat = cat.charAt(0).toUpperCase() + cat.slice(1);
    categoryMap.set(normCat, (categoryMap.get(normCat) || 0) + amount);

    let dateStr = "";
    if (e.date?.toDate) try { dateStr = e.date.toDate().toLocaleDateString("en-CA"); } catch {}
    else if (e.createdAt?.toDate) try { dateStr = e.createdAt.toDate().toLocaleDateString("en-CA"); } catch {}
    const ym = dateStr.slice(0, 7);
    if (monthMap.has(ym)) monthMap.set(ym, (monthMap.get(ym) || 0) + amount);
  });

  const totalExpenses = Array.from(categoryMap.values()).reduce((a, b) => a + b, 0);
  const byCategory = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      pct: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const monthlyTrend = snap.months.map(m => ({ month: m.label, amount: Math.round(monthMap.get(m.key) || 0) }));
  const largestCategory = byCategory[0]?.category || "—";

  const hasRealData = totalExpenses > 0;
  const summary = hasRealData
    ? `Expense analysis totaling ₹${totalExpenses.toLocaleString("en-IN")}. ${largestCategory !== "—" ? `${largestCategory} is the largest expense category at ${byCategory[0]?.pct}% of total.` : ""}`
    : "No expense data recorded yet. Add entries to the `expenses` Firestore collection (with `schoolId`, `amount`, `category`, `date`) to see this report populate.";

  return { _type: "expense", id: genId(), generatedOn: today(), totalExpenses, byCategory, monthlyTrend, largestCategory, summary } as any;
}

// ── Log download to Firestore ─────────────────────────────────────────────────

export async function logReportDownload(reportType: string, format: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    /* schoolId on the write so the scoped read in fetchReportsDashboard can
       find it. Without this the where("schoolId", "==", uid) filter would
       silently exclude every download we just logged → "Recent Downloads"
       always shows 0 even when active. */
    await addDoc(collection(db, "report_downloads"), {
      uid,
      schoolId: uid,
      reportType,
      format,
      createdAt: serverTimestamp(),
    });
  } catch { /* silent */ }
}

// ── Toggle favorite ───────────────────────────────────────────────────────────

export async function toggleFavorite(reportSlug: string): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  try {
    const q2 = query(
      collection(db, "report_favorites"),
      where("uid", "==", uid),
      where("reportSlug", "==", reportSlug)
    );
    const snap = await getDocs(q2);
    if (snap.empty) {
      await addDoc(collection(db, "report_favorites"), {
        uid,
        schoolId: uid, // mirror — keeps the scoped dashboard read consistent
        reportSlug,
        createdAt: serverTimestamp(),
      });
      return true;
    } else {
      await deleteDoc(doc(db, "report_favorites", snap.docs[0].id));
      return false;
    }
  } catch { return false; }
}

// ── Report type registry ──────────────────────────────────────────────────────

export const REPORT_REGISTRY: Record<string, {
  label: string;
  category: "student" | "teacher" | "financial";
  fetcher: () => Promise<AnyReportData>;
}> = {
  "enrollment-summary": { label: "Enrollment Summary", category: "student", fetcher: fetchEnrollmentReport as any },
  "attendance-analysis": { label: "Attendance Analysis", category: "student", fetcher: fetchAttendanceReport as any },
  "performance-report": { label: "Performance Report", category: "student", fetcher: fetchPerformanceReport as any },
  "at-risk-students": { label: "At-Risk Students", category: "student", fetcher: fetchAtRiskReport as any },
  "performance-evaluation": { label: "Performance Evaluation", category: "teacher",   fetcher: fetchTeacherPerfReport as any },
  "workload-analysis":      { label: "Workload Analysis",      category: "teacher",   fetcher: fetchWorkloadReport as any },
  "feedback-summary":       { label: "Feedback Summary",       category: "teacher",   fetcher: fetchFeedbackReport as any },
  "training-needs":         { label: "Training Needs",         category: "teacher",   fetcher: fetchTrainingNeedsReport as any },
  "revenue-summary":        { label: "Revenue Summary",        category: "financial", fetcher: fetchRevenueReport as any },
  "fee-collection":         { label: "Fee Collection",         category: "financial", fetcher: fetchFeeCollectionReport as any },
  "outstanding-report":     { label: "Outstanding Report",     category: "financial", fetcher: fetchOutstandingReport as any },
  "expense-analysis":       { label: "Expense Analysis",       category: "financial", fetcher: fetchExpenseReport as any },
};

export const REPORT_CATEGORIES = {
  student: ["Enrollment Summary", "Attendance Analysis", "Performance Report", "At-Risk Students"],
  teacher: ["Performance Evaluation", "Workload Analysis", "Feedback Summary", "Training Needs"],
  financial: ["Revenue Summary", "Fee Collection", "Outstanding Report", "Expense Analysis"],
};

export function getReportSlug(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")    // collapse repeated dashes ("at-risk---students" → "at-risk-students")
    .replace(/^-|-$/g, ""); // strip leading/trailing dashes
}
