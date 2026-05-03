/**
 * branchesService.ts
 * Powered by shared analyticsService snapshot.
 * Cross-synced with: academicsService, risksService, financeFees.
 */
import { auth } from "./firebase";
import {
  loadCoreSnapshot, invalidateCache,
  calculateAHI, calculatePassRate,
  generateInsights, getBranchTrends,
  computeStatus, avg,
  type MappingIssue,
} from "./analyticsService";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BranchSummary = {
  id: string;
  name: string;
  color: string;
  studentCount: number;
  teacherCount: number;
  established: string;
  location: string;
  ahi: number;
  attendance: number;
  passRate: number;
  feeCollection: number;
  revenuePerStudent: number;
  activeAlerts: number;
  status: "Strong" | "Good" | "Needs Focus";
  growthRate: number; // % YoY student growth (0 if no prior data)
  /** Raw count of test entries (results + test_scores) that did NOT pass.
   *  Use this in action-plan recommendations instead of deriving from
   *  studentCount × (1 - passRate) — the latter overstates because not every
   *  enrolled student takes every test. */
  failedTestCount: number;
};

export type BranchComparisonData = {
  branches: BranchSummary[];
  performanceRanking: Record<string, string | number>[];
  /** Trend rows allow `null` per-branch values for months with no attendance
   *  data — the Recharts <Line> will gap at those points instead of dipping
   *  to 0%, which would falsely signal "branch attendance crashed". */
  comparativeTrends: Record<string, string | number | null>[];
  efficiencyMetrics: { label: string; value: string; note: string; col: string }[];
  /** Surfaced from analyticsService — non-null when student-branch attribution
   *  is partially or fully broken. UI should render a banner so the Owner
   *  knows the dashboard data may be misleading. */
  mappingIssue: MappingIssue | null;
};

export type BranchDetailData = {
  summary: BranchSummary;
  schoolAvgAhi: number;
  schoolAvgAttendance: number;
  schoolAvgPassRate: number;
  /** `score` is null for months with no attendance recorded — chart will gap. */
  historicalTrend: { period: string; score: number | null; schoolAvg: number }[];
  benchmarkComparison: { metric: string; branch: number; avg: number }[];
  strengths: string[];
  improvements: string[];
  actionPlan: { task: string; sub: string; priority: string; prColor: string }[];
  kpiNotes: { ahi: string; fee: string; passRate: string; alerts: string };
  bestBranchName: string;
};

// ── Internal: compute per-branch summaries ────────────────────────────────────

async function computeSummaries(): Promise<{
  branches: BranchSummary[];
  branchMonthAtt: Map<string, Map<string, { total: number; present: number }>>;
  months: { key: string; label: string }[];
  mappingIssue: MappingIssue | null;
}> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  const snap = await loadCoreSnapshot(uid);
  const { branches: rawBranches, branchStudents, studentAttMap,
          branchAtt, branchRes, branchFees, branchTeachers,
          branchMonthAtt, months, mappingIssue } = snap;

  const branches: BranchSummary[] = rawBranches.map(b => {
    const att   = branchAtt.get(b.id)!;
    const res   = branchRes.get(b.id)!;
    const fee   = branchFees.get(b.id)!;
    const studs = branchStudents.get(b.id)!;
    const tct   = branchTeachers.get(b.id) || 0;

    const attendance    = att.total   > 0 ? Math.round((att.present   / att.total)   * 100) : 0;
    const passRate      = calculatePassRate(res.passed, res.total);
    const feeCollection = fee.total   > 0 ? Math.round((fee.collected / fee.total)   * 100) : 0;
    const ahi           = calculateAHI(attendance, passRate, feeCollection);

    const studentCount = studs.size;
    const revenuePerStudent = studentCount > 0 && fee.collected > 0
      ? Math.round(fee.collected / studentCount)
      : 0;

    const activeAlerts = [...studs].filter(sid => {
      const sa = studentAttMap.get(sid);
      return sa && sa.total >= 3 && sa.present / sa.total < 0.80;
    }).length;

    // Growth rate: compare student counts in last month vs 6 months ago
    // approximated via monthly attendance records as proxy
    const mKeys = months.map(m => m.key);
    const newest = branchMonthAtt.get(b.id)?.get(mKeys[mKeys.length - 1]);
    const oldest = branchMonthAtt.get(b.id)?.get(mKeys[0]);
    let growthRate = 0;
    if (oldest && oldest.total > 0 && newest && newest.total > 0) {
      growthRate = Math.round(((newest.total - oldest.total) / oldest.total) * 100);
    }

    /* Real failed-test count from raw results. Used by action plan so we
       don't overstate failures by extrapolating from total enrolled count. */
    const failedTestCount = Math.max(0, res.total - res.passed);

    return {
      id: b.id, name: b.name, color: b.color,
      studentCount, teacherCount: tct,
      established: b.established, location: b.location,
      ahi, attendance, passRate, feeCollection,
      revenuePerStudent, activeAlerts, growthRate,
      status: computeStatus(ahi),
      failedTestCount,
    };
  });

  return { branches, branchMonthAtt, months, mappingIssue };
}

