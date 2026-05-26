/**
 * branchWeeklyInsights.ts — Owner-side AI insight fetcher with weekly cache.
 *
 * Surfaces below the Historical Performance chart on the Branch Detail page:
 *   • trendReasons       — why the trend looks like it does
 *   • suggestions        — actionable next steps
 *   • strengths          — what this branch is doing well, with numbers
 *   • areasOfImprovement — what's lagging and by how much
 *
 * Flow:
 *   1. Compute ISO-week key for "this week" (Mon-anchored).
 *   2. Read Firestore cache at `branch_weekly_insights/{branchId}_{isoWeek}`.
 *   3. On miss → POST to /api/branch-weekly-insights → write doc back.
 *   4. On any failure → return a rule-based fallback so the UI never blanks.
 *
 * The weekly cadence means the AI fires at most once per branch per week
 * regardless of how many times the owner opens the page — caps cost and
 * keeps the insight stable enough for a weekly review meeting.
 */
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, functions } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";

export interface InsightItem {
  headline: string;
  detail: string;
}

export interface BranchWeeklyInsight {
  trendReasons: InsightItem[];
  suggestions: InsightItem[];
  strengths: InsightItem[];
  areasOfImprovement: InsightItem[];
  generatedAt: number;
  model: string;
  source: "ai" | "cache" | "fallback";
}

export interface BranchInsightInput {
  branchId: string;
  name: string;
  ahi: number;
  attendance: number;
  passRate: number;
  feeCollection: number;
  growthRate: number;
  studentCount: number;
  teacherCount: number;
  activeAlerts: number;
  historicalTrend: { period: string; score: number | null }[];
}

export interface NetworkInsightInput {
  avgAhi: number;
  avgAttendance: number;
  avgPassRate: number;
  avgFeeCollection: number;
}

// ── ISO week key ──────────────────────────────────────────────────────────
/**
 * Returns a string like "2026-W21" derived from the current UTC date.
 * ISO 8601: weeks start Monday; week 1 is the one containing the first
 * Thursday of the year. Matches what the leaderboardPlanCache uses.
 */
