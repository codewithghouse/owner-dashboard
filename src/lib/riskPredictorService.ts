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
  branch: string;                // human-readable branch NAME (for display)
  /* Canonical branchId — required for cross-dashboard linking (parent_tokens
     write, alert→branch lookups, scoping in downstream consumers). Previously
     missing from the type, so the AIPredictorPage writer was forced into an
     `(p as any).branchId || ""` cast that always evaluated to empty string —
     silently violating cross_dashboard_linking_rule. */
  branchId: string;
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
  /* Dates parallel to recentScores — same indexing, same newest-first
     ordering. ParentPortal uses these to label test bars with actual
     dates instead of "#1 #2 #3" placeholders. Empty string when source
     doc had no usable date field. */
  recentScoreDates: string[];
  feeDefaulted: boolean;
  /* Pending fee amount (₹) for the student. 0 when not defaulted. From
     `fees` (per-student records) when present, falls back to
     `fee_structure.studentRows.pending` matched by name. ParentPortal
     surfaces this in the fee status banner so parents see WHAT they owe,
     not just THAT they owe. */
  feePendingAmount: number;
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

// 60 recommendation variants split across the 4 risk levels (15 each).
// Picked deterministically by hashing the studentId so the same student
// always sees the same text on refresh (AI-like stability) while neighbouring
// students see distinct phrasing (no "every Watch student says the same thing"
// problem the screenshot 2026-05-26 surfaced).
const RECOMMENDATION_POOLS: Record<RiskLevel, string[]> = {
  Critical: [
    "Urgent: Schedule parent meeting + principal intervention + personalised tutoring plan.",
    "Immediate parent conference required. Pair student with a peer tutor and start daily check-ins.",
    "Convene a case review with class teacher, counsellor, and principal within 48 hours.",
    "Trigger Tier-3 academic support — 1:1 remedial sessions, weekly parent calls, attendance lock.",
    "Escalate to principal. Build a 30-day recovery plan with clear weekly milestones.",
    "Bring parents on board this week. Assign a faculty mentor and rework the study schedule.",
    "Initiate intensive remediation: daily after-school tutoring + parent SMS updates.",
    "Failing-this-semester risk is severe. Pull student into the Academic Support Program immediately.",
    "Personalised intervention plan needed. Loop in subject teachers and counsellor by Friday.",
    "Schedule a home visit + diagnostic test to surface root cause. Daily progress logging.",
    "Hold a formal parent-teacher conference. Set non-negotiable attendance and homework targets.",
    "Trajectory is failing. Activate full-stack support — tutoring, counselling, parent engagement.",
    "Flag for principal review. Open a grade-retention conversation with parents this week.",
    "Pair with two strong-performing classmates as study partners; review daily progress logs.",
    "Critical case — assign a dedicated mentor and reduce extra-curricular load this term.",
  ],
  High: [
    "Schedule parent meeting + assign extra tutoring sessions this month.",
    "Add to the at-risk roster for fortnightly review with class teacher.",
    "Begin weekly remedial classes; share progress reports with parents every Sunday.",
    "Pair with a top-performing classmate for peer tutoring twice a week.",
    "Set up a meeting with parents to align on a structured study routine at home.",
    "Run a diagnostic test to identify weak topics, then assign targeted practice.",
    "Move into the focused-support batch. Counsellor check-in within 7 days.",
    "Increase classroom seating proximity to teacher; daily homework verification.",
    "Send weekly progress SMS to parents; offer make-up sessions after school.",
    "Build a subject-wise improvement plan with the class teacher this week.",
    "Assign extra worksheets and review them in class within 48 hours.",
    "Enrol in the school's Saturday remedial programme; track attendance there too.",
    "Speak to parents about reducing home distractions — phone use, social calendar.",
    "Bring in a subject-specific tutor for the two weakest subjects.",
    "Track score-by-score for the next 4 tests; re-evaluate after that window.",
  ],
  Watch: [
    "Monitor closely. Send progress update to parents and check in weekly.",
    "Light follow-up — call parents this week, share encouragement and one concrete tip.",
    "Add to the monthly review list. Watch for any further dip in the next 2 tests.",
    "Offer optional after-school study time. Track engagement, not just marks.",
    "Touch base informally — a short 1:1 conversation often surfaces what scores don't.",
    "Keep an eye on attendance and recent quiz scores; intervene only if the trend worsens.",
    "Nudge parents — recommend 30 mins of additional revision at home daily.",
    "Class teacher should chat 1:1 with the student to understand any stress points.",
    "Recognise small wins publicly to build momentum; reassess in 2 weeks.",
    "Schedule a check-in during the PT meeting next month. No urgent action yet.",
    "Encourage the student to join a study group with stronger classmates.",
    "Confirm whether sleep or attendance habits are the underlying drag here.",
    "Recommend the school counsellor for a routine wellness conversation.",
    "Suggest revising the weakest topics during a weekend self-study hour.",
    "Watch closely but avoid over-flagging — student likely just needs steady momentum.",
  ],
  Safe: [
    "Student is on track. Continue regular check-ins.",
    "Performance is healthy — maintain current routine and recognise consistency.",
    "Doing well. Could be moved into a peer-tutoring role to help weaker classmates.",
    "Steady progress — no intervention required. Mention positively in next PT meeting.",
    "On a strong trajectory. Check if student is ready for advanced challenges.",
    "Maintain. Consider nominating for the school's enrichment programme.",
    "Healthy academic profile — keep a light eye but no flags right now.",
    "Stable performer. Encourage participation in inter-school competitions.",
    "On track this term. Praise effort visibly to sustain motivation.",
    "No concerns. Use as a positive example in classroom feedback.",
    "Performing well. Consider stretch goals — Olympiad, project work, leadership.",
    "Doing fine. A routine PT meeting note is sufficient.",
    "Solid attendance and scores. Set personal-best goals to keep momentum.",
    "Continue current path. Share a quick appreciation note with parents.",
    "Track casually for any signs of plateau; otherwise let the student lead.",
  ],
};