// ── Public: list view ─────────────────────────────────────────────────────────

export async function fetchBranchesComparison(): Promise<BranchComparisonData> {
  const { branches, branchMonthAtt, months, mappingIssue } = await computeSummaries();

  // Performance ranking chart
  const performanceRanking = (["Attendance", "Pass Rate", "Fee Coll.", "AHI"] as const).map(metric => {
    const row: Record<string, string | number> = { metric };
    branches.forEach((b, i) => {
      row[`b${i}`] =
        metric === "Attendance" ? b.attendance :
        metric === "Pass Rate"  ? b.passRate   :
        metric === "Fee Coll."  ? b.feeCollection :
                                  b.ahi;
    });
    return row;
  });

  // Comparative trends — monthly attendance %. Use `null` for months with no
  // data so the line chart shows a gap instead of plotting 0% (which would
  // visually claim the branch had a catastrophic attendance drop).
  const comparativeTrends = months.map(m => {
    const row: Record<string, string | number | null> = { month: m.label };
    branches.forEach((b, i) => {
      const mAtt = branchMonthAtt.get(b.id)?.get(m.key);
      row[`b${i}`] = mAtt?.total ? Math.round((mAtt.present / mAtt.total) * 100) : null;
    });
    return row;
  });

  // Efficiency metrics — match UI: Revenue/Student, Teacher Ratio, Resource Util., Growth Rate
  const totalStudents = branches.reduce((s, b) => s + b.studentCount, 0);
  const totalTeachers = branches.reduce((s, b) => s + b.teacherCount, 0);
  const bestRevB      = branches.length ? branches.reduce((a, b) => b.revenuePerStudent > a.revenuePerStudent ? b : a, branches[0]) : null;
  const teacherRatio  = totalTeachers > 0 ? Math.round(totalStudents / totalTeachers) : 0;
  const avgAtt        = avg(branches.filter(b => b.attendance > 0).map(b => b.attendance));
  const bestGrowth    = branches.length ? branches.reduce((a, b) => b.growthRate > a.growthRate ? b : a, branches[0]) : null;

  // Teacher-ratio lead branch (best = lowest ratio i.e. most teachers per student)
  const bestRatioBranch = branches.length && totalTeachers > 0
    ? branches.reduce((a, b) =>
        b.teacherCount > 0 && b.studentCount / b.teacherCount < a.studentCount / a.teacherCount ? b : a,
        branches.find(b => b.teacherCount > 0) || branches[0])
    : null;

  const efficiencyMetrics = [
    {
      label: "Revenue/Student",
      /* ₹ — Indian school context. Fee data in `fees` collection is rupees,
         and `toLocaleString("en-IN")` formats with the lakh/crore grouping
         conventions Indian users expect (e.g. "1,50,000" instead of "150,000"). */
      value: bestRevB && bestRevB.revenuePerStudent > 0
        ? `₹${bestRevB.revenuePerStudent.toLocaleString("en-IN")}`
        : "N/A",
      note: bestRevB && bestRevB.revenuePerStudent > 0
        ? `${bestRevB.name.split(" ")[0]} leads`
        : "No fee data",
      col: bestRevB && bestRevB.revenuePerStudent > 0 ? "text-[#1e3a8a]" : "text-slate-400",
    },
    {
      label: "Teacher Ratio",
      value: teacherRatio > 0 ? `1:${teacherRatio}` : "N/A",
      note: bestRatioBranch && bestRatioBranch.teacherCount > 0
        ? `${bestRatioBranch.name.split(" ")[0]} optimal`
        : "No teacher data",
      col: teacherRatio > 0 && teacherRatio <= 20 ? "text-[#22c55e]" : "text-[#f59e0b]",
    },
    {
      label: "Resource Util.",
      value: avgAtt > 0 ? `${avgAtt}%` : "N/A",
      note: (() => {
        const lead = branches.filter(b => b.attendance > 0)
          .reduce((a, b) => b.attendance > a.attendance ? b : a, branches.find(b => b.attendance > 0) || branches[0]);
        return lead && lead.attendance > 0 ? `${lead.name.split(" ")[0]} highest` : "No data";
      })(),
      col: avgAtt >= 85 ? "text-[#22c55e]" : avgAtt >= 70 ? "text-[#f59e0b]" : "text-slate-400",
    },
    {
      label: "Activity Trend",
      value: bestGrowth && bestGrowth.growthRate !== 0
        ? `${bestGrowth.growthRate > 0 ? "+" : ""}${bestGrowth.growthRate}%`
        : "N/A",
      note: bestGrowth && bestGrowth.growthRate !== 0
        ? `${bestGrowth.name.split(" ")[0]} · attendance volume vs 6mo ago`
        : "Insufficient history",
      col: bestGrowth && bestGrowth.growthRate > 0 ? "text-[#22c55e]" : "text-[#f59e0b]",
    },
  ];

  return { branches, performanceRanking, comparativeTrends, efficiencyMetrics, mappingIssue };
}

