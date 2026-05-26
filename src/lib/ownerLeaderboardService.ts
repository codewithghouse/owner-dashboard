/**
 * ownerLeaderboardService.ts
 *
 * Builds the Owner Branch Leaderboard view from real data already loaded by
 * analyticsService.loadCoreSnapshot(). No mock data — every value here is
 * derived from Firestore documents the rest of the app already reads.
 *
 * Ranking is by composite (= AHI, weighted attendance/passRate/feeCollection).
 * weekChange is computed as current month attendance % minus previous month %.
 * Insights (whyTop / whyHere / solutions / pills) are rule-based, generated
 * from the same metrics so the dashboard surfaces real patterns.
 */
import { auth, db, functions } from "./firebase";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import {
  loadCoreSnapshot, calculateAHI, calculatePassRate, avg,
} from "./analyticsService";
import type {
  OwnerLeaderboardData, OwnerBranchRanking, OwnerBranchInsight,
  OwnerBranchStyle, BranchWhyTopItem, BranchWhyHereItem, BranchSolution,
  OwnerNetworkSummary, BranchAISource,
} from "./ownerTypes";

// ── Style tokens per rank — pure data from the locked UI design ─────────────
const STYLE_BY_RANK: Record<number, OwnerBranchStyle> = {
  1: {
    headerGradient: "linear-gradient(135deg, #000A33 0%, #001A66 32%, #0044CC 68%, #0055FF 100%)",
    rankBg: "linear-gradient(135deg, #FFD700 0%, #FFAA00 100%)",
    rankShadow: "0 5px 14px rgba(255,170,0,0.40)",
    avatarBg: "rgba(52,199,89,0.20)", avatarColor: "#00C853",
    solutionBg: "", solutionBorder: "", solutionArrowColor: "",
  },
  2: {
    headerGradient: "linear-gradient(135deg, #2A2A3A 0%, #6A6A7A 100%)",
    rankBg: "linear-gradient(135deg, #E8E8F0 0%, #A8A8B5 100%)",
    rankShadow: "0 4px 12px rgba(168,168,181,0.30)",
    avatarBg: "rgba(123,63,244,0.12)", avatarColor: "#7B3FF4",
    solutionBg: "rgba(0,85,255,0.04)", solutionBorder: "0.5px solid rgba(0,85,255,0.10)", solutionArrowColor: "#0055FF",
  },
  3: {
    headerGradient: "linear-gradient(135deg, #001A66 0%, #0055FF 100%)",
    rankBg: "linear-gradient(135deg, #D89060 0%, #8B5A2B 100%)",
    rankShadow: "0 4px 12px rgba(139,90,43,0.25)",
    avatarBg: "rgba(0,85,255,0.12)", avatarColor: "#0055FF",
    solutionBg: "rgba(0,85,255,0.04)", solutionBorder: "0.5px solid rgba(0,85,255,0.10)", solutionArrowColor: "#0055FF",
  },
  4: {
    headerGradient: "linear-gradient(135deg, #5C3200 0%, #C26A00 100%)",
    rankBg: "rgba(255,255,255,0.15)", rankShadow: "none",
    avatarBg: "rgba(255,136,0,0.12)", avatarColor: "#C26A00",
    solutionBg: "rgba(255,136,0,0.04)", solutionBorder: "0.5px solid rgba(255,136,0,0.15)", solutionArrowColor: "#FF8800",
  },
  5: {
    headerGradient: "linear-gradient(135deg, #4A0A0A 0%, #C71F2D 100%)",
    rankBg: "rgba(255,255,255,0.15)", rankShadow: "none",
    avatarBg: "rgba(255,69,58,0.12)", avatarColor: "#C71F2D",
    solutionBg: "rgba(255,69,58,0.04)", solutionBorder: "0.5px solid rgba(255,69,58,0.15)", solutionArrowColor: "#FF453A",
  },
};

export function getStyleTokens(rank: number): OwnerBranchStyle {
  return STYLE_BY_RANK[rank] || STYLE_BY_RANK[5];
}