export function currentISOWeekKey(now: Date = new Date()): string {
  // Clone to avoid mutating the caller's date.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // Thursday of this week (ISO uses Mon=1..Sun=7; 4 = Thursday)
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

// ── Cache I/O ─────────────────────────────────────────────────────────────
function cacheDocId(branchId: string, weekKey: string): string {
  // Sanitize branchId so it never contains characters Firestore rejects.
  const safe = branchId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${safe}_${weekKey}`;
}

async function readCache(branchId: string, weekKey: string): Promise<BranchWeeklyInsight | null> {
  try {
    const ref = doc(db, "branch_weekly_insights", cacheDocId(branchId, weekKey));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data() as any;
    // Defensive shape check — a stale schema shouldn't blank the UI.
    if (!Array.isArray(data?.trendReasons)) return null;
    return {
      trendReasons:       data.trendReasons || [],
      suggestions:        data.suggestions || [],
      strengths:          data.strengths || [],
      areasOfImprovement: data.areasOfImprovement || [],
      generatedAt:        Number(data.generatedAt) || Date.now(),
      model:              String(data.model || "cache"),
      source:             "cache",
    };
  } catch (err) {
    console.warn("[branchWeeklyInsights] readCache failed", err);
    return null;
  }
}

async function writeCache(
  branchId: string, weekKey: string, insight: Omit<BranchWeeklyInsight, "source">,
): Promise<void> {
  try {
    const uid = auth.currentUser?.uid;
    const ref = doc(db, "branch_weekly_insights", cacheDocId(branchId, weekKey));
    await setDoc(ref, {
      ...insight,
      branchId,
      weekKey,
      ownerUid: uid || "",
      schoolId: uid || "", // owner-dashboard scopes schools by uid
      cachedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn("[branchWeeklyInsights] writeCache failed", err);
  }
}

// ── Rule-based fallback ───────────────────────────────────────────────────
/**
 * Deterministic fallback when AI is unavailable (no API key, rate limited,
 * network error). Same shape as the AI output so the UI is identical.
 * Threshold logic mirrors what generateInsights() does in branchesService.ts.
 */
function ruleBasedFallback(
  branch: BranchInsightInput, network: NetworkInsightInput,
): Omit<BranchWeeklyInsight, "source"> {
  const trendReasons: InsightItem[] = [];
  const suggestions: InsightItem[] = [];
  const strengths: InsightItem[] = [];
  const areasOfImprovement: InsightItem[] = [];

  // Trend reasons — derive from recent historical trend slope.
  const recent = (branch.historicalTrend || [])
    .filter(t => typeof t.score === "number" && t.score! > 0)
    .slice(-4)
    .map(t => t.score as number);
  if (recent.length >= 2) {
    const first = recent[0];
    const last = recent[recent.length - 1];
    const delta = last - first;
    if (delta > 2) {
      trendReasons.push({
        headline: `${delta.toFixed(1)}-point lift over last ${recent.length} periods`,
        detail: `Score rose from ${first.toFixed(0)} to ${last.toFixed(0)} — interventions or natural seasonality may be paying off.`,
      });
    } else if (delta < -2) {
      trendReasons.push({
        headline: `${Math.abs(delta).toFixed(1)}-point drop over last ${recent.length} periods`,
        detail: `Score fell from ${first.toFixed(0)} to ${last.toFixed(0)} — investigate attendance, exams, or teacher staffing changes.`,
      });
    } else {
      trendReasons.push({
        headline: "Trend roughly stable",
        detail: `Recent scores around ${last.toFixed(0)} — no major swings to explain.`,
      });
    }
  } else {
    trendReasons.push({
      headline: "Not enough trend data yet",
      detail: "Record at least 2 weeks of attendance + assessment to generate trend insights.",
    });
  }

  // Strengths & areas — gap vs network average.
  if (branch.attendance > 0 && branch.attendance >= network.avgAttendance + 2) {
    strengths.push({
      headline: `Attendance ${branch.attendance.toFixed(0)}% beats network`,
      detail: `${(branch.attendance - network.avgAttendance).toFixed(1)} points above the ${network.avgAttendance.toFixed(0)}% network average — keep parent engagement going.`,
    });
  }
  if (branch.passRate > 0 && branch.passRate >= network.avgPassRate + 2) {
    strengths.push({
      headline: `Pass rate ${branch.passRate.toFixed(0)}% leads`,
      detail: `${(branch.passRate - network.avgPassRate).toFixed(1)} points over network average — academic foundations are working.`,
    });
  }
  if (branch.feeCollection > 0 && branch.feeCollection >= 90) {
    strengths.push({
      headline: `Fee collection ${branch.feeCollection.toFixed(0)}%`,
      detail: `Healthy operational cash flow — collections process is disciplined.`,
    });
  }
  if (strengths.length === 0) {
    strengths.push({
      headline: "Baseline operating",
      detail: "No metric is meaningfully above the network average yet — focus on the priority area below.",
    });
  }

  if (branch.attendance > 0 && branch.attendance < network.avgAttendance - 2) {
    areasOfImprovement.push({
      headline: `Attendance ${branch.attendance.toFixed(0)}% trails network`,
      detail: `${(network.avgAttendance - branch.attendance).toFixed(1)} points below the ${network.avgAttendance.toFixed(0)}% network average.`,
    });
    suggestions.push({
      headline: "Parent-call drive within 14 days",
      detail: "Have the class teacher call every parent of a student below 80% attendance — track outcomes weekly.",
    });
  }
  if (branch.passRate > 0 && branch.passRate < network.avgPassRate - 2) {
    areasOfImprovement.push({
      headline: `Pass rate ${branch.passRate.toFixed(0)}% lagging`,
      detail: `${(network.avgPassRate - branch.passRate).toFixed(1)} points behind network — review subject-wise gaps.`,
    });
    suggestions.push({
      headline: "Remedial classes for bottom quartile",
      detail: "Identify the 25% lowest scorers and run targeted Saturday remedial — review after 4 weeks.",
    });
  }
  if (branch.feeCollection > 0 && branch.feeCollection < 80) {
    areasOfImprovement.push({
      headline: `Fee collection ${branch.feeCollection.toFixed(0)}% below 80%`,
      detail: `Cash flow at risk — defaulter list needs immediate review.`,
    });
    suggestions.push({
      headline: "Defaulter outreach this week",
      detail: "Use the Fee Structure → Defaulters tab to send personalised reminders. Escalate to principal after 7 days.",
    });
  }
  if (branch.studentCount > 0) {
    const atRiskPct = (branch.activeAlerts / branch.studentCount) * 100;
    if (atRiskPct >= 10) {
      areasOfImprovement.push({
        headline: `${branch.activeAlerts} at-risk students (${atRiskPct.toFixed(1)}%)`,
        detail: `${atRiskPct.toFixed(0)}% of the class needs intervention — group counselling recommended.`,
      });
    }
  }
  if (areasOfImprovement.length === 0) {
    areasOfImprovement.push({
      headline: "No critical gaps detected",
      detail: "All headline metrics are at or above network average — maintain current routines and continue weekly reviews.",
    });
    suggestions.push({
      headline: "Lock in the routines that are working",
      detail: "Document the current weekly cadence so the next principal can replicate it. Look at branch leaderboard for opportunities to share with peers.",
    });
  }

  return {
    trendReasons,
    suggestions,
    strengths,
    areasOfImprovement,
    generatedAt: Date.now(),
    model: "rule-based",
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Fetch (or compute, or fall back) the weekly insight for a branch.
 *
 * NEVER throws — the UI consumer can just unconditionally render whatever
 * comes back. `source` tells you whether it's fresh AI, cached, or fallback.
 */
export async function fetchBranchWeeklyInsight(
  branch: BranchInsightInput,
  network: NetworkInsightInput,
): Promise<BranchWeeklyInsight> {
  const weekKey = currentISOWeekKey();
  const cached = await readCache(branch.branchId, weekKey);
  if (cached) return cached;

  // Try the AI endpoint.
  try {
    if (!auth.currentUser) {
      const fb = ruleBasedFallback(branch, network);
      return { ...fb, source: "fallback" };
    }

    const callable = httpsCallable<unknown, { insight?: any; model?: string; generatedAt?: number }>(
      functions, "getBranchWeeklyInsight",
    );
    const res = await callable({
      branch: {
        name: branch.name,
        ahi: branch.ahi,
        attendance: branch.attendance,
        passRate: branch.passRate,
        feeCollection: branch.feeCollection,
        growthRate: branch.growthRate,
        studentCount: branch.studentCount,
        teacherCount: branch.teacherCount,
        activeAlerts: branch.activeAlerts,
        historicalTrend: branch.historicalTrend,
      },
      network,
    });

    const data = res.data;
    const aiInsight = data?.insight;
    if (!aiInsight || !Array.isArray(aiInsight?.trendReasons)) {
      const fb = ruleBasedFallback(branch, network);
      return { ...fb, source: "fallback" };
    }

    const payload: Omit<BranchWeeklyInsight, "source"> = {
      trendReasons:       aiInsight.trendReasons || [],
      suggestions:        aiInsight.suggestions || [],
      strengths:          aiInsight.strengths || [],
      areasOfImprovement: aiInsight.areasOfImprovement || [],
      generatedAt:        Number(data.generatedAt) || Date.now(),
      model:              String(data.model || "gpt-4o-mini"),
    };

    // Fire-and-forget cache write — UI doesn't wait.
    void writeCache(branch.branchId, weekKey, payload);

    return { ...payload, source: "ai" };
  } catch (err) {
    console.warn("[branchWeeklyInsights] fetch failed, falling back", err);
    const fb = ruleBasedFallback(branch, network);
    return { ...fb, source: "fallback" };
  }
}