function hashStudentId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h) + id.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function buildRecommendation(
  level: RiskLevel,
  _factors: string[],
  studentId?: string,
): string {
  const pool = RECOMMENDATION_POOLS[level] ?? RECOMMENDATION_POOLS.Safe;
  if (!studentId) return pool[0];
  return pool[hashStudentId(studentId) % pool.length];
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
    /* Score + fee data is split across two co-canonical collections per
       owner_dashboard_alternate_data_sources memory rule. Schools that enter
       scores via the Teacher EnterScores flow write to `test_scores`; schools
       using the gradebook flow write to `gradebook_scores`. Same for `fees`
       (manual entries) vs `fee_structure` (configured plans). Reading only one
       silently drops ~40% of records — risk predictions then under-count
       failing students AND under-count fee defaulters, which propagates to
       the parent_tokens snapshot and shows parents an inaccurate report. */
    const [enrollSnap, scoresSnap, gradebookSnap, attSnap, feesSnap, feeStructSnap] = await Promise.all([
      getDocs(query(collection(db, "enrollments"),      where("schoolId", "==", uid))).catch(swallow("enrollments")),
      getDocs(query(collection(db, "test_scores"),      where("schoolId", "==", uid))).catch(swallow("test_scores")),
      getDocs(query(collection(db, "gradebook_scores"), where("schoolId", "==", uid))).catch(swallow("gradebook_scores")),
      getDocs(query(
        collection(db, "attendance"),
        where("schoolId", "==", uid),
        where("date", ">=", attCutoff),
      )).catch(swallow("attendance")),
      getDocs(query(collection(db, "fees"),             where("schoolId", "==", uid))).catch(swallow("fees")),
      getDocs(query(collection(db, "fee_structure"),    where("schoolId", "==", uid))).catch(swallow("fee_structure")),
    ]);

    const tsFromEnrollment = (e: any): number => {
      const v = e?.createdAt;
      if (!v) return 0;
      if (typeof v.toMillis === "function") return v.toMillis();
      if (typeof v.seconds === "number")    return v.seconds * 1000;
      return 0;
    };

    /* ── Identity alias map ──────────────────────────────────────────────
       Per dual_query_pattern_studentid_email memory: schools mix studentId
       and studentEmail across collections. An enrollment with studentId
       "abc" and a test_score doc with only studentEmail for the same
       student would NOT join under naive `data.studentId || data.studentEmail`
       keying — the student would appear as two separate predictions.

       Strategy: pre-pass through enrollments to build an alias map where
       any (studentId | studentEmail | docId) routes to a canonical key.

       ⚠ ORDERING + WRITE SEMANTICS MATTER:
         - Sort enrollments by RICHNESS DESC. An enrollment carrying BOTH
           studentId AND studentEmail establishes the strongest bridge,
           so it must claim alias entries FIRST.
         - First-write-wins via `!aliasToCanonical.has(key)`. Without this,
           a later email-only enrollment would overwrite the bridge from
           a richer enrollment — silently re-introducing the very bug
           this map exists to prevent. (Previous version sorted by
           timestamp ASC and last-write-wins, which had this bug.)

       Limitation: if NO enrollment ever carries both forms simultaneously,
       there's no information to bridge them. That's a school-level data
       hygiene issue no client-side merge can solve.
       ──────────────────────────────────────────────────────────────────── */
    const richnessSorted = [...enrollSnap.docs].sort((a: any, b: any) => {
      const ad = a.data() as any;
      const bd = b.data() as any;
      // studentId weighs more than studentEmail (more specific, less collidable)
      const aScore = (ad.studentId ? 2 : 0) + (ad.studentEmail ? 1 : 0);
      const bScore = (bd.studentId ? 2 : 0) + (bd.studentEmail ? 1 : 0);
      return bScore - aScore;
    });
    const aliasToCanonical = new Map<string, string>();
    richnessSorted.forEach((d: any) => {
      const data = d.data() as any;
      const canonical = data.studentId || data.studentEmail || d.id;
      if (data.studentId    && !aliasToCanonical.has(data.studentId))    aliasToCanonical.set(data.studentId,    canonical);
      if (data.studentEmail && !aliasToCanonical.has(data.studentEmail)) aliasToCanonical.set(data.studentEmail, canonical);
      if (!aliasToCanonical.has(d.id)) aliasToCanonical.set(d.id, canonical);
    });
    const canonicalKey = (k: string): string => aliasToCanonical.get(k) || k;

    // Enrollment-row dedup BEFORE predictions: one prediction per unique
    // student. A student in 3 classes used to produce 3 predictions which
    // were collapsed at the end with an arbitrary tie-break (the dedup at
    // the bottom kept "highest failProbability", but all 3 had the same
    // probability — fields aggregated per-student — so branch was random).
    // Now the canonical row is the most-recent enrollment, giving a stable
    // "current branch" for the prediction. (See memory:
    // bug_pattern_enrollment_row_dedup.)
    const enrollmentByStudent = new Map<string, any>();
    enrollSnap.docs.forEach((d: any) => {
      const data = { _eid: d.id, ...d.data() as any };
      // Route through canonicalKey so two enrollments for the same student
      // keyed by different id-forms (one studentId, one studentEmail) collapse.
      const sid = canonicalKey(data.studentId || data.studentEmail || data._eid);
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

    /* Score map fed by BOTH test_scores AND gradebook_scores per
       owner_dashboard_alternate_data_sources memory rule. Each source
       contributes ~50% of records depending on which entry flow the
       school uses (Teacher EnterScores vs Gradebook). canonicalKey
       routing means an email-keyed score still rolls up to the
       studentId-keyed enrollment.

       Each entry now also carries a human-readable date string so
       ParentPortal can label test bars with actual dates. Date sources
       per filterByTime field-drift memory: try date / dateStr / createdAt
       / timestamp (different writers use different fields). Empty string
       when none parse. */
    const formatDate = (ms: number): string => {
      if (!ms || !Number.isFinite(ms)) return "";
      try {
        return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
      } catch { return ""; }
    };
    const dateOf = (data: any): string => {
      // Try string-typed date fields first (writer's own date string is
      // truthful — Firestore Timestamp may differ if backfilled later).
      if (typeof data?.date === "string"   && data.date.trim())    return data.date;
      if (typeof data?.dateStr === "string" && data.dateStr.trim()) return data.dateStr;
      const ms = tsOf(data);
      return formatDate(ms);
    };
    const scoreMap = new Map<string, { score: number; ts: number; dateStr: string }[]>();
    [scoresSnap, gradebookSnap].forEach(snap => {
      snap.docs.forEach((d: any) => {
        const data = d.data() as any;
        const rawSid = data.studentId || data.studentEmail || "";
        const sid  = canonicalKey(rawSid);
        const pct  = parseFloat(data.percentage ?? data.score ?? "");
        if (!sid || isNaN(pct)) return;
        if (!scoreMap.has(sid)) scoreMap.set(sid, []);
        scoreMap.get(sid)!.push({ score: pct, ts: tsOf(data), dateStr: dateOf(data) });
      });
    });
    // Sort each student's scores newest-first (in-memory, no field-name
    // dependency at query level).
    scoreMap.forEach(arr => arr.sort((a, b) => b.ts - a.ts));

    const attMap = new Map<string, { p: number; t: number }>();
    attSnap.docs.forEach((d: any) => {
      const data = d.data() as any;
      const sid  = canonicalKey(data.studentId || data.studentEmail || "");
      if (!sid) return;
      if (!attMap.has(sid)) attMap.set(sid, { p: 0, t: 0 });
      const cur = attMap.get(sid)!;
      cur.t++;
      if ((data.status || "").toLowerCase() === "present") cur.p++;
    });

    /* Fee defaulter detection from BOTH sources, accumulating PENDING
       AMOUNT (not just a boolean) so ParentPortal can show parents the
       actual ₹ owed instead of just "Fee Pending":
         (a) `fees` collection — per-student records with proper
             studentId/studentEmail. canonicalKey routes them to the
             enrollment's canonical key. Authoritative when present.
             Amount = balance ?? amount-paidAmount, summed across pending
             docs (multi-term fees).
         (b) `fee_structure.studentRows` — per-class Excel uploads where
             rows DON'T carry studentId/studentEmail (Excel doesn't have
             those columns). Best-effort name-match: build a Map of
             lowercase-trimmed student names → pending amount, then check
             at prediction time. Multiple rows per name (rare) accumulate.
             False positives bounded by 10%-weight signal; net better than
             ignoring 40% of fee data. */
    const feeMap = new Map<string, number>(); // pending amount in ₹ (0 = none)
    feesSnap.docs.forEach((d: any) => {
      const data = d.data() as any;
      const sid  = canonicalKey(data.studentId || data.studentEmail || "");
      if (!sid) return;
      const isPending = (data.status || "").toLowerCase() !== "paid";
      if (!isPending) return;
      const amount = Number(data.balance ?? data.dueAmount ?? data.amount ?? 0);
      const paid   = Number(data.paidAmount ?? 0);
      const pending = Math.max(0, amount - paid);
      if (pending > 0) feeMap.set(sid, (feeMap.get(sid) || 0) + pending);
    });
    const structuralPendingAmounts = new Map<string, number>();
    feeStructSnap.docs.forEach((d: any) => {
      const rows = (d.data()?.studentRows || []) as any[];
      rows.forEach(st => {
        const pending = Number(st?.pending) || 0;
        const name = String(st?.studentName || "").toLowerCase().trim();
        if (pending > 0 && name) {
          structuralPendingAmounts.set(name, (structuralPendingAmounts.get(name) || 0) + pending);
        }
      });
    });

    // 6. compute predictions
    const predictions: StudentRiskPrediction[] = [];

    enrollments.forEach(e => {
      // Canonicalize the join key once — same routing the score/att/fee
      // maps used. Without canonicalKey here, an enrollment keyed by
      // studentId would miss scores keyed by studentEmail (or vice versa).
      const sid      = canonicalKey(e.studentId || e.studentEmail || e._eid);
      const name     = e.studentName || e.name || "Unknown";
      const grade    = e.grade || e.class || e.className || "—";
      /* branchId MUST be a real branch id (from schools/{uid}/branches) —
         NOT the owner's schoolId. Previous code fell back to e.schoolId
         which equals the owner's uid, silently writing a meaningless
         "branchId" into prediction → parent_tokens snapshots, breaking
         every cross_dashboard_linking_rule consumer downstream. Now: empty
         string when truly unmapped, so consumers can detect-and-flag
         instead of running queries against a bogus branch. The display
         `branch` name still falls back to schoolName for the UI. */
      const branchId = String(e.branchId || "");
      const branch   = (branchId && branchMap.get(branchId)) || e.schoolName || "—";

      const scores  = scoreMap.get(sid) || [];
      const recentSlice      = scores.slice(0, 5);                       // newest first
      const recentScores     = recentSlice.map(s => s.score);
      const recentScoreDates = recentSlice.map(s => s.dateStr);
      const avgScore = recentScores.length
        ? Math.round(recentScores.reduce((a, b) => a + b, 0) / recentScores.length)
        : 0;

      // Trend = newest score - oldest of the recent window. Positive = improving.
      const scoreTrend = recentScores.length >= 2
        ? Math.round(recentScores[0] - recentScores[recentScores.length - 1])
        : 0;

      const att    = attMap.get(sid);
      const attendance = att && att.t > 0 ? Math.round((att.p / att.t) * 100) : 0;

      /* Pending amount from EITHER source. fees collection (per-student,
         ID-keyed) is authoritative when present; fee_structure (Excel
         uploads, name-only) is the best-effort fallback. We sum the
         larger of the two — a school using both flows for the same
         student is rare, but if it happens we trust the explicit fees
         entry over the bulk Excel row (Math.max not sum, to avoid
         double-counting). */
      const feesAmount       = feeMap.get(sid) || 0;
      const structuralAmount = structuralPendingAmounts.get(name.toLowerCase().trim()) || 0;
      const feePendingAmount = Math.max(feesAmount, structuralAmount);
      const feeDefaulted     = feePendingAmount > 0;

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
      const recommendation = buildRecommendation(riskLevel, riskFactors, sid);

      predictions.push({
        studentId: sid,
        studentName: name,
        branch,
        branchId,
        grade,
        failProbability,
        riskLevel,
        riskFactors,
        recommendation,
        attendance,
        avgScore,
        scoreTrend,
        recentScores,
        recentScoreDates,
        feeDefaulted,
        feePendingAmount,
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
