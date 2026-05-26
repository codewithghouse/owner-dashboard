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
import {
  collection, query, where, getDocs,
  doc, getDoc, setDoc, serverTimestamp,
} from "firebase/firestore";
import { loadCoreSnapshot, calculateAHI, calculatePassRate } from "./analyticsService";

export type PrincipalTrend = "up" | "down" | "same";

/**
 * AI-style insight panel attached to each principal. The reasons are
 * grounded in the principal's actual numbers vs the network top, so the
 * text reads as a real diagnosis rather than a templated platitude.
 * Multiple phrasings per slot picked deterministically by hashing the
 * principalId — same principal always sees the same write-up
 * (consistency), neighbouring principals see different framings
 * (feels like real per-person analysis).
 */
export type InsightMode = "top" | "strong" | "behind" | "atrisk" | "nodata";

export interface PrincipalInsight {
  mode: InsightMode;
  /** 1-line headline shown inline on the podium card. */
  oneLiner: string;
  /** 2-4 grounded observations explaining the rank. */
  reasons: string[];
  /** 2-4 concrete next steps. Phrased as imperatives. */
  actions: string[];
  /** Label for the actions block — "How to maintain", "How to reach #1", etc. */
  actionsLabel: string;
}

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
  insight: PrincipalInsight;
}

