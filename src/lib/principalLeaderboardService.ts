/**
 * principalLeaderboardService.ts
 *
 * Joins the `principals` collection with per-branch metrics from
 * loadCoreSnapshot (the same source the Dashboard, Branches Comparison
 * and Owner Branch Leaderboard already use). Ranks principals by their
 * branch's AHI (attendance + pass rate + fee collection composite).
 *
 * Principals with no branch assigned, or whose branch has no data yet,
 * still appear at the bottom flagged as "No data" — never silently
 * dropped, so the owner can see staffing gaps.
 */
import { auth, db } from "./firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import { loadCoreSnapshot, calculateAHI, calculatePassRate } from "./analyticsService";

export type PrincipalTrend = "up" | "down" | "same";

export interface PrincipalRankRow {
  id: string;
  name: string;
  email: string;
  branchId: string;
  branchName: string;
  branchColor?: string;
  status: string; // "Active" | "Invited" | etc.
  // Branch outcomes (zero when branch has no data yet)
  ahi: number;
  attendance: number;
  passRate: number;
  feeCollection: number;
  students: number;
  teachers: number;
  atRiskStudents: number;
  // Trend over the last 2 months of attendance
  weekChange: number;
  trend: PrincipalTrend;
  // True when at least one of the three core metrics has data — used by
  // the UI to render a "No Data" pill instead of treating a fresh
  // principal as a low performer.
  hasData: boolean;
}

export interface PrincipalLeaderboardData {
  rows: PrincipalRankRow[];
  network: {
    totalPrincipals: number;
    totalBranches: number;
    topAhi: number;
    networkAvgAhi: number;
    monthLabel: string;
  };
}

interface BranchMetricsPacked {
  branchName: string;
  branchColor?: string;
  students: number;
  teachers: number;
  attendance: number;
  passRate: number;
  feeCollection: number;
  ahi: number;
  atRiskStudents: number;
  weekChange: number;
  trend: PrincipalTrend;
}

export async function fetchPrincipalLeaderboard(): Promise<PrincipalLeaderboardData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  const [snap, principalsSnap] = await Promise.all([
    loadCoreSnapshot(uid),
    getDocs(query(collection(db, "principals"), where("schoolId", "==", uid))),
  ]);

  // Build branchId → metrics map once so multiple principals on the same
  // branch (rare but possible during transitions) read from a single source.
  const branchMetrics = new Map<string, BranchMetricsPacked>();
  for (const b of snap.branches) {
    const att   = snap.branchAtt.get(b.id);
    const res   = snap.branchRes.get(b.id);
    const fee   = snap.branchFees.get(b.id);
    const studs = snap.branchStudents.get(b.id);
    const tct   = snap.branchTeachers.get(b.id) || 0;

    const attendance    = att && att.total > 0 ? Math.round((att.present / att.total) * 100) : 0;
    const passRate      = res ? calculatePassRate(res.passed, res.total) : 0;
    const feeCollection = fee && fee.total > 0 ? Math.round((fee.collected / fee.total) * 100) : 0;
    const ahi           = calculateAHI(attendance, passRate, feeCollection);

    const monthlyAtt = snap.months.map(m => {
      const mAtt = snap.branchMonthAtt.get(b.id)?.get(m.key);
      return mAtt && mAtt.total > 0 ? Math.round((mAtt.present / mAtt.total) * 100) : 0;
    });
    const cur  = monthlyAtt[monthlyAtt.length - 1] || 0;
    const prev = monthlyAtt[monthlyAtt.length - 2] || 0;
    const weekChange = cur && prev ? cur - prev : 0;
    const trend: PrincipalTrend =
      weekChange > 0 ? "up" : weekChange < 0 ? "down" : "same";

    const atRiskStudents = studs ? [...studs].filter(sid => {
      const sa = snap.studentAttMap.get(sid);
      return sa && sa.total >= 3 && sa.present / sa.total < 0.80;
    }).length : 0;

    branchMetrics.set(b.id, {
      branchName: b.name,
      branchColor: b.color,
      students: studs?.size || 0,
      teachers: tct,
      attendance, passRate, feeCollection, ahi,
      atRiskStudents, weekChange, trend,
    });
  }

  const rows: PrincipalRankRow[] = principalsSnap.docs.map(d => {
    const p = d.data() as any;
    const bid = String(p.branchId || "");
    const bm  = branchMetrics.get(bid);

    const attendance    = bm?.attendance    || 0;
    const passRate      = bm?.passRate      || 0;
    const feeCollection = bm?.feeCollection || 0;

    return {
      id: d.id,
      name: p.name || "Principal",
      email: (p.email || "").toLowerCase(),
      branchId: bid,
      branchName: bm?.branchName || p.branch || p.branchName || "—",
      branchColor: bm?.branchColor || p.branchColor,
      status: p.status || "Invited",
      ahi: bm?.ahi || 0,
      attendance, passRate, feeCollection,
      students: bm?.students || 0,
      teachers: bm?.teachers || 0,
      atRiskStudents: bm?.atRiskStudents || 0,
      weekChange: bm?.weekChange || 0,
      trend: bm?.trend || "same",
      hasData: attendance > 0 || passRate > 0 || feeCollection > 0,
    };
  });

  // Rank by AHI desc; principals with no data sort last (by name).
  rows.sort((a, b) => {
    if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
    if (b.ahi !== a.ahi) return b.ahi - a.ahi;
    return a.name.localeCompare(b.name);
  });

  const dataAhis = rows.filter(r => r.hasData).map(r => r.ahi);
  const topAhi   = dataAhis[0] || 0;
  const networkAvgAhi = dataAhis.length
    ? Math.round(dataAhis.reduce((s, x) => s + x, 0) / dataAhis.length)
    : 0;

  return {
    rows,
    network: {
      totalPrincipals: rows.length,
      totalBranches:   snap.branches.length,
      topAhi,
      networkAvgAhi,
      monthLabel:      snap.months[snap.months.length - 1]?.label || "",
    },
  };
}