// ── Public: detail view ───────────────────────────────────────────────────────

export async function fetchBranchDetail(branchId: string): Promise<BranchDetailData> {
  const { branches, branchMonthAtt, months } = await computeSummaries();
  /* mappingIssue is intentionally NOT propagated to detail-view return type —
     the banner already shows on list view, and a single-branch view doesn't
     need the global warning. The Owner sees it on /branches before drilling in. */

  const summaryIdx = branches.findIndex(b => b.id === branchId);
  if (summaryIdx === -1) throw new Error("Branch not found");
  const summary = branches[summaryIdx];

  // School averages — every metric filtered to "branches with data > 0"
  // so a branch with no exam scores doesn't drag the school passRate
  // toward 0. Earlier `schoolAvgAhi` was the only one that did NOT filter,
  // which made the Benchmark Comparison chart show "school avg" massively
  // below the active branch whenever sibling branches had no data yet.
  // (See memory: bug_pattern_score_zero_no_data — same pattern.)
  const schoolAvgAhi           = avg(branches.filter(b => b.ahi > 0).map(b => b.ahi));
  const schoolAvgAttendance    = avg(branches.filter(b => b.attendance > 0).map(b => b.attendance));
  const schoolAvgPassRate      = avg(branches.filter(b => b.passRate > 0).map(b => b.passRate));
  const schoolAvgFeeCollection = avg(branches.filter(b => b.feeCollection > 0).map(b => b.feeCollection));

  // Best-branch lookup is gated on `ahi > 0` — without the gate, when ALL
  // branches have no data, `branches.reduce(...)` falls back to
  // `branches[0]` and labels it "Best performing branch" even though it
  // has zero data. Now we only have a "best" when at least one branch
  // has positive AHI.
  const branchesWithAhi = branches.filter(b => b.ahi > 0);
  const bestBranch     = branchesWithAhi.length > 0
    ? branchesWithAhi.reduce((a, b) => b.ahi > a.ahi ? b : a)
    : null;
  const bestBranchName = bestBranch?.name.split(" ")[0] || "Top";
  const isTopBranch    = bestBranch?.id === summary.id;
  const onlyBranchWithAhi = branchesWithAhi.length === 1 && isTopBranch;

  // Comparison notes for KPI cards — framed against real school/best-branch
  // values, with explicit no-data guards so we never claim "Highest pass
  // rate" or "Best performing branch" when the underlying value is N/A.
  const ahiDiff  = bestBranch && !isTopBranch ? summary.ahi - bestBranch.ahi : 0;
  const passDiff = bestBranch && !isTopBranch ? summary.passRate - bestBranch.passRate : 0;
  const feeDiff  = summary.feeCollection > 0 ? summary.feeCollection - schoolAvgFeeCollection : 0;
  const bestFeeBranch = branches.filter(b => b.feeCollection > 0)
    .reduce((a, b) => b.feeCollection > a.feeCollection ? b : a, branches.find(b => b.feeCollection > 0) || summary);
  const isTopFee = bestFeeBranch.id === summary.id && summary.feeCollection > 0;

  const kpiNotes = {
    ahi: summary.ahi === 0
      ? "No academic data yet"
      : onlyBranchWithAhi
        ? "Only branch with data"
        : isTopBranch
          ? "Best performing branch"
          : `↓ ${Math.abs(ahiDiff)}% below ${bestBranchName}`,
    fee: summary.feeCollection === 0
      ? "No fee data"
      : isTopFee
        ? "Highest collection"
        : feeDiff >= 0
          ? `↑ ${feeDiff}% vs school avg`
          : `↓ ${Math.abs(feeDiff)}% vs school avg`,
    passRate: summary.passRate === 0
      ? "No exam data yet"
      : onlyBranchWithAhi
        ? "Only branch with results"
        : isTopBranch
          ? "Highest pass rate"
          : `↓ ${Math.abs(passDiff)}% below ${bestBranchName}`,
    alerts: summary.activeAlerts === 0
      ? "No active risks"
      : summary.activeAlerts === branches.reduce((max, b) => Math.max(max, b.activeAlerts), 0)
        ? "Highest among branches"
        : `${summary.activeAlerts} student${summary.activeAlerts > 1 ? "s" : ""} at risk`,
  };

  const historicalTrend = getBranchTrends(
    branchMonthAtt.get(summary.id)!,
    months,
    schoolAvgAttendance
  );

  const benchmarkComparison = [
    { metric: "AHI",        branch: summary.ahi,           avg: schoolAvgAhi },
    { metric: "Fee Coll.",  branch: summary.feeCollection,  avg: schoolAvgFeeCollection },
    { metric: "Pass Rate",  branch: summary.passRate,       avg: schoolAvgPassRate },
    { metric: "Attendance", branch: summary.attendance,     avg: schoolAvgAttendance },
    /* Growth shown as-is. Previously clamped via Math.max(0, ...) which
       hid shrinking branches — a -10% growth read as 0% (stable). The
       school avg also clamped each peer's negative growth to 0 before
       averaging, masking genuine network decline. Recharts <Bar> handles
       negative values by drawing below the axis, so the visual is fine. */
    { metric: "Growth",     branch: summary.growthRate,     avg: avg(branches.map(b => b.growthRate)) },
  ];

  const { strengths, improvements } = generateInsights(
    summary.name, summary.ahi, summary.attendance,
    summary.passRate, summary.feeCollection,
    schoolAvgAhi, schoolAvgAttendance
  );

  // Action Plan
  const actionPlan: { task: string; sub: string; priority: string; prColor: string }[] = [];

  if (summary.attendance < 80 && summary.attendance > 0) {
    actionPlan.push({
      task: "Attendance Improvement Initiative",
      sub: `Parent meetings • Incentive program • Transport review`,
      priority: "High Priority", prColor: "bg-[#ef4444]",
    });
  } else if (summary.attendance > 0 && summary.attendance < schoolAvgAttendance) {
    actionPlan.push({
      task: "Attendance Monitoring Program",
      sub: "Weekly reports and parent communication channels",
      priority: "Medium Priority", prColor: "bg-[#f59e0b]",
    });
  }

  if (summary.passRate > 0 && summary.passRate < 60) {
    /* Use real failedTestCount from results — NOT studentCount × (1 - passRate),
       which overstates failures when not every enrolled student takes every
       test. The label "test entries" is more accurate than "students" because
       a student with 3 failed tests counts 3 times in failedTestCount. */
    const failing = summary.failedTestCount;
    actionPlan.push({
      task: "Academic Remediation Program",
      sub: failing > 0
        ? `${failing} failing test entr${failing !== 1 ? "ies" : "y"} below pass threshold — set up targeted tutoring and parent-teacher reviews`
        : "Pass rate below 60% — set up targeted tutoring and parent-teacher reviews",
      priority: "High Priority", prColor: "bg-[#ef4444]",
    });
  } else if (summary.passRate > 0 && summary.passRate < schoolAvgPassRate) {
    actionPlan.push({
      task: "Academic Support Workshops",
      sub: "Bi-weekly workshops for underperforming students",
      priority: "Medium Priority", prColor: "bg-[#f59e0b]",
    });
  }

  if (summary.feeCollection > 0 && summary.feeCollection < 85) {
    actionPlan.push({
      task: "Fee Recovery Drive",
      sub: "Automated reminders, flexible payment plans, direct follow-up",
      priority: "Medium Priority", prColor: "bg-[#f59e0b]",
    });
  }

  if (summary.activeAlerts > 5) {
    actionPlan.push({
      task: "Student Risk Intervention",
      sub: `Contact parents of ${summary.activeAlerts} at-risk students immediately`,
      priority: "High Priority", prColor: "bg-[#ef4444]",
    });
  }

  if (actionPlan.length === 0) {
    actionPlan.push({
      task: "Regular Performance Review",
      sub: "Monthly KPI review meeting with branch head and management team",
      priority: "Low Priority", prColor: "bg-slate-400",
    });
  }

  return {
    summary, schoolAvgAhi, schoolAvgAttendance, schoolAvgPassRate,
    historicalTrend, benchmarkComparison, strengths, improvements, actionPlan,
    kpiNotes, bestBranchName,
  };
}