// ── Per-branch derived metrics computed once, reused for ranking + insights ──
interface BranchMetrics {
  id: string;
  name: string;
  city: string;
  studentCount: number;
  teacherCount: number;
  attendance: number;
  passRate: number;
  feeCollection: number;
  ahi: number;
  activeAlerts: number;             // at-risk students (attendance < 80%, ≥ 3 records)
  monthlyAttendance: number[];      // last 6 months, oldest → newest
  weekChange: number;               // current month attendance % - previous month %
  trend: "up" | "down" | "same";
}

function computeBranchMetrics(snap: Awaited<ReturnType<typeof loadCoreSnapshot>>): BranchMetrics[] {
  return snap.branches.map(b => {
    const att   = snap.branchAtt.get(b.id)!;
    const res   = snap.branchRes.get(b.id)!;
    const fee   = snap.branchFees.get(b.id)!;
    const studs = snap.branchStudents.get(b.id)!;
    const tct   = snap.branchTeachers.get(b.id) || 0;

    const attendance    = att.total > 0 ? Math.round((att.present / att.total) * 100) : 0;
    const passRate      = calculatePassRate(res.passed, res.total);
    const feeCollection = fee.total > 0 ? Math.round((fee.collected / fee.total) * 100) : 0;
    const ahi           = calculateAHI(attendance, passRate, feeCollection);

    // Per-month attendance % (oldest → newest)
    const monthlyAttendance = snap.months.map(m => {
      const mAtt = snap.branchMonthAtt.get(b.id)?.get(m.key);
      return mAtt && mAtt.total > 0 ? Math.round((mAtt.present / mAtt.total) * 100) : 0;
    });

    const cur  = monthlyAttendance[monthlyAttendance.length - 1] || 0;
    const prev = monthlyAttendance[monthlyAttendance.length - 2] || 0;
    const weekChange = cur && prev ? cur - prev : 0;
    const trend: "up" | "down" | "same" =
      weekChange > 0 ? "up" : weekChange < 0 ? "down" : "same";

    const activeAlerts = [...studs].filter(sid => {
      const sa = snap.studentAttMap.get(sid);
      return sa && sa.total >= 3 && sa.present / sa.total < 0.80;
    }).length;

    return {
      id: b.id,
      name: b.name,
      city: b.location || "—",
      studentCount: studs.size,
      teacherCount: tct,
      attendance, passRate, feeCollection, ahi,
      activeAlerts, monthlyAttendance, weekChange, trend,
    };
  });
}

// ── Context line shown on each ranking row ──────────────────────────────────
function generateContextLine(
  m: BranchMetrics, rank: number, networkAvg: number,
): { line: string; color: string } {
  const atRiskPct = m.studentCount > 0 ? (m.activeAlerts / m.studentCount) * 100 : 0;
  const weakSignals = (m.attendance > 0 && m.attendance < 80 ? 1 : 0)
                    + (m.passRate > 0 && m.passRate < 60 ? 1 : 0)
                    + (m.feeCollection > 0 && m.feeCollection < 80 ? 1 : 0);

  if (rank === 1) {
    return {
      line: `Attendance ${m.attendance}% · Pass rate ${m.passRate}% · At-risk ${atRiskPct.toFixed(1)}%`,
      color: "#34C759",
    };
  }
  if (m.weekChange > 2) {
    return {
      line: `Strong trajectory +${m.weekChange.toFixed(1)} · ${m.activeAlerts} at-risk · AHI ${m.ahi}`,
      color: "#5070B0",
    };
  }
  if (atRiskPct > 10 || m.attendance < 70) {
    return {
      line: `At-risk ${m.activeAlerts} students · Attendance ${m.attendance}% · Declining`,
      color: "#FF453A",
    };
  }
  if (m.weekChange < 0) {
    return {
      line: `${weakSignals} weak metric${weakSignals !== 1 ? "s" : ""} · Trend ${m.weekChange.toFixed(1)} · AHI ${m.ahi}`,
      color: "#FF8800",
    };
  }
  return {
    line: `AHI ${m.ahi} vs network ${networkAvg} · ${m.activeAlerts} at-risk · ${weakSignals} weak metric${weakSignals !== 1 ? "s" : ""}`,
    color: "#FF8800",
  };
}