export interface PrincipalLeaderboardData {
  rows: PrincipalRankRow[];
  network: {
    totalPrincipals: number;
    totalBranches: number;
    topAhi: number;
    networkAvgAhi: number;
    networkAvgAtt: number;
    networkAvgPass: number;
    networkAvgFee: number;
    monthLabel: string;
    monthKey: string;
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

// ── Deterministic hash for pool selection ─────────────────────────────────
function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pickN<T>(pool: T[], seed: number, n: number): T[] {
  if (pool.length === 0) return [];
  const out: T[] = [];
  const used = new Set<number>();
  for (let i = 0; i < n && used.size < pool.length; i++) {
    const idx = (seed + i * 31) % pool.length;
    let j = idx;
    while (used.has(j)) j = (j + 1) % pool.length;
    used.add(j);
    out.push(pool[j]);
  }
  return out;
}

// ── Stat helpers used by insight templates ────────────────────────────────
interface InsightContext {
  row: PrincipalRankRow;
  top: PrincipalRankRow | null;       // current #1 (null when this is #1)
  rank: number;                       // 1-indexed
  networkAvgAhi: number;
  networkAvgAtt: number;
  networkAvgPass: number;
  networkAvgFee: number;
}

const ATT_TARGET  = 85;
const PASS_TARGET = 75;
const FEE_TARGET  = 90;

// ── #1 templates: "Why on top" ────────────────────────────────────────────
const WHY_TOP_POOL: Array<(c: InsightContext) => string | null> = [
  c => c.row.attendance >= 85
    ? `Attendance at ${c.row.attendance}% is ${c.networkAvgAtt > 0 ? Math.max(0, c.row.attendance - c.networkAvgAtt) + " points above the network average" : "the highest in the network"} — that's the foundation every downstream metric sits on.`
    : null,
  c => c.row.passRate >= 70
    ? `${c.row.passRate}% pass rate across ${c.row.students.toLocaleString()} students — academic delivery is your competitive moat, not luck.`
    : null,
  c => c.row.feeCollection >= 85
    ? `Fee collection at ${c.row.feeCollection}% gives this branch real budget headroom that lower-ranked branches simply don't have.`
    : null,
  c => c.row.atRiskStudents === 0
    ? `Zero crisis cases this period — early intervention is clearly the discipline, not the exception.`
    : c.row.atRiskStudents <= 3
      ? `Only ${c.row.atRiskStudents} at-risk students out of ${c.row.students} — proactive outreach is preventing the slide before it compounds.`
      : null,
  c => c.row.teachers > 0 && c.row.students / c.row.teachers <= 22
    ? `Healthy ${(c.row.students / c.row.teachers).toFixed(0)}:1 student-to-teacher ratio is buying the personal attention that shows up in your scores.`
    : null,
  c => c.row.trend === "up"
    ? `Attendance is still climbing this month (+${c.row.weekChange.toFixed(1)} pts) — you're not just leading, you're widening the gap.`
    : null,
  c => c.row.ahi >= 80
    ? `Composite AHI ${c.row.ahi} reflects balance across all three pillars — no single weak signal hiding behind a strong one.`
    : null,
];

const HOW_TO_MAINTAIN_POOL: string[] = [
  "Document this term's actual routines — what's working isn't obvious until you write it down. Make it the onboarding kit for new staff.",
  "Mentor one struggling peer principal — teaching reinforces your own practices and builds network-wide depth.",
  "Don't slow down on the basics: daily attendance reviews, weekly fee follow-ups, fortnightly teacher 1:1s. These compound.",
  "Pilot one bold experiment this term — your performance buffer can absorb a calculated risk that lower-ranked branches can't afford.",
  "Run a 30-minute parent listening session each month — capture early signal on what's about to slip before it shows in the numbers.",
  "Identify your top 2 teachers and protect their time — pair them with the weakest cohort, not the strongest. That's where the leverage is.",
  "Tighten the at-risk threshold from 80% attendance to 85% — surface borderline students before they become this term's crisis cases.",
  "Set a 60-day stretch goal one notch above your current ceiling — strong principals plateau when they stop chasing the next 5 points.",
  "Cross-share your weekly fee-collection script with the other branches — small interventions, big network impact.",
  "Schedule a quarterly review with the owner — visibility now prevents firefighting later.",
];

// ── #2-5 templates: "Why here" ────────────────────────────────────────────
const WHY_BEHIND_POOL: Array<(c: InsightContext) => string | null> = [
  c => c.top && c.row.attendance > 0 && c.top.attendance - c.row.attendance >= 3
    ? `Attendance ${c.row.attendance}% vs ${c.top.name.split(" ")[0]}'s ${c.top.attendance}% — a ${c.top.attendance - c.row.attendance}-point gap that explains most of the AHI gap downstream.`
    : null,
  c => c.top && c.row.passRate > 0 && c.top.passRate - c.row.passRate >= 3
    ? `Pass rate ${c.row.passRate}% trails ${c.top.name.split(" ")[0]} by ${c.top.passRate - c.row.passRate} points — usually solvable in a single term with focused remediation on the failing cohort.`
    : null,
  c => c.row.feeCollection > 0 && c.row.feeCollection < FEE_TARGET
    ? `Fee collection at ${c.row.feeCollection}% (target ${FEE_TARGET}%) — every percentage point here is real cash that could fund teacher coaching or resources.`
    : null,
  c => c.row.atRiskStudents > 0 && c.row.students > 0 && c.row.atRiskStudents / c.row.students >= 0.05
    ? `${c.row.atRiskStudents} students already below 80% attendance — that's ${((c.row.atRiskStudents / c.row.students) * 100).toFixed(1)}% of the branch on the slide right now.`
    : null,
  c => c.row.trend === "down" && c.row.weekChange < -1
    ? `Attendance is declining ${c.row.weekChange.toFixed(1)} pts month-on-month — the trend is reversing and projected to drop further without intervention.`
    : null,
  c => c.row.attendance > 0 && c.row.attendance < ATT_TARGET
    ? `${ATT_TARGET}% attendance is the baseline strong branches hit consistently — your ${c.row.attendance}% leaves ${ATT_TARGET - c.row.attendance} points on the table before academics even enter the equation.`
    : null,
  c => c.row.passRate > 0 && c.row.passRate < 60
    ? `Pass rate below 60% means roughly ${Math.round(c.row.students * (1 - c.row.passRate / 100))} students are not clearing the bar — too many for ad-hoc remediation, needs a system.`
    : null,
  c => c.row.teachers > 0 && c.row.students / c.row.teachers > 30
    ? `Student-teacher ratio of ${(c.row.students / c.row.teachers).toFixed(0)}:1 is stretched — quality of attention is being diluted in a way the test scores reflect.`
    : null,
  c => c.networkAvgAhi > 0 && c.row.ahi < c.networkAvgAhi
    ? `AHI ${c.row.ahi} is ${c.networkAvgAhi - c.row.ahi} points below the network average of ${c.networkAvgAhi} — the issue is broad rather than one bad metric.`
    : null,
];

const ACTIONS_BEHIND_POOL: Array<(c: InsightContext) => string | null> = [
  c => c.row.attendance > 0 && c.row.attendance < ATT_TARGET
    ? `Launch a 4-week attendance recovery: parent meetings for the 80% bucket, daily marking enforcement, transport bottleneck review. Target +${Math.min(10, ATT_TARGET - c.row.attendance + 2)} points by next month.`
    : null,
  c => c.row.passRate > 0 && c.row.passRate < PASS_TARGET
    ? `Bi-weekly subject workshops for the failing cohort. Identify the 3 hardest topics from last test, target those specifically. Pair underperforming students with peer tutors for 60 days.`
    : null,
  c => c.row.feeCollection > 0 && c.row.feeCollection < FEE_TARGET
    ? `Run a focused fee recovery drive: automated reminders, flexible installment options, direct calls to the longest-overdue accounts. Target ${FEE_TARGET}% by quarter-end.`
    : null,
  c => c.row.atRiskStudents >= 5
    ? `Direct outreach this week to all ${c.row.atRiskStudents} at-risk families. A 10-minute call now is worth a hundred reactive escalations later.`
    : null,
  c => c.row.trend === "down"
    ? `Freeze new initiatives for 3 weeks — focus only on stopping the attendance bleed. New work resumes once the trend stabilises.`
    : null,
  c => c.top
    ? `Book a 30-minute call with ${c.top.name.split(" ")[0]} — their playbook is sitting one branch away. Specific ask: how they keep attendance above ${c.top.attendance}%.`
    : null,
  c => c.row.teachers > 0
    ? `Spend one full day shadowing your top teacher — capture the routine and replicate it across the next 2 weakest classrooms.`
    : null,
  () => `Set a single 30-day target that ties all three metrics together (e.g., +3% attendance, +5% pass, +2% fee). Singular focus beats spread effort.`,
  c => c.row.atRiskStudents > 0
    ? `Build a Friday-evening review ritual — every at-risk student gets named, last-7-day pattern reviewed, next-week action assigned. Owner gets the summary.`
    : null,
  () => `Pull the lowest-scoring class's last 3 test papers — diagnostic, not punitive. The pattern in errors usually points at one fixable gap.`,
];

// ── At-risk specific (rank low or AHI < 50) ───────────────────────────────
const WHY_ATRISK_POOL: Array<(c: InsightContext) => string | null> = [
  c => c.row.attendance > 0 && c.row.attendance < 70
    ? `Attendance ${c.row.attendance}% is in crisis territory — students are voting with their feet before academics even enter the picture.`
    : null,
  c => c.row.passRate > 0 && c.row.passRate < 50
    ? `Pass rate ${c.row.passRate}% means more than half the cohort is currently failing — this isn't a teaching gap, it's a system gap.`
    : null,
  c => c.row.atRiskStudents > 0 && c.row.students > 0 && c.row.atRiskStudents / c.row.students >= 0.15
    ? `${((c.row.atRiskStudents / c.row.students) * 100).toFixed(1)}% of the branch is at risk — early-warning system is failing or the response loop isn't closing.`
    : null,
  c => c.row.ahi > 0 && c.row.ahi < 50
    ? `Composite AHI ${c.row.ahi} is in the bottom quartile — all three pillars (attendance, academics, fee) need stabilising simultaneously, not sequentially.`
    : null,
];

const ACTIONS_ATRISK_POOL: string[] = [
  "URGENT: Schedule a recovery-plan meeting with the owner this week. Lay out the 30/60/90-day milestones, agree on the support needed.",
  "Pause all non-essential activities for 30 days. Focus only on attendance, the failing cohort, and the 5 most stressed parents.",
  "Bring in a temporary senior teacher from the top branch for a 4-week embed — fresh eyes diagnose what insiders can't see.",
  "Run a parent town-hall — name the gap, name the plan, name the timeline. Trust deficit deepens when problems are hidden.",
  "Audit the last 90 days of teacher attendance and prep-time logs — the branch problem often starts in the staffroom.",
  "Set up a daily 15-min standup with class teachers — surface what didn't work yesterday, plan today. No agenda, just rhythm.",
];

const NO_DATA_REASONS: string[] = [
  "Branch is brand new or hasn't recorded attendance, scores, or fees yet — wait for data before drawing conclusions.",
  "Either the principal hasn't activated their account or the branch's daily flows aren't being logged in the system.",
];

const NO_DATA_ACTIONS: string[] = [
  "Check that this principal has accepted the invite and signed in at least once.",
  "Verify with the branch that attendance is being marked daily in the teacher app — that's the most common missing signal.",
  "If the branch is genuinely new, set a 30-day check-in to revisit. Don't draw conclusions until data flows for at least 2 weeks.",
];

// ── Public: build the insight for one principal ───────────────────────────
function buildInsight(c: InsightContext): PrincipalInsight {
  const seed = hashId(c.row.id || c.row.email || c.row.name);

  if (!c.row.hasData) {
    return {
      mode: "nodata",
      oneLiner: "Awaiting data — branch hasn't started reporting yet.",
      reasons: pickN(NO_DATA_REASONS, seed, 1),
      actions: pickN(NO_DATA_ACTIONS, seed, 2),
      actionsLabel: "What to check",
    };
  }

  if (c.rank === 1) {
    const reasons = WHY_TOP_POOL.map(fn => fn(c)).filter((x): x is string => !!x);
    const chosenReasons = reasons.length > 0 ? pickN(reasons, seed, Math.min(3, reasons.length)) : ["Top across the composite by a meaningful margin."];
    return {
      mode: "top",
      oneLiner: c.row.attendance >= 85 && c.row.passRate >= 70
        ? `Holding the top spot through balanced strength across attendance (${c.row.attendance}%), academics (${c.row.passRate}%) and collections (${c.row.feeCollection}%).`
        : `Leading the network with AHI ${c.row.ahi}.`,
      reasons: chosenReasons,
      actions: pickN(HOW_TO_MAINTAIN_POOL, seed, 3),
      actionsLabel: "How to keep this lead",
    };
  }

  if (c.row.ahi > 0 && c.row.ahi < 50) {
    const reasons = WHY_ATRISK_POOL.map(fn => fn(c)).filter((x): x is string => !!x);
    return {
      mode: "atrisk",
      oneLiner: `At-risk territory — AHI ${c.row.ahi} demands immediate attention.`,
      reasons: reasons.length > 0 ? pickN(reasons, seed, Math.min(3, reasons.length)) : [`Composite below 50 with no single metric carrying the load.`],
      actions: pickN(ACTIONS_ATRISK_POOL, seed, 3),
      actionsLabel: "Recovery plan",
    };
  }

  // "Strong" (#2-3 or AHI >= 70 but not top) gets a slightly different tone
  // from "Behind" (mid-table) — same templates but the label changes.
  const mode: InsightMode = c.rank <= 3 || c.row.ahi >= 70 ? "strong" : "behind";
  const reasons = WHY_BEHIND_POOL.map(fn => fn(c)).filter((x): x is string => !!x);
  const actions = ACTIONS_BEHIND_POOL.map(fn => fn(c)).filter((x): x is string => !!x);

  return {
    mode,
    oneLiner: c.top
      ? `Trailing #1 (${c.top.name.split(" ")[0]}) by ${Math.max(0, c.top.ahi - c.row.ahi)} AHI points — gap is closable in one focused term.`
      : `AHI ${c.row.ahi} with room to climb.`,
    reasons: reasons.length > 0 ? pickN(reasons, seed, Math.min(3, reasons.length)) : [`AHI ${c.row.ahi} vs network top — issue is broad rather than one weak metric.`],
    actions: actions.length > 0 ? pickN(actions, seed, Math.min(3, actions.length)) : [`Schedule a 30-min call with the top principal — their playbook transfers cleanly.`],
    actionsLabel: c.rank === 2 ? "How to reach #1"
              : c.rank === 3 ? "How to reach #2"
              : `How to climb the rankings`,
  };
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

  // Build raw rows (insight assigned in the second pass so each row's
  // insight can reference both the top row and network averages).
  const allRawRows: Omit<PrincipalRankRow, "insight">[] = principalsSnap.docs.map(d => {
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

  // Case-insensitive dedup safeguard — group rows by normalised
  // name+branchId, keep the longest-name (most properly-cased "official")
  // entry per group. Defense-in-depth: even after the 2026-05-26 Firestore
  // cleanup, if a duplicate principal doc returns (re-invite with a
  // case variant, e.g. "ghouse pasha" vs "Ghouse Pasha"), the leaderboard
  // still shows ONE row per real person. Same logic as PrincipalNotes
  // (kept inline here so the service has zero cross-page imports).
  const dedupGroups = new Map<string, typeof allRawRows>();
  for (const r of allRawRows) {
    const nameKey = r.name.toLowerCase().replace(/\s+/g, "").trim();
    if (!nameKey) continue;
    const branchKey = (r.branchId || r.branchName || "").toString().toLowerCase().trim();
    const key = `${nameKey}|${branchKey}`;
    const bucket = dedupGroups.get(key);
    if (bucket) bucket.push(r); else dedupGroups.set(key, [r]);
  }
  const rowsWithoutInsight: typeof allRawRows = [];
  for (const bucket of dedupGroups.values()) {
    if (bucket.length === 1) { rowsWithoutInsight.push(bucket[0]); continue; }
    const winner = bucket.slice().sort((a, b) => {
      if (b.name.length !== a.name.length) return b.name.length - a.name.length;
      return a.id.localeCompare(b.id);
    })[0];
    rowsWithoutInsight.push(winner);
  }

  // Rank by AHI desc; principals with no data sort last (by name).
  rowsWithoutInsight.sort((a, b) => {
    if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
    if (b.ahi !== a.ahi) return b.ahi - a.ahi;
    return a.name.localeCompare(b.name);
  });

  const dataAhis = rowsWithoutInsight.filter(r => r.hasData).map(r => r.ahi);
  const topAhi   = dataAhis[0] || 0;
  const networkAvgAhi = dataAhis.length
    ? Math.round(dataAhis.reduce((s, x) => s + x, 0) / dataAhis.length)
    : 0;
  const networkAvgAtt = rowsWithoutInsight.filter(r => r.attendance > 0).length > 0
    ? Math.round(rowsWithoutInsight.filter(r => r.attendance > 0).reduce((s, r) => s + r.attendance, 0) / rowsWithoutInsight.filter(r => r.attendance > 0).length)
    : 0;
  const networkAvgPass = rowsWithoutInsight.filter(r => r.passRate > 0).length > 0
    ? Math.round(rowsWithoutInsight.filter(r => r.passRate > 0).reduce((s, r) => s + r.passRate, 0) / rowsWithoutInsight.filter(r => r.passRate > 0).length)
    : 0;
  const networkAvgFee = rowsWithoutInsight.filter(r => r.feeCollection > 0).length > 0
    ? Math.round(rowsWithoutInsight.filter(r => r.feeCollection > 0).reduce((s, r) => s + r.feeCollection, 0) / rowsWithoutInsight.filter(r => r.feeCollection > 0).length)
    : 0;

  // Top principal — used as the reference point for "How to reach #1"
  // narratives on every subsequent row. First row that has any data;
  // falls back to the very first row if no one has data yet.
  const topRow = (rowsWithoutInsight.find(r => r.hasData) || rowsWithoutInsight[0] || null) as PrincipalRankRow | null;

  const rows: PrincipalRankRow[] = rowsWithoutInsight.map((r, i) => {
    const fullRow = r as PrincipalRankRow;
    const insight = buildInsight({
      row: fullRow,
      top: (i === 0 ? null : topRow),
      rank: i + 1,
      networkAvgAhi, networkAvgAtt, networkAvgPass, networkAvgFee,
    });
    return { ...fullRow, insight };
  });

  return {
    rows,
    network: {
      totalPrincipals: rows.length,
      totalBranches:   snap.branches.length,
      topAhi,
      networkAvgAhi,
      networkAvgAtt,
      networkAvgPass,
      networkAvgFee,
      monthLabel:      snap.months[snap.months.length - 1]?.label || "",
      monthKey:        snap.months[snap.months.length - 1]?.key   || "",
    },
  };
}

// ─── Real-AI insight enrichment ───────────────────────────────────────────
// Hits the Vercel serverless `/api/principal-insights` route, caches the
// response in Firestore at `schools/{uid}/principal_insights/{pid}_{monthKey}`
// with a 7-day TTL. On any failure (no key, network, rate-limit, empty
// payload) returns null so the caller keeps the rule-based fallback already
// attached to the row. Same shape + caching strategy as ownerLeaderboardService.

const AI_INSIGHT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedPrincipalInsight {
  insight: PrincipalInsight;
  model?: string;
  generatedAt?: { toMillis?: () => number } | number;
}

function cachedAtMs(c: CachedPrincipalInsight): number {
  if (!c.generatedAt) return 0;
  if (typeof c.generatedAt === "number") return c.generatedAt;
  if (typeof c.generatedAt.toMillis === "function") return c.generatedAt.toMillis();
  return 0;
}

async function readCached(uid: string, pid: string, monthKey: string): Promise<PrincipalInsight | null> {
  try {
    const ref  = doc(db, "schools", uid, "principal_insights", `${pid}_${monthKey || "all"}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data() as CachedPrincipalInsight;
    if (Date.now() - cachedAtMs(data) > AI_INSIGHT_CACHE_TTL_MS) return null;
    return data.insight || null;
  } catch (err) {
    console.warn("[principalAI] cache read failed:", err);
    return null;
  }
}

async function writeCached(uid: string, pid: string, monthKey: string, insight: PrincipalInsight, model?: string): Promise<void> {
  try {
    const ref = doc(db, "schools", uid, "principal_insights", `${pid}_${monthKey || "all"}`);
    await setDoc(ref, { insight, model: model || "", generatedAt: serverTimestamp() });
  } catch (err) {
    console.warn("[principalAI] cache write failed:", err);
  }
}

/**
 * Fetch a real-AI insight for a single principal, using cache → API route →
 * fallback chain. Returns null on failure so the caller keeps the rule-based
 * insight that's already on the row.
 */
export async function fetchPrincipalAIInsight(
  row: PrincipalRankRow,
  top: PrincipalRankRow | null,
  network: PrincipalLeaderboardData["network"],
  rank: number,
): Promise<PrincipalInsight | null> {
  const uid = auth.currentUser?.uid;
  if (!uid || !row.hasData) return null;

  const monthKey = network.monthKey || "all";
  const cached = await readCached(uid, row.id, monthKey);
  if (cached) return cached;

  let idToken = "";
  try { idToken = (await auth.currentUser?.getIdToken()) || ""; }
  catch (err) { console.warn("[principalAI] token failed:", err); return null; }
  if (!idToken) return null;

  try {
    const res = await fetch("/api/principal-insights", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        rank,
        principal: {
          id: row.id,
          name: row.name,
          branchName: row.branchName,
          ahi: row.ahi,
          attendance: row.attendance,
          passRate: row.passRate,
          feeCollection: row.feeCollection,
          students: row.students,
          teachers: row.teachers,
          atRiskStudents: row.atRiskStudents,
          weekChange: row.weekChange,
        },
        top: top && rank > 1 ? {
          name: top.name,
          branchName: top.branchName,
          ahi: top.ahi,
          attendance: top.attendance,
          passRate: top.passRate,
          feeCollection: top.feeCollection,
        } : null,
        network: {
          name: "Network",   // schoolName not strictly required server-side
          monthLabel: network.monthLabel,
          totalPrincipals: network.totalPrincipals,
          networkAvgAhi: network.networkAvgAhi,
          networkAvgAtt: network.networkAvgAtt,
          networkAvgPass: network.networkAvgPass,
          networkAvgFee: network.networkAvgFee,
        },
      }),
    });
    if (!res.ok) {
      console.warn("[principalAI] API non-200:", res.status);
      return null;
    }
    const payload = await res.json();
    const aiInsight = payload?.insight as Partial<PrincipalInsight> | undefined;
    if (!aiInsight || !aiInsight.oneLiner || !aiInsight.reasons?.length || !aiInsight.actions?.length) {
      return null;
    }
    // Preserve the rule-based mode (server doesn't classify) so the UI
    // accent colour stays consistent with the data-driven classification.
    const merged: PrincipalInsight = {
      mode: row.insight.mode,
      oneLiner: aiInsight.oneLiner,
      reasons:  aiInsight.reasons!,
      actions:  aiInsight.actions!,
      actionsLabel: aiInsight.actionsLabel || row.insight.actionsLabel,
    };
    void writeCached(uid, row.id, monthKey, merged, payload?.model);
    return merged;
  } catch (err) {
    console.warn("[principalAI] fetch error:", err);
    return null;
  }
}