// ── Real-time subscription (onSnapshot wrapper) ───────────────────────────────
export function subscribeBranchesComparison(
  onData: (d: BranchComparisonData) => void,
  onError: (e: Error) => void
): () => void {
  let cancelled = false;
  const uid = auth.currentUser?.uid;
  if (!uid) { onError(new Error("Not authenticated")); return () => {}; }

  const run = () => {
    invalidateCache(`core:${uid}`);
    fetchBranchesComparison()
      .then(d => { if (!cancelled) onData(d); })
      .catch(e => { if (!cancelled) onError(e as Error); });
  };

  run();
  // Poll every 60s as lightweight real-time substitute (Firestore onSnapshot
  // on multiple root collections would require composite listeners)
  const interval = setInterval(run, 60_000);
  return () => { cancelled = true; clearInterval(interval); };
}

export function subscribeBranchDetail(
  branchId: string,
  onData: (d: BranchDetailData) => void,
  onError: (e: Error) => void
): () => void {
  let cancelled = false;
  const uid = auth.currentUser?.uid;
  if (!uid) { onError(new Error("Not authenticated")); return () => {}; }

  const run = () => {
    invalidateCache(`core:${uid}`);
    fetchBranchDetail(branchId)
      .then(d => { if (!cancelled) onData(d); })
      .catch(e => { if (!cancelled) onError(e as Error); });
  };

  run();
  const interval = setInterval(run, 60_000);
  return () => { cancelled = true; clearInterval(interval); };
}
