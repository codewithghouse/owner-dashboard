/**
 * benchmarkService.ts
 * Anonymized inter-school benchmarking.
 *
 * Reads all schools' latest snapshots (schools/{uid}/snapshots/{YYYY-MM})
 * and computes platform-wide percentiles — entirely anonymized.
 *
 * Each owner sees:
 *   - Their own AHI vs platform average vs top-quartile
 *   - Attendance / pass-rate / fee-rate comparison
 *   - Which tier they're in (Top 25% / Mid 50% / Bottom 25%)
 *
 * Market note: Principals and owners will pay for this insight alone.
 * Creates a network effect — more schools = better benchmark data.
 */
import { db, auth } from "./firebase";
import {
  collection, getDocs, orderBy, limit as fsLimit, query,
} from "firebase/firestore";

export interface BenchmarkData {
  myAhi:          number;
  myAttendance:   number;
  myPassRate:     number;
  myFeeRate:      number;
  // Platform stats (all schools, anonymized)
  platformAvgAhi:        number;
  platformAvgAttendance: number;
  platformAvgPassRate:   number;
  platformAvgFeeRate:    number;
  // Top-quartile stats
  topQuartileAhi:        number;
  // Percentile rank
  ahiPercentile:  number;   // 0–100 — "you're better than X% of schools"
  tier:           "Top 25%" | "Upper-Mid" | "Lower-Mid" | "Bottom 25%";
  totalSchools:   number;
}

export async function fetchBenchmarkData(): Promise<BenchmarkData | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;

  try {
    // 1. Get all schools (top-level docs)
    const schoolsSnap = await getDocs(collection(db, "schools"));
    if (schoolsSnap.empty) return null;

    // 2. For each school, get their latest monthly snapshot
    const allStats: { ahi: number; attendance: number; passRate: number; feeRate: number; isMe: boolean }[] = [];

    await Promise.all(
      schoolsSnap.docs.map(async schoolDoc => {
        try {
          const snapSnap = await getDocs(
            query(
              collection(db, "schools", schoolDoc.id, "snapshots"),
              orderBy("savedAt", "desc"),
              fsLimit(1),
            )
          );
          if (snapSnap.empty) return;
          const s = snapSnap.docs[0].data() as any;
          if (typeof s.ahi !== "number") return;
          allStats.push({
            ahi:        s.ahi        ?? 0,
            attendance: s.attendance ?? 0,
            passRate:   s.passRate   ?? 0,
            feeRate:    s.feeRate    ?? 0,
            isMe:       schoolDoc.id === uid,
          });
        } catch { /* skip schools without snapshots */ }
      })
    );

    if (allStats.length === 0) return null;

    const myStats = allStats.find(s => s.isMe);
    if (!myStats) return null;

    // 3. Compute platform averages
    const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

    const ahis      = allStats.map(s => s.ahi).sort((a, b) => a - b);
    const atts      = allStats.map(s => s.attendance);
    const passes    = allStats.map(s => s.passRate);
    const fees      = allStats.map(s => s.feeRate);

    const platformAvgAhi        = avg(ahis);
    const platformAvgAttendance = avg(atts);
    const platformAvgPassRate   = avg(passes);
    const platformAvgFeeRate    = avg(fees);

    // Top quartile (top 25% of schools by AHI)
    const topQ = ahis.slice(Math.floor(ahis.length * 0.75));
    const topQuartileAhi = avg(topQ);

    // Percentile rank: how many schools is mine better than?
    const betterThan = ahis.filter(v => v < myStats.ahi).length;
    const ahiPercentile = Math.round((betterThan / ahis.length) * 100);

    const tier: BenchmarkData["tier"] =
      ahiPercentile >= 75 ? "Top 25%" :
      ahiPercentile >= 50 ? "Upper-Mid" :
      ahiPercentile >= 25 ? "Lower-Mid" : "Bottom 25%";

    return {
      myAhi:          myStats.ahi,
      myAttendance:   myStats.attendance,
      myPassRate:     myStats.passRate,
      myFeeRate:      myStats.feeRate,
      platformAvgAhi,
      platformAvgAttendance,
      platformAvgPassRate,
      platformAvgFeeRate,
      topQuartileAhi,
      ahiPercentile,
      tier,
      totalSchools: allStats.length,
    };
  } catch (err) {
    console.error("[benchmarkService] error:", err);
    return null;
  }
}
