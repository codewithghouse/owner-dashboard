/**
 * feeHistoryService.ts
 *
 * Single source of truth for "fees over last 6 months" used by:
 *  - Dashboard.tsx → Revenue Trend chart (Collected + Pending)
 *  - FinanceFees.tsx → Monthly Collection Trend chart (can adopt later)
 *
 * Match logic mirrors FinanceFees.historyData:
 *  - Buckets by month + year (NOT just month — important across year-end)
 *  - paid → collected, anything else → pending
 *  - amount = parseFloat(amount ?? totalAmount)
 *
 * 60-second in-memory cache per uid.
 */
import { db } from "./firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CACHE_TTL_MS = 60_000;

export interface FeeHistoryPoint {
  month: string;       // "Apr"
  monthIdx: number;    // 0-11
  year: number;        // 2026
  collected: number;   // ₹ in thousands
  pending: number;     // ₹ in thousands
  revenue: number;     // alias for collected, kept for the existing Dashboard chart
}

interface CacheEntry { data: FeeHistoryPoint[]; ts: number }
const _cache = new Map<string, CacheEntry>();

function cacheKey(uid: string, branchId?: string): string {
  return branchId ? `${uid}::${branchId}` : uid;
}

function parseAmount(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toDate(v: unknown): Date | null {
  if (!v || typeof v !== "object") return null;
  const x = v as { toDate?: () => Date };
  if (typeof x.toDate === "function") {
    try { return x.toDate(); } catch { return null; }
  }
  return null;
}

export function invalidateFeeHistoryCache(uid?: string): void {
  if (!uid) { _cache.clear(); return; }
  for (const key of _cache.keys()) {
    if (key === uid || key.startsWith(`${uid}::`)) _cache.delete(key);
  }
}

/**
 * Last-6-months fee history for an owner.
 * Pass `branchId` to filter to a single branch (matches `branchId` field on fee docs).
 */
export async function fetchFeeHistory(
  uid: string, branchId?: string,
): Promise<FeeHistoryPoint[]> {
  if (!uid) return [];

  const key = cacheKey(uid, branchId);
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  // Build the last-6-month skeleton (oldest → newest, INCLUDES year for cross-year correctness)
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return { label: MONTH_NAMES[d.getMonth()], monthIdx: d.getMonth(), year: d.getFullYear() };
  });

  let feesSnap;
  try {
    feesSnap = await getDocs(query(collection(db, "fees"), where("schoolId", "==", uid)));
  } catch (err) {
    console.warn("[feeHistoryService] fees query failed:", err);
    return months.map(m => ({
      month: m.label, monthIdx: m.monthIdx, year: m.year,
      collected: 0, pending: 0, revenue: 0,
    }));
  }

  // Pre-parse fee docs so we don't re-walk for every month bucket.
  const docs = feesSnap.docs.map(d => {
    const data = d.data() as Record<string, unknown>;
    const dateRaw = data.paidAt ?? data.createdAt;
    const date = toDate(dateRaw);
    return {
      branchId: typeof data.branchId === "string" ? data.branchId : "",
      status: String(data.status || "").toLowerCase(),
      amount: parseAmount(data.amount ?? data.totalAmount),
      date,
    };
  }).filter(f => f.date && (!branchId || f.branchId === branchId));

  const data: FeeHistoryPoint[] = months.map(({ label, monthIdx, year }) => {
    let collected = 0, pending = 0;
    docs.forEach(f => {
      if (!f.date) return;
      if (f.date.getMonth() !== monthIdx || f.date.getFullYear() !== year) return;
      if (f.status === "paid") collected += f.amount;
      else                     pending   += f.amount;
    });
    const collectedK = Math.round(collected / 1000);
    return {
      month: label, monthIdx, year,
      collected: collectedK,
      pending: Math.round(pending / 1000),
      revenue: collectedK, // alias
    };
  });

  _cache.set(key, { data, ts: Date.now() });
  return data;
}