// ── Rank #1 — strengths only, no solutions ──────────────────────────────────
function generateWhyTop(m: BranchMetrics, networkAvg: number, others: BranchMetrics[]): {
  whyTop: BranchWhyTopItem[]; pills: string[];
} {
  const items: BranchWhyTopItem[] = [];

  if (m.ahi > 0) items.push({
    metric: `AHI ${m.ahi}`,
    detail: `Network-leading composite. ${networkAvg > 0 ? `${m.ahi - networkAvg} points above the network average of ${networkAvg}.` : "Highest in the network."}`,
  });
  if (m.attendance > 0) {
    const next = others[0];
    const gap = next ? m.attendance - next.attendance : 0;
    items.push({
      metric: `Attendance ${m.attendance}%`,
      detail: gap > 0
        ? `${gap} points above the next branch (${next.name} at ${next.attendance}%). Consistent presence is the foundation of every other metric here.`
        : `Strong overall attendance keeps assignment quality, results and morale steady.`,
    });
  }
  if (m.passRate > 0) items.push({
    metric: `Pass rate ${m.passRate}%`,
    detail: `${m.studentCount} students assessed. Above-bar academic delivery — visible in the test_scores and results aggregates.`,
  });
  if (m.feeCollection > 0) items.push({
    metric: `Fee collection ${m.feeCollection}%`,
    detail: `Revenue stability funds the teacher and resource investments other branches lag on.`,
  });
  const atRiskPct = m.studentCount > 0 ? (m.activeAlerts / m.studentCount) * 100 : 0;
  items.push({
    metric: `At-risk only ${m.activeAlerts} students`,
    detail: `${atRiskPct.toFixed(1)}% of the branch — ${m.activeAlerts === 0 ? "zero crisis cases this period." : "early intervention prevents the slide before it compounds."}`,
  });

  const pills = [
    `AHI ${m.ahi}`,
    `Attendance ${m.attendance}%`,
    `Pass rate ${m.passRate}%`,
    `At-risk ${m.activeAlerts}`,
  ];
  return { whyTop: items.slice(0, 5), pills };
}

// ── Rank #2-5 — root causes + concrete improvement steps ─────────────────────
function generateWhyHere(m: BranchMetrics, top: BranchMetrics): BranchWhyHereItem[] {
  const items: BranchWhyHereItem[] = [];
  const ORANGE = "#FF8800", RED = "#FF453A";

  if (m.attendance > 0 && top.attendance > 0 && top.attendance - m.attendance >= 3) {
    items.push({
      color: m.attendance < 70 ? RED : ORANGE,
      bold: `Attendance ${m.attendance}% vs ${top.name} ${top.attendance}%.`,
      rest: ` ${top.attendance - m.attendance} point gap — drives both the AHI gap and the at-risk count downstream.`,
    });
  }
  if (m.passRate > 0 && top.passRate > 0 && top.passRate - m.passRate >= 3) {
    items.push({
      color: m.passRate < 60 ? RED : ORANGE,
      bold: `Pass rate ${m.passRate}% vs ${top.name} ${top.passRate}%.`,
      rest: ` ${top.passRate - m.passRate} point gap — focused remediation on the failing cohort closes most of this in one term.`,
    });
  }
  if (m.feeCollection > 0 && m.feeCollection < 85) {
    items.push({
      color: m.feeCollection < 70 ? RED : ORANGE,
      bold: `Fee collection ${m.feeCollection}%.`,
      rest: ` Below the 85% target. Revenue gap constrains what this branch can spend on teacher coaching and resources.`,
    });
  }
  const atRiskPct = m.studentCount > 0 ? (m.activeAlerts / m.studentCount) * 100 : 0;
  if (atRiskPct >= 5) {
    items.push({
      color: atRiskPct >= 10 ? RED : ORANGE,
      bold: `${m.activeAlerts} at-risk students (${atRiskPct.toFixed(1)}% of the branch).`,
      rest: ` These are below 80% attendance with at least 3 records — already on the slide. Direct outreach this week prevents drop-off.`,
    });
  }
  if (m.trend === "down" && m.weekChange < -1) {
    items.push({
      color: RED,
      bold: `Declining ${m.weekChange.toFixed(1)} this month.`,
      rest: ` Attendance trend is reversing. Without intervention, projected to drop further next month.`,
    });
  }
  // Always at least one bullet so the panel isn't empty.
  if (items.length === 0) items.push({
    color: ORANGE,
    bold: `AHI ${m.ahi} vs ${top.name} ${top.ahi}.`,
    rest: ` ${top.ahi - m.ahi} point gap to the top — broad rather than concentrated. Whole-branch review needed.`,
  });
  return items.slice(0, 4);
}

