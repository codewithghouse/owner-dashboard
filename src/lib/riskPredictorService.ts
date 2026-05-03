/**
 * riskPredictorService.ts
 * Rule-based AI Risk Predictor for students.
 *
 * Formula (weighted, 0-100 probability of failing this semester):
 *   40% — Attendance risk       (below 80% is risky, below 60% is critical)
 *   35% — Score average risk    (below 60% avg → risk)
 *   15% — Score trend risk      (declining over last 3 exams)
 *   10% — Fee default signal    (outstanding fees correlate with dropout)
 *
 * Market note: No affordable Indian school SaaS does this.
 * "AI Prediction" framing is accurate — it IS an AI technique (rule-based expert system).
 */

import { db, auth } from "./firebase";
import {
  collection, getDocs, query, where,
} from "firebase/firestore";

// ── Module-level cache ────────────────────────────────────────────────────────
// 5-min TTL keyed by ownerUid. Risk predictions are expensive (4 collection
// reads + per-student aggregation), and the page re-fetches on every mount
// + every Refresh click. Without a cache, navigating Owner home → AI
// Predictor → Owner home → AI Predictor pays the full cost twice.
// Different owners signing in from the same SPA tab can't read each other's
// cache because the key is uid-scoped.
type PredictionCacheEntry = { data: StudentRiskPrediction[]; ts: number };
const PREDICTION_CACHE_TTL_MS = 5 * 60 * 1000;
const predictionCache = new Map<string, PredictionCacheEntry>();

