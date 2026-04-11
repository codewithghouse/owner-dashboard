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
  collection, getDocs, query, where, orderBy, limit as fsLimit,
} from "firebase/firestore";

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
export function computeFailProbability({
  attendance,
  avgScore,
  scoreTrend,
  feeDefaulted,
}: {
  attendance: number;
  avgScore: number;
  scoreTrend: number;
  feeDefaulted: boolean;
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

  // Fee default risk
  const feeRisk = feeDefaulted ? 70 : 0;

  const probability =
    attRisk       * 0.40 +
    scoreAvgRisk  * 0.35 +
    scoreTrendRisk * 0.15 +
    feeRisk       * 0.10;

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
}: {
  attendance: number;
  avgScore: number;
  scoreTrend: number;
  feeDefaulted: boolean;
  recentScores: number[];
}): string[] {
  const factors: string[] = [];
  if (attendance < 60)       factors.push(`Attendance critical at ${attendance}%`);
  else if (attendance < 75)  factors.push(`Attendance low — ${attendance}% (threshold 75%)`);
  else if (attendance < 85)  factors.push(`Attendance slightly below target (${attendance}%)`);

  if (avgScore < 40)         factors.push(`Average score very low (${avgScore}%)`);
  else if (avgScore < 55)    factors.push(`Average score below passing threshold (${avgScore}%)`);

  if (scoreTrend <= -15)     factors.push(`Score declining sharply (${scoreTrend > 0 ? "+" : ""}${scoreTrend} pts trend)`);
  else if (scoreTrend < -5)  factors.push(`Scores trending down over last exams`);

  if (feeDefaulted)          factors.push("Fee payment outstanding");

  if (recentScores.length >= 3) {
    const consecutive = recentScores.slice(0, 3);
    const allBelow    = consecutive.every(s => s < 40);
    if (allBelow)            factors.push("Failed last 3 consecutive tests");
  }

  if (factors.length === 0)  factors.push("No significant risk signals detected");
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
export async function fetchAllPredictions(): Promise<StudentRiskPrediction[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];

  try {
    // 1. branches: branchId → name
    const branchSnap = await getDocs(collection(db, "schools", uid, "branches"));
    const branchMap  = new Map<string, string>();
    branchSnap.docs.forEach(d => {
      const data = d.data() as any;
      branchMap.set(data.branchId || d.id, data.name || "Branch");
    });

    // 2. enrollments
    const enrollSnap = await getDocs(collection(db, "enrollments"));
    const enrollments = enrollSnap.docs.map(d => ({ _eid: d.id, ...d.data() as any }));

    // 3. test_scores — keep all scores per student ordered by date
    const scoresSnap = await getDocs(
      query(collection(db, "test_scores"), orderBy("createdAt", "desc"))
    );
    const scoreMap = new Map<string, { score: number; createdAt: any }[]>();
    scoresSnap.docs.forEach(d => {
      const data = d.data() as any;
      const sid  = data.studentId || data.studentEmail || "";
      const pct  = parseFloat(data.percentage ?? data.score ?? "");
      if (!sid || isNaN(pct)) return;
      if (!scoreMap.has(sid)) scoreMap.set(sid, []);
      scoreMap.get(sid)!.push({ score: pct, createdAt: data.createdAt });
    });

    // 4. attendance
    const attSnap = await getDocs(collection(db, "attendance"));
    const attMap  = new Map<string, { p: number; t: number }>();
    attSnap.docs.forEach(d => {
      const data = d.data() as any;
      const sid  = data.studentId || data.studentEmail || "";
      if (!sid) return;
      if (!attMap.has(sid)) attMap.set(sid, { p: 0, t: 0 });
      const cur = attMap.get(sid)!;
      cur.t++;
      if ((data.status || "").toLowerCase() === "present") cur.p++;
    });

    // 5. fees — find students with pending/overdue fees
    const feesSnap  = await getDocs(query(collection(db, "fees"), where("schoolId", "==", uid)));
    const feeMap    = new Map<string, boolean>(); // true = has defaulted/pending fee
    feesSnap.docs.forEach(d => {
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

      // Trend = last score - first score (positive = improving)
      const scoreTrend = recentScores.length >= 2
        ? Math.round(recentScores[0] - recentScores[recentScores.length - 1])
        : 0;

      const att    = attMap.get(sid);
      const attendance = att && att.t > 0 ? Math.round((att.p / att.t) * 100) : 0;

      const feeDefaulted = feeMap.has(sid);

      // Only predict for students with some data
      if (scores.length === 0 && att?.t === 0) return;

      const failProbability = computeFailProbability({ attendance, avgScore, scoreTrend, feeDefaulted });
      const riskLevel       = getRiskLevel(failProbability);
      const riskFactors     = buildRiskFactors({ attendance, avgScore, scoreTrend, feeDefaulted, recentScores });
      const recommendation  = buildRecommendation(riskLevel, riskFactors);

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

    // Deduplicate by studentId — keep the entry with the highest failProbability
    // (a student can appear in multiple enrollment docs for different branches)
    const seen = new Map<string, StudentRiskPrediction>();
    predictions.forEach(p => {
      const existing = seen.get(p.studentId);
      if (!existing || p.failProbability > existing.failProbability) {
        seen.set(p.studentId, p);
      }
    });

    const deduped = Array.from(seen.values());
    deduped.sort((a, b) => b.failProbability - a.failProbability);
    return deduped;

  } catch (err) {
    console.error("[riskPredictor] fetch failed:", err);
    return [];
  }
}