function generateSolutions(m: BranchMetrics, top: BranchMetrics): BranchSolution[] {
  const sols: BranchSolution[] = [];
  const isDeclining = m.trend === "down" && m.weekChange < -1;
  const atRiskPct = m.studentCount > 0 ? (m.activeAlerts / m.studentCount) * 100 : 0;

  if (atRiskPct >= 10) sols.push({
    urgent: true,
    text: `URGENT: Direct outreach to ${m.activeAlerts} at-risk families this week. ${atRiskPct.toFixed(1)}% of the branch is already on the slide.`,
  });
  if (m.attendance > 0 && m.attendance < 80) sols.push({
    urgent: m.attendance < 70,
    text: `Launch attendance recovery: parent meetings, transport review, daily marking enforcement. Target ${Math.min(top.attendance, m.attendance + 8)}% by next month.`,
  });
  if (m.passRate > 0 && m.passRate < 75) {
    const failing = Math.round(m.studentCount * (1 - m.passRate / 100));
    sols.push({
      urgent: m.passRate < 60,
      text: `Academic remediation for ~${failing} below-pass students. Bi-weekly workshops + parent-teacher reviews. Match ${top.name}'s ${top.passRate}% over two terms.`,
    });
  }
  if (m.feeCollection > 0 && m.feeCollection < 85) sols.push({
    urgent: false,
    text: `Fee recovery drive: automated reminders, flexible plans, direct follow-up on the longest-overdue accounts. Target 90% collection.`,
  });
  if (isDeclining) sols.push({
    urgent: true,
    text: `Stop the decline — ${Math.abs(m.weekChange).toFixed(1)} point drop this month. Freeze new initiatives, focus only on attendance + weak-cohort coaching for the next 3 weeks.`,
  });
  // Fallback so we always have at least one actionable item.
  if (sols.length === 0) sols.push({
    urgent: false,
    text: `Study ${top.name}'s playbook — pair principals for a 2-week mentorship on the practices driving their AHI ${top.ahi}.`,
  });
  return sols.slice(0, 4);
}

function getSolutionLabel(rank: number, isDeclining: boolean): string {
  if (isDeclining) return "Recovery plan";
  if (rank === 2) return "How to reach #1";
  if (rank === 3) return "How to reach #2";
  if (rank === 4) return "How to reach #3";
  return "Recovery plan";
}

// ── AI enhancement (Vercel serverless + Firestore cache) ────────────────────
// Cache shape: schools/{uid}/branch_insights/{branchId}_{monthKey}
//   { isTop, whyTop[], pills[], whyHere[], solutions[], solutionLabel,
//     model, generatedAt: Timestamp }
// TTL: 7 days. After that we re-fetch from OpenAI on next page load.

const AI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedInsight {
  isTop: boolean;
  whyTop?: BranchWhyTopItem[]; pills?: string[];
  whyHere?: BranchWhyHereItem[]; solutions?: BranchSolution[];
  solutionLabel?: string;
  model?: string;
  generatedAt?: { toMillis: () => number } | number;
}