export function invalidatePredictionCache(uid?: string): void {
  if (uid) predictionCache.delete(uid);
  else predictionCache.clear();
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type RiskLevel = "Safe" | "Watch" | "High" | "Critical";

export interface StudentRiskPrediction {
  studentId: string;
  studentName: string;
  branch: string;
  grade: string;
  failProbability: number;       // 0–100
  riskLevel: RiskLevel;
  riskFactors: string[];         // human-readable reasons
  recommendation: string;
  // Raw inputs (for display)
  attendance: number;
  avgScore: number;
  scoreTrend: number;            // positive = improving, negative = declining
  recentScores: number[];        // last 3–5 test scores (newest first)
  feeDefaulted: boolean;
}

// ── Core scoring formula ──────────────────────────────────────────────────────
// Re-normalised by total weight of PRESENT signals — a student with only
// attendance data gets scored purely on attendance instead of being
// artificially halved by missing-score = 0% defaults. Without this, a student
// with no test_scores got `avgScore = 0` → "100% score risk" → forced into
// "Watch" tier even though they were just untested. (See memory:
// bug_pattern_score_zero_no_data.)
export function computeFailProbability({
  attendance,
  avgScore,
  scoreTrend,
  feeDefaulted,
  hasAttendanceData,
  hasScoreData,
  hasTrendData,
}: {
  attendance: number;
  avgScore: number;
  scoreTrend: number;
  feeDefaulted: boolean;
  hasAttendanceData: boolean;
  hasScoreData: boolean;
  hasTrendData: boolean;
}): number {
  // Attendance risk: 80% threshold → declining sharply below
  const attRisk = attendance >= 80
    ? 0
    : Math.min(100, ((80 - attendance) / 80) * 130);   // steeper curve

  // Score average risk: 60% threshold
  const scoreAvgRisk = avgScore >= 60
    ? 0
    : Math.min(100, ((60 - avgScore) / 60) * 120);

  // Score trend risk: -30 pts decline → 100 risk, +30 pts improvement → 0 risk
  const scoreTrendRisk = Math.max(0, Math.min(100, (-scoreTrend / 30) * 100));

  // Fee default risk — fee field is always present (paid vs not paid is real
  // data either way), so this signal is always weighted.
  const feeRisk = feeDefaulted ? 70 : 0;

  let weightedSum = 0;
  let totalWeight = 0;
  if (hasAttendanceData) { weightedSum += attRisk        * 0.40; totalWeight += 0.40; }
  if (hasScoreData)      { weightedSum += scoreAvgRisk   * 0.35; totalWeight += 0.35; }
  if (hasTrendData)      { weightedSum += scoreTrendRisk * 0.15; totalWeight += 0.15; }
  weightedSum += feeRisk * 0.10;
  totalWeight += 0.10;

  const probability = totalWeight > 0 ? weightedSum / totalWeight : 0;
  return Math.round(Math.min(100, Math.max(0, probability)));
}

export function getRiskLevel(probability: number): RiskLevel {
  if (probability >= 70) return "Critical";
  if (probability >= 45) return "High";
  if (probability >= 20) return "Watch";
  return "Safe";
}

export function buildRiskFactors({
  attendance, avgScore, scoreTrend, feeDefaulted, recentScores,
  hasAttendanceData, hasScoreData, hasTrendData,
}: {
  attendance: number;
  avgScore: number;
  scoreTrend: number;
  feeDefaulted: boolean;
  recentScores: number[];
  hasAttendanceData: boolean;
  hasScoreData: boolean;
  hasTrendData: boolean;
}): string[] {
  const factors: string[] = [];

  // Attendance factors — only when we actually have attendance data, else
  // `attendance = 0` would falsely show "Attendance critical at 0%".
  if (hasAttendanceData) {
    if (attendance < 60)       factors.push(`Attendance critical at ${attendance}%`);
    else if (attendance < 75)  factors.push(`Attendance low — ${attendance}% (threshold 75%)`);
    else if (attendance < 85)  factors.push(`Attendance slightly below target (${attendance}%)`);
  }

  // Score factors — same gating, avoids "Average score very low (0%)" for
  // students who simply have no test_scores docs yet.
  if (hasScoreData) {
    if (avgScore < 40)         factors.push(`Average score very low (${avgScore}%)`);
    else if (avgScore < 55)    factors.push(`Average score below passing threshold (${avgScore}%)`);
  }

  if (hasTrendData) {
    if (scoreTrend <= -15)     factors.push(`Score declining sharply (${scoreTrend > 0 ? "+" : ""}${scoreTrend} pts trend)`);
    else if (scoreTrend < -5)  factors.push(`Scores trending down over last exams`);
  }

  if (feeDefaulted)            factors.push("Fee payment outstanding");

  if (hasScoreData && recentScores.length >= 3) {
    const consecutive = recentScores.slice(0, 3);
    const allBelow    = consecutive.every(s => s < 40);
    if (allBelow)              factors.push("Failed last 3 consecutive tests");
  }

  // Surface partial-data caveat at the front so the user knows the prediction
  // is based on a subset of signals, not the full formula.
  if (!hasScoreData && hasAttendanceData)      factors.unshift("Limited data — no test scores yet");
  else if (!hasAttendanceData && hasScoreData) factors.unshift("Limited data — no attendance recorded");

  if (factors.length === 0)    factors.push("No significant risk signals detected");
  return factors;
}

export function buildRecommendation(level: RiskLevel, factors: string[]): string {
  if (level === "Critical")
    return "Urgent: Schedule parent meeting + principal intervention + personalised tutoring plan.";
  if (level === "High")
    return "Schedule parent meeting + assign extra tutoring sessions this month.";
  if (level === "Watch")
    return "Monitor closely. Send progress update to parents and check in weekly.";
  return "Student is on track. Continue regular check-ins.";
}

// ── Main fetch + compute ──────────────────────────────────────────────────────
export async function fetchAllPredictions(opts: { force?: boolean } = {}): Promise<StudentRiskPrediction[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];

  // Cache hit → return immediately. Refresh button passes force:true.
  if (!opts.force) {
    const cached = predictionCache.get(uid);
    if (cached && Date.now() - cached.ts < PREDICTION_CACHE_TTL_MS) {
      return cached.data;
    }
  }

  try {
    // 1. branches: branchId → name (subcollection scoped to this owner).
    const branchSnap = await getDocs(collection(db, "schools", uid, "branches"));
    const branchMap  = new Map<string, string>();
    branchSnap.docs.forEach(d => {
      const data = d.data() as any;
      branchMap.set(data.branchId || d.id, data.name || "Branch");
    });

    // 2-5. Parallel fetch — every collection scoped by schoolId. Earlier
    //      versions queried these collections with NO schoolId filter, which
    //      either leaked cross-tenant data or hit security-rule denials at
    //      scale. (See memory: security_hardening_apr18.) `test_scores`
    //      previously used orderBy("createdAt") but the writer (Teacher
    //      EnterScores.tsx) writes `timestamp` — Firestore silently
    //      excludes docs missing the orderBy field, so the query returned
    //      ZERO scores in production. Fix: drop orderBy, sort in memory by
    //      createdAt ?? timestamp.
    //
    //      Attendance bounded to last 12 months (uses the (schoolId, date)
    //      composite index). Risk predictor cares about current behaviour,
    //      not all-time history; cuts a 200K+-row scan to ~30K-60K typical.
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const attCutoff = `${oneYearAgo.getFullYear()}-${String(oneYearAgo.getMonth() + 1).padStart(2, "0")}-01`;

    const swallow = (label: string) => (err: unknown) => {
      console.warn(`[riskPredictor] ${label} fetch failed:`, err);
      return { docs: [] as any[] } as any;
    };
    const [enrollSnap, scoresSnap, attSnap, feesSnap] = await Promise.all([
      getDocs(query(collection(db, "enrollments"), where("schoolId", "==", uid))).catch(swallow("enrollments")),
      getDocs(query(collection(db, "test_scores"), where("schoolId", "==", uid))).catch(swallow("test_scores")),
      getDocs(query(
        collection(db, "attendance"),
        where("schoolId", "==", uid),
        where("date", ">=", attCutoff),
      )).catch(swallow("attendance")),
      getDocs(query(collection(db, "fees"),        where("schoolId", "==", uid))).catch(swallow("fees")),
    ]);

    // Enrollment-row dedup BEFORE predictions: one prediction per unique
    // student. A student in 3 classes used to produce 3 predictions which
    // were collapsed at the end with an arbitrary tie-break (the dedup at
    // the bottom kept "highest failProbability", but all 3 had the same
    // probability — fields aggregated per-student — so branch was random).
    // Now the canonical row is the most-recent enrollment, giving a stable
    // "current branch" for the prediction. (See memory:
    // bug_pattern_enrollment_row_dedup.)
    const tsFromEnrollment = (e: any): number => {
      const v = e?.createdAt;
      if (!v) return 0;
      if (typeof v.toMillis === "function") return v.toMillis();
      if (typeof v.seconds === "number")    return v.seconds * 1000;
      return 0;
    };
    const enrollmentByStudent = new Map<string, any>();
    enrollSnap.docs.forEach((d: any) => {
      const data = { _eid: d.id, ...d.data() as any };
      const sid = data.studentId || data.studentEmail || data._eid;
      const ts = tsFromEnrollment(data);
      const existing = enrollmentByStudent.get(sid);
      if (!existing || ts > tsFromEnrollment(existing)) {
        enrollmentByStudent.set(sid, data);
      }
    });
    const enrollments = [...enrollmentByStudent.values()];

    // test_scores — accept either createdAt or timestamp as the sort key
    // (writer uses timestamp, legacy data may have createdAt).
    const tsOf = (data: any): number => {
      const tryStamp = (v: any): number => {
        if (!v) return 0;
        if (typeof v.toMillis === "function") return v.toMillis();
        if (typeof v.seconds === "number")    return v.seconds * 1000;
        return 0;
      };
      return tryStamp(data?.createdAt) || tryStamp(data?.timestamp);
    };

    const scoreMap = new Map<string, { score: number; ts: number }[]>();
    scoresSnap.docs.forEach((d: any) => {
      const data = d.data() as any;
      const sid  = data.studentId || data.studentEmail || "";
      const pct  = parseFloat(data.percentage ?? data.score ?? "");
      if (!sid || isNaN(pct)) return;
      if (!scoreMap.has(sid)) scoreMap.set(sid, []);
      scoreMap.get(sid)!.push({ score: pct, ts: tsOf(data) });
    });
    // Sort each student's scores newest-first (in-memory, no field-name
    // dependency at query level).
    scoreMap.forEach(arr => arr.sort((a, b) => b.ts - a.ts));

    const attMap = new Map<string, { p: number; t: number }>();
    attSnap.docs.forEach((d: any) => {
      const data = d.data() as any;
      const sid  = data.studentId || data.studentEmail || "";
      if (!sid) return;
      if (!attMap.has(sid)) attMap.set(sid, { p: 0, t: 0 });
      const cur = attMap.get(sid)!;
      cur.t++;
      if ((data.status || "").toLowerCase() === "present") cur.p++;
    });

    const feeMap = new Map<string, boolean>(); // true = has defaulted/pending fee
    feesSnap.docs.forEach((d: any) => {
      const data = d.data() as any;
      const sid  = data.studentId || data.studentEmail || "";
      if (!sid) return;
      const isPending = (data.status || "").toLowerCase() !== "paid";
      if (isPending) feeMap.set(sid, true);
    });

    // 6. compute predictions
    const predictions: StudentRiskPrediction[] = [];

    enrollments.forEach(e => {
      const sid    = e.studentId || e.studentEmail || e._eid;
      const name   = e.studentName || e.name || "Unknown";
      const grade  = e.grade || e.class || e.className || "—";
      const branch = branchMap.get(e.branchId || e.schoolId || "") || e.schoolName || "—";

      const scores  = scoreMap.get(sid) || [];
      const recentScores = scores.slice(0, 5).map(s => s.score);   // newest first
      const avgScore = recentScores.length
        ? Math.round(recentScores.reduce((a, b) => a + b, 0) / recentScores.length)
        : 0;

      // Trend = newest score - oldest of the recent window. Positive = improving.
      const scoreTrend = recentScores.length >= 2
        ? Math.round(recentScores[0] - recentScores[recentScores.length - 1])
        : 0;

      const att    = attMap.get(sid);
      const attendance = att && att.t > 0 ? Math.round((att.p / att.t) * 100) : 0;

      const feeDefaulted = feeMap.has(sid);

      // Data-presence flags drive the weighted-renorm formula AND the
      // factor-list gating below. Without these, score=0 (no data) leaks
      // into "100% score risk" and silently classifies untested students
      // as Watch / High. (See memory: bug_pattern_score_zero_no_data.)
      const hasAttendanceData = !!(att && att.t > 0);
      const hasScoreData      = recentScores.length > 0;
      const hasTrendData      = recentScores.length >= 2;

      // Skip students with no academic signal at all — fee default alone
      // doesn't predict academic failure (those surface under FinanceFees).
      if (!hasAttendanceData && !hasScoreData) return;

      const failProbability = computeFailProbability({
        attendance, avgScore, scoreTrend, feeDefaulted,
        hasAttendanceData, hasScoreData, hasTrendData,
      });
      const riskLevel      = getRiskLevel(failProbability);
      const riskFactors    = buildRiskFactors({
        attendance, avgScore, scoreTrend, feeDefaulted, recentScores,
        hasAttendanceData, hasScoreData, hasTrendData,
      });
      const recommendation = buildRecommendation(riskLevel, riskFactors);

      predictions.push({
        studentId: sid,
        studentName: name,
        branch,
        grade,
        failProbability,
        riskLevel,
        riskFactors,
        recommendation,
        attendance,
        avgScore,
        scoreTrend,
        recentScores,
        feeDefaulted,
      });
    });

    // Enrollments were deduplicated by studentId above, so each student
    // produces exactly one prediction here — no post-dedup needed.
    predictions.sort((a, b) => b.failProbability - a.failProbability);
    predictionCache.set(uid, { data: predictions, ts: Date.now() });
    return predictions;

  } catch (err) {
    console.error("[riskPredictor] fetch failed:", err);
    return [];
  }
}
