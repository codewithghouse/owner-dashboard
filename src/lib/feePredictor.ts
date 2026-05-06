/**
 * feePredictor.ts
 * Predictive fee default analysis.
 *
 * For each student with fee history, computes the probability that
 * they will default NEXT month, based on:
 *   - Payment history: how often they paid late / missed
 *   - Attendance correlation: low attendance → higher default risk
 *   - Outstanding balance: existing pending fees
 *
 * Market note: Schools lose 8–15% revenue to defaults.
 * Proactive 8-week reminders can recover 5%+ = direct ROI.
 */
import { db, auth } from "./firebase";
import {
  collection, getDocs, query, where,
} from "firebase/firestore";

export type FeeRisk = "Low" | "Medium" | "High";

export interface FeePrediction {
  studentId:       string;
  studentName:     string;
  branch:          string;
  grade:           string;
  defaultProbability: number;   // 0–100
  riskLevel:       FeeRisk;
  outstandingAmt:  number;      // sum of unpaid fees
  latePayments:    number;      // count of historically late/missed
  attendancePct:   number;
  recommendedAction: string;
}

function calcDefaultProbability(
  lateCount:    number,
  totalFees:    number,
  pendingFees:  number,
  attendance:   number,
): number {
  // Late payment history: each late adds 15pts (max 60)
  const lateRisk   = Math.min(60, lateCount * 15);
  // Current outstanding: > 0 is a strong signal
  const pendingRisk = pendingFees > 0
    ? pendingFees / Math.max(totalFees, 1) * 30   // up to 30pts
    : 0;
  // Low attendance correlates with family disengagement
  const attRisk    = attendance < 70 ? 20 : attendance < 85 ? 10 : 0;

  return Math.round(Math.min(100, lateRisk + pendingRisk + attRisk));
}

export async function fetchFeePredictions(): Promise<{
  predictions: FeePrediction[];
  totalAtRisk:  number;
  expectedOutstanding: number;
}> {
  const uid = auth.currentUser?.uid;
  if (!uid) return { predictions: [], totalAtRisk: 0, expectedOutstanding: 0 };

  try {
    // 1. Branches
    const branchSnap = await getDocs(collection(db, "schools", uid, "branches"));
    const branchMap  = new Map<string, string>();
    branchSnap.docs.forEach(d => {
      const data = d.data() as any;
      branchMap.set(data.branchId || d.id, data.name || "Branch");
    });

    // 2. All fees for this school
    const feesSnap = await getDocs(query(collection(db, "fees"), where("schoolId", "==", uid)));
    const fees = feesSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));

    // 3. Attendance for attendance correlation — schoolId-scoped to
    // prevent cross-tenant leak (memory: bug_pattern_unscoped_collection_reads).
    const attSnap = await getDocs(query(collection(db, "attendance"), where("schoolId", "==", uid)));
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

    // 4. Enrollments for name/branch/grade — schoolId-scoped to prevent
    // cross-tenant leak.
    const enrollSnap = await getDocs(query(collection(db, "enrollments"), where("schoolId", "==", uid)));
    const enrollMap  = new Map<string, any>();
    enrollSnap.docs.forEach(d => {
      const data = d.data() as any;
      const sid  = data.studentId || data.studentEmail || d.id;
      enrollMap.set(sid, data);
    });

    // 5. Group fees by student
    const studentFeeMap = new Map<string, any[]>();
    fees.forEach(f => {
      const sid = f.studentId || f.studentEmail || f.id;
      if (!studentFeeMap.has(sid)) studentFeeMap.set(sid, []);
      studentFeeMap.get(sid)!.push(f);
    });

    const predictions: FeePrediction[] = [];

    studentFeeMap.forEach((studentFees, sid) => {
      const enroll  = enrollMap.get(sid);
      const name    = enroll?.studentName || enroll?.name || "Unknown";
      const grade   = enroll?.grade || enroll?.class || "—";
      const branch  = branchMap.get(enroll?.branchId || enroll?.schoolId || "") || enroll?.schoolName || "—";

      const total   = studentFees.length;
      const pending = studentFees.filter(f => (f.status || "").toLowerCase() !== "paid");
      const paid    = studentFees.filter(f => (f.status || "").toLowerCase() === "paid");

      // Count late payments (paid but overdue, or still pending past due date)
      const today     = Date.now();
      const lateCount = studentFees.filter(f => {
        const dueDateMs = f.dueDate ? new Date(f.dueDate).getTime() : 0;
        const isPending = (f.status || "").toLowerCase() !== "paid";
        return dueDateMs > 0 && isPending && today > dueDateMs;
      }).length + Math.max(0, paid.length - total + Math.ceil(total * 0.3));
      // ↑ heuristic: if >30% were eventually paid, some were likely late

      const outstandingAmt = pending.reduce((s, f) => s + (f.amount || f.feeAmount || 0), 0);
      const att   = attMap.get(sid);
      const attPct = att && att.t > 0 ? Math.round((att.p / att.t) * 100) : 75;

      const prob  = calcDefaultProbability(lateCount, total, pending.length, attPct);

      const riskLevel: FeeRisk =
        prob >= 60 ? "High"   :
        prob >= 30 ? "Medium" : "Low";

      const recommendedAction =
        riskLevel === "High"
          ? "Send WhatsApp reminder NOW + call parents within 3 days"
          : riskLevel === "Medium"
          ? "Send automated fee reminder via WhatsApp/email this week"
          : "No action needed — low default risk";

      // Only include students who actually have outstanding fees or a history
      if (pending.length > 0 || lateCount > 0) {
        predictions.push({
          studentId:       sid,
          studentName:     name,
          branch,
          grade,
          defaultProbability: prob,
          riskLevel,
          outstandingAmt,
          latePayments:    lateCount,
          attendancePct:   attPct,
          recommendedAction,
        });
      }
    });

    predictions.sort((a, b) => b.defaultProbability - a.defaultProbability);

    const totalAtRisk       = predictions.filter(p => p.riskLevel !== "Low").length;
    const expectedOutstanding = predictions.reduce((s, p) => s + p.outstandingAmt, 0);

    return { predictions, totalAtRisk, expectedOutstanding };
  } catch (err) {
    console.error("[feePredictor] error:", err);
    return { predictions: [], totalAtRisk: 0, expectedOutstanding: 0 };
  }
}