function cachedAtMs(c: CachedInsight): number {
  if (!c.generatedAt) return 0;
  if (typeof c.generatedAt === "number") return c.generatedAt;
  if (typeof c.generatedAt.toMillis === "function") return c.generatedAt.toMillis();
  return 0;
}

async function readCachedInsight(
  uid: string, branchId: string, monthKey: string,
): Promise<CachedInsight | null> {
  try {
    const ref = doc(db, "schools", uid, "branch_insights", `${branchId}_${monthKey}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data() as CachedInsight;
    if (Date.now() - cachedAtMs(data) > AI_CACHE_TTL_MS) return null;
    return data;
  } catch (err) {
    console.warn("[ownerLeaderboard] cache read failed:", err);
    return null;
  }
}

async function writeCachedInsight(
  uid: string, branchId: string, monthKey: string, payload: CachedInsight,
): Promise<void> {
  try {
    const ref = doc(db, "schools", uid, "branch_insights", `${branchId}_${monthKey}`);
    await setDoc(ref, { ...payload, generatedAt: serverTimestamp() });
  } catch (err) {
    console.warn("[ownerLeaderboard] cache write failed:", err);
  }
}

async function callAIRoute(
  rank: number, branch: BranchAISource, top: BranchAISource | null,
  network: OwnerNetworkSummary,
): Promise<CachedInsight | null> {
  try {
    if (!auth.currentUser) return null;
    const callable = httpsCallable<unknown, { insight?: any; model?: string; generatedAt?: number }>(
      functions, "getOwnerBranchInsight",
    );
    const res = await callable({ rank, branch, top, network });
    const data = res.data;
    const insight = data?.insight || {};
    return {
      isTop: rank === 1,
      whyTop: insight.whyTop, pills: insight.pills,
      whyHere: insight.whyHere, solutions: insight.solutions,
      solutionLabel: insight.solutionLabel,
      model: data?.model,
      generatedAt: data?.generatedAt,
    };
  } catch (err) {
    console.warn("[ownerLeaderboard] AI route failed:", err);
    return null;
  }
}

/**
 * Fetch (or compute) the AI insight for a single branch and merge it onto the
 * rule-based fallback. Returns the resulting OwnerBranchInsight.
 *
 * Flow: Firestore cache (7d) → OpenAI route → cache write. Any failure simply
 * returns the rule-based fallback unchanged so the UI never blanks.
 */
export async function fetchAIInsightForBranch(
  branchId: string, monthKey: string,
  ranking: OwnerBranchRanking, top: BranchAISource | null,
  branchSource: BranchAISource, network: OwnerNetworkSummary,
  fallback: OwnerBranchInsight,
): Promise<{ insight: OwnerBranchInsight; source: "ai" | "cache" | "fallback" }> {
  const uid = auth.currentUser?.uid;
  if (!uid) return { insight: fallback, source: "fallback" };

  const cached = await readCachedInsight(uid, branchId, monthKey);
  if (cached) {
    return {
      insight: mergeInsight(fallback, cached),
      source: "cache",
    };
  }

  const ai = await callAIRoute(ranking.rank, branchSource, top, network);
  if (!ai) return { insight: fallback, source: "fallback" };

  // Persist for next visit (don't await — UI doesn't depend on it)
  void writeCachedInsight(uid, branchId, monthKey, ai);
  return { insight: mergeInsight(fallback, ai), source: "ai" };
}

function mergeInsight(fallback: OwnerBranchInsight, ai: CachedInsight): OwnerBranchInsight {
  if (fallback.isTop) {
    return {
      ...fallback,
      whyTop: ai.whyTop?.length ? ai.whyTop : fallback.whyTop,
      pills:  ai.pills?.length  ? ai.pills  : fallback.pills,
    };
  }
  return {
    ...fallback,
    whyHere:       ai.whyHere?.length   ? ai.whyHere   : fallback.whyHere,
    solutions:     ai.solutions?.length ? ai.solutions : fallback.solutions,
    solutionLabel: ai.solutionLabel     || fallback.solutionLabel,
  };
}

// ── Public: fetch the full leaderboard view ─────────────────────────────────
export async function fetchOwnerLeaderboard(): Promise<OwnerLeaderboardData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  const [snap, schoolDoc] = await Promise.all([
    loadCoreSnapshot(uid),
    getDoc(doc(db, "schools", uid)),
  ]);

  const lastMonth = snap.months[snap.months.length - 1];
  const monthKey  = lastMonth?.key   || "";
  const monthLabel = lastMonth?.label || "";

  if (snap.branches.length === 0) {
    return {
      network: {
        name: schoolDoc.data()?.schoolName || "Network",
        monthLabel, monthKey,
        totalBranches: 0, totalStudents: 0, totalTeachers: 0,
        networkAvg: 0, topScore: 0, totalAtRisk: 0,
      },
      branches: [], insights: {},
      aiSources: {}, trendByBranch: {}, trendMonths: snap.months.map(m => m.label),
    };
  }

  // 1. Compute metrics per branch
  const metrics = computeBranchMetrics(snap);

  // 2. Sort by composite (AHI) desc → assign rank
  metrics.sort((a, b) => b.ahi - a.ahi);

  const totalStudents = metrics.reduce((s, m) => s + m.studentCount, 0);
  const totalTeachers = metrics.reduce((s, m) => s + m.teacherCount, 0);
  const totalAtRisk   = metrics.reduce((s, m) => s + m.activeAlerts, 0);
  const networkAvg    = avg(metrics.filter(m => m.ahi > 0).map(m => m.ahi));
  const topScore      = metrics[0]?.ahi || 0;
  const top           = metrics[0];

  const network: OwnerNetworkSummary = {
    name: schoolDoc.data()?.schoolName || "Network",
    monthLabel, monthKey,
    totalBranches: metrics.length,
    totalStudents, totalTeachers, totalAtRisk,
    networkAvg, topScore,
  };

  // 3. Build ranking rows + insights
  const branches: OwnerBranchRanking[] = [];
  const insights: Record<string, OwnerBranchInsight> = {};
  const aiSources: Record<string, BranchAISource> = {};
  const trendByBranch: Record<string, number[]> = {};

  metrics.forEach((m, i) => {
    const rank = i + 1;
    const ctx = generateContextLine(m, rank, networkAvg);
    branches.push({
      rank, id: m.id, name: m.name, city: m.city,
      initial: (m.name[0] || "B").toUpperCase(),
      students: m.studentCount, teachers: m.teacherCount,
      composite: m.ahi, weekChange: m.weekChange, trend: m.trend,
      contextLine: ctx.line, contextColor: ctx.color,
    });
    aiSources[m.id] = {
      rank,
      ahi: m.ahi, attendance: m.attendance, passRate: m.passRate,
      feeCollection: m.feeCollection, studentCount: m.studentCount,
      teacherCount: m.teacherCount, activeAlerts: m.activeAlerts,
      weekChange: m.weekChange, name: m.name, city: m.city,
      monthlyAttendance: m.monthlyAttendance,
    };
    trendByBranch[m.id] = m.monthlyAttendance;

    const style = getStyleTokens(rank);
    if (rank === 1) {
      const { whyTop, pills } = generateWhyTop(m, networkAvg, metrics.slice(1));
      insights[m.id] = {
        branchId: m.id, isTop: true, whyTop, pills,
        whyHere: [], solutions: [], solutionLabel: "",
        style,
      };
    } else {
      const isDeclining = m.trend === "down" && m.weekChange < -1;
      insights[m.id] = {
        branchId: m.id, isTop: false,
        whyTop: [], pills: [],
        whyHere: generateWhyHere(m, top),
        solutions: generateSolutions(m, top),
        solutionLabel: getSolutionLabel(rank, isDeclining),
        style,
      };
    }
  });

  return {
    network, branches, insights, aiSources, trendByBranch,
    trendMonths: snap.months.map(m => m.label),
  };
}
