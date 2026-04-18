/**
 * cloudAggregation.ts
 * Calls the `aggregateSchoolStats` Cloud Function which returns server-computed
 * branch-level stats. Keeps the owner dashboard fast (200ms vs 5s+ client-side
 * aggregation of 60K+ docs) and slashes Firestore read costs ~95%.
 *
 * Cached server-side for 5 minutes per owner uid; pass force=true to bypass.
 */
import { getFunctions, httpsCallable } from "firebase/functions";

const FUNCTIONS_REGION = "us-central1";

export type CloudBranchStat = {
  id: string;
  name: string;
  color: string;
  established: string;
  location: string;
  students: number;
  teachers: number;
  attendance: number;     // percent
  passRate: number;       // percent
  feeCollection: number;  // percent
  ahi: number;            // 0-100
  feesCollected: number;
  feesTotal: number;
};

export type CloudSchoolStats = {
  branches: CloudBranchStat[];
  totals: {
    totalStudents: number;
    totalTeachers: number;
    avgAttendance: number;
    avgPassRate: number;
    avgAhi: number;
  };
  computedAt: number;     // ms epoch
  fromCache: boolean;
};

// ── Client-side micro-cache to deduplicate concurrent in-flight calls ────────
let inflight: Promise<CloudSchoolStats> | null = null;
let lastResult: { data: CloudSchoolStats; ts: number } | null = null;
const CLIENT_TTL_MS = 30_000; // 30s — server already caches 5 min, this just dedupes bursts

export async function loadDashboardStats(opts: { force?: boolean } = {}): Promise<CloudSchoolStats> {
  if (!opts.force && lastResult && Date.now() - lastResult.ts < CLIENT_TTL_MS) {
    return lastResult.data;
  }
  if (inflight && !opts.force) return inflight;

  inflight = (async () => {
    try {
      const fns = getFunctions(undefined, FUNCTIONS_REGION);
      const call = httpsCallable<{ force?: boolean }, CloudSchoolStats>(fns, "aggregateSchoolStats");
      const res = await call({ force: !!opts.force });
      const data = res.data;
      lastResult = { data, ts: Date.now() };
      return data;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function invalidateDashboardCache(): void {
  lastResult = null;
}