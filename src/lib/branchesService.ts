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
  computeStatus, avg, getLast6Months,
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
};

export type BranchComparisonData = {
  branches: BranchSummary[];
  performanceRanking: Record<string, string | number>[];
  comparativeTrends: Record<string, string | number>[];
  efficiencyMetrics: { label: string; value: string; note: string; col: string }[];
};

export type BranchDetailData = {
  summary: BranchSummary;
  schoolAvgAhi: number;
  schoolAvgAttendance: number;
  schoolAvgPassRate: number;
  historicalTrend: { period: string; score: number; schoolAvg: number }[];
  benchmarkComparison: { metric: string; branch: number; avg: number }[];
  strengths: string[];
  improvements: string[];
  actionPlan: { task: string; sub: string; priority: string; prColor: string }[];
};

// ── Internal: compute per-branch summaries ────────────────────────────────────

async function computeSummaries(): Promise<{
  branches: BranchSummary[];
  branchMonthAtt: Map<string, Map<string, { total: number; present: number }>>;
  months: { key: string; label: string }[];
}> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  const snap = await loadCoreSnapshot(uid);
  const { branches: rawBranches, branchStudents, studentAttMap,
          branchAtt, branchRes, branchFees, branchTeachers,
          branchMonthAtt, months } = snap;

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

    return {
      id: b.id, name: b.name, color: b.color,
      studentCount, teacherCount: tct,
      established: b.established, location: b.location,
      ahi, attendance, passRate, feeCollection,
      revenuePerStudent, activeAlerts, growthRate,
      status: computeStatus(ahi),
    };
  });

  return { branches, branchMonthAtt, months };
}

// ── Public: list view ─────────────────────────────────────────────────────────

export async function fetchBranchesComparison(): Promise<BranchComparisonData> {
  const { branches, branchMonthAtt, months } = await computeSummaries();

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

  // Comparative trends — monthly AHI proxy (attendance %)
  const comparativeTrends = months.map(m => {
    const row: Record<string, string | number> = { month: m.label };
    branches.forEach((b, i) => {
      const mAtt = branchMonthAtt.get(b.id)?.get(m.key);
      row[`b${i}`] = mAtt?.total ? Math.round((mAtt.present / mAtt.total) * 100) : 0;
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
      value: bestRevB && bestRevB.revenuePerStudent > 0
        ? `$${bestRevB.revenuePerStudent.toLocaleString()}`
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
      label: "Growth Rate",
      value: bestGrowth && bestGrowth.growthRate !== 0
        ? `${bestGrowth.growthRate > 0 ? "+" : ""}${bestGrowth.growthRate}%`
        : "N/A",
      note: bestGrowth && bestGrowth.growthRate !== 0
        ? `${bestGrowth.name.split(" ")[0]} fastest`
        : "Insufficient history",
      col: bestGrowth && bestGrowth.growthRate > 0 ? "text-[#22c55e]" : "text-[#f59e0b]",
    },
  ];

  return { branches, performanceRanking, comparativeTrends, efficiencyMetrics };
}

// ── Public: detail view ───────────────────────────────────────────────────────

export async function fetchBranchDetail(branchId: string): Promise<BranchDetailData> {
  const { branches, branchMonthAtt, months } = await computeSummaries();

  const summaryIdx = branches.findIndex(b => b.id === branchId);
  if (summaryIdx === -1) throw new Error("Branch not found");
  const summary = branches[summaryIdx];

  const schoolAvgAhi          = avg(branches.map(b => b.ahi));
  const schoolAvgAttendance   = avg(branches.filter(b => b.attendance > 0).map(b => b.attendance));
  const schoolAvgPassRate     = avg(branches.filter(b => b.passRate > 0).map(b => b.passRate));
  const schoolAvgFeeCollection = avg(branches.filter(b => b.feeCollection > 0).map(b => b.feeCollection));

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
    { metric: "Growth",     branch: Math.max(0, summary.growthRate), avg: avg(branches.map(b => Math.max(0, b.growthRate))) },
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
    actionPlan.push({
      task: "Implement Math Remediation Program",
      sub: `Target: ${Math.round(summary.studentCount * 0.07)} students • Timeline: 6 weeks • Budget: $8,000`,
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
