/**
 * analyticsService.ts
 * Shared analytics primitives used by branchesService, academicsService,
 * financeFees, and risksService to ensure data consistency.
 */
import { db, auth } from "./firebase";
import { collection, getDocs } from "firebase/firestore";

// ── in-memory cache ────────────────────────────────────────────────────────────
type CacheEntry<T> = { data: T; ts: number };
const CACHE_TTL_MS = 60_000; // 1 minute
const _cache = new Map<string, CacheEntry<unknown>>();

function getCache<T>(key: string): T | null {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) { _cache.delete(key); return null; }
  return e.data as T;
}
function setCache<T>(key: string, data: T): void {
  _cache.set(key, { data, ts: Date.now() });
}
export function invalidateCache(prefix?: string): void {
  if (!prefix) { _cache.clear(); return; }
  for (const k of _cache.keys()) { if (k.startsWith(prefix)) _cache.delete(k); }
}

// ── types ──────────────────────────────────────────────────────────────────────
export type BranchRaw = {
  id: string;
  name: string;
  color: string;
  established: string;
  location: string;
};

export type CoreSnapshot = {
  branches: BranchRaw[];
  /** studentId → canonical branchId */
  studentBranch: Map<string, string>;
  /** branchId → Set<studentId> */
  branchStudents: Map<string, Set<string>>;
  /** branchId → { total, present } */
  branchAtt: Map<string, { total: number; present: number }>;
  /** branchId → monthKey → { total, present } */
  branchMonthAtt: Map<string, Map<string, { total: number; present: number }>>;
  /** branchId → { total, passed } */
  branchRes: Map<string, { total: number; passed: number }>;
  /** branchId → { total, collected } */
  branchFees: Map<string, { total: number; collected: number }>;
  /** branchId → teacherCount */
  branchTeachers: Map<string, number>;
  /** studentId → { total, present } — for per-student alert calc */
  studentAttMap: Map<string, { total: number; present: number }>;
  months: { key: string; label: string }[];
};

const BRANCH_COLORS = ["#1e3a8a", "#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899"];

// ── helpers ────────────────────────────────────────────────────────────────────
export function avg(arr: number[]): number {
  return arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;
}

export function getLast6Months(): { key: string; label: string }[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "short" }),
    };
  });
}

export function computeStatus(ahi: number): "Strong" | "Good" | "Needs Focus" {
  if (ahi >= 85) return "Strong";
  if (ahi >= 70) return "Good";
  return "Needs Focus";
}

/** calculateAHI — weighted: 40% attendance, 40% passRate, 20% feeCollection */
export function calculateAHI(attendance: number, passRate: number, feeCollection: number): number {
  if (attendance === 0 && passRate === 0) return 0;
  const attW  = attendance   * 0.4;
  const prW   = passRate     * 0.4;
  const feeW  = feeCollection > 0 ? feeCollection * 0.2 : 0;
  const denom = feeCollection > 0 ? 1 : 0.8; // normalise when no fee data
  return Math.round((attW + prW + feeW) / denom);
}

/** calculatePassRate from raw counts */
export function calculatePassRate(passed: number, total: number): number {
  return total > 0 ? Math.round((passed / total) * 100) : 0;
}

/** generateInsights for a branch summary */
export function generateInsights(
  name: string,
  ahi: number,
  attendance: number,
  passRate: number,
  feeCollection: number,
  schoolAvgAhi: number,
  schoolAvgAtt: number
): { strengths: string[]; improvements: string[]; category: "Critical" | "Moderate" | "Healthy" } {
  const strengths: string[] = [];
  const improvements: string[] = [];

  if (attendance >= schoolAvgAtt && attendance > 0) strengths.push(`Above-average attendance (${attendance}%)`);
  if (passRate >= 85) strengths.push(`Strong academic pass rate (${passRate}%)`);
  if (feeCollection >= 90) strengths.push(`Excellent fee collection (${feeCollection}%)`);
  if (ahi >= 85) strengths.push(`Healthy Academic Health Index (${ahi}%)`);
  if (strengths.length === 0) strengths.push(`${name} is operational with active student data`);

  if (attendance > 0 && attendance < 80) improvements.push(`Attendance below critical threshold (${attendance}%)`);
  else if (attendance > 0 && attendance < schoolAvgAtt) improvements.push(`Attendance below school average (${attendance}% vs ${schoolAvgAtt}%)`);
  if (passRate > 0 && passRate < 60) improvements.push(`Pass rate requires urgent intervention (${passRate}%)`);
  else if (passRate > 0 && passRate < 75) improvements.push(`Pass rate below target (${passRate}%)`);
  if (feeCollection > 0 && feeCollection < 80) improvements.push(`Fee collection below target (${feeCollection}%)`);
  if (improvements.length === 0) improvements.push("Maintain performance standards with monthly KPI reviews");

  const category: "Critical" | "Moderate" | "Healthy" =
    ahi < 65 || (attendance > 0 && attendance < 70)
      ? "Critical"
      : ahi < 80
      ? "Moderate"
      : "Healthy";

  return { strengths, improvements, category };
}

/** getBranchTrends — monthly attendance % for a branch */
export function getBranchTrends(
  branchMonthAtt: Map<string, { total: number; present: number }>,
  months: { key: string; label: string }[],
  schoolAvgAttendance: number
): { period: string; score: number; schoolAvg: number }[] {
  return months.map(m => {
    const mAtt = branchMonthAtt.get(m.key);
    return {
      period: m.label,
      score: mAtt?.total ? Math.round((mAtt.present / mAtt.total) * 100) : 0,
      schoolAvg: schoolAvgAttendance,
    };
  });
}

// ── Core snapshot loader (shared, cached) ─────────────────────────────────────
export async function loadCoreSnapshot(uid: string): Promise<CoreSnapshot> {
  const cacheKey = `core:${uid}`;
  const cached = getCache<CoreSnapshot>(cacheKey);
  if (cached) return cached;

  const [branchesSnap, studentsSnap, attendanceSnap, resultsSnap, feesSnap, teachersSnap] =
    await Promise.all([
      getDocs(collection(db, "schools", uid, "branches")),
      getDocs(collection(db, "students")).catch(() => ({ docs: [] as any[] })),
      getDocs(collection(db, "attendance")).catch(() => ({ docs: [] as any[] })),
      getDocs(collection(db, "results")).catch(() => ({ docs: [] as any[] })),
      getDocs(collection(db, "fees")).catch(() => ({ docs: [] as any[] })),
      getDocs(collection(db, "teachers")).catch(() => ({ docs: [] as any[] })),
    ]);

  const months = getLast6Months();

  // Build branch canonical resolution map
  const anyIdToCanonical = new Map<string, string>();
  (branchesSnap.docs as any[]).forEach(d => {
    const canonical = (d.data().branchId || d.id) as string;
    [d.id, d.data().branchId, d.data().schoolId, d.data().uid]
      .filter(Boolean)
      .forEach((v: string) => anyIdToCanonical.set(v, canonical));
  });

  const resolveCanonical = (s: any): string => {
    for (const key of ["branchId", "schoolId", "school_id", "uid"]) {
      const v = s[key];
      if (v && anyIdToCanonical.has(v)) return anyIdToCanonical.get(v)!;
    }
    return s.branchId || s.schoolId || s.school_id || "";
  };

  const branches: BranchRaw[] = (branchesSnap.docs as any[]).map((d, i) => ({
    id: (d.data().branchId || d.id) as string,
    name: (d.data().name || d.data().schoolName || `Branch ${i + 1}`) as string,
    color: d.data().color || BRANCH_COLORS[i % BRANCH_COLORS.length],
    established: String(d.data().established || d.data().year || "N/A"),
    location: String(d.data().location || d.data().city || d.data().address || "—"),
  }));

  const branchStudents  = new Map<string, Set<string>>();
  const branchAtt       = new Map<string, { total: number; present: number }>();
  const branchMonthAtt  = new Map<string, Map<string, { total: number; present: number }>>();
  const branchRes       = new Map<string, { total: number; passed: number }>();
  const branchFees      = new Map<string, { total: number; collected: number }>();
  const branchTeachers  = new Map<string, number>();
  const studentBranch   = new Map<string, string>();
  const studentAttMap   = new Map<string, { total: number; present: number }>();

  branches.forEach(b => {
    branchStudents.set(b.id, new Set());
    branchAtt.set(b.id, { total: 0, present: 0 });
    branchRes.set(b.id, { total: 0, passed: 0 });
    branchFees.set(b.id, { total: 0, collected: 0 });
    branchTeachers.set(b.id, 0);
    const mMap = new Map<string, { total: number; present: number }>();
    months.forEach(m => mMap.set(m.key, { total: 0, present: 0 }));
    branchMonthAtt.set(b.id, mMap);
  });

  // Students
  (studentsSnap.docs as any[]).forEach(d => {
    const s = d.data();
    const cid = resolveCanonical(s);
    if (!branchStudents.has(cid)) return;
    branchStudents.get(cid)!.add(d.id);
    studentBranch.set(d.id, cid);
  });

  // Teachers
  (teachersSnap.docs as any[]).forEach(d => {
    const t = d.data();
    const cid = resolveCanonical(t);
    if (!branchTeachers.has(cid)) return;
    branchTeachers.set(cid, (branchTeachers.get(cid) || 0) + 1);
  });

  // Attendance
  (attendanceSnap.docs as any[]).forEach(d => {
    const a = d.data();
    const sid: string = a.studentId || "";
    const cid = studentBranch.get(sid);
    if (!cid) return;
    const present = (a.status ?? "").toString().toLowerCase() === "present";
    const bAtt = branchAtt.get(cid)!;
    bAtt.total++; if (present) bAtt.present++;
    if (!studentAttMap.has(sid)) studentAttMap.set(sid, { total: 0, present: 0 });
    const sAtt = studentAttMap.get(sid)!;
    sAtt.total++; if (present) sAtt.present++;
    let dateStr: string = a.date || a.dateStr || "";
    if (!dateStr && a.createdAt?.toDate) {
      try { dateStr = a.createdAt.toDate().toLocaleDateString("en-CA"); } catch { /* skip */ }
    }
    const ym = typeof dateStr === "string" ? dateStr.slice(0, 7) : "";
    if (ym) {
      const m = branchMonthAtt.get(cid)?.get(ym);
      if (m) { m.total++; if (present) m.present++; }
    }
  });

  // Results
  (resultsSnap.docs as any[]).forEach(d => {
    const r = d.data();
    const cid = studentBranch.get(r.studentId || "");
    if (!cid) return;
    const res = branchRes.get(cid)!;
    res.total++;
    if ((r.percentage || r.score || 0) >= 50) res.passed++;
  });

  // Fees
  (feesSnap.docs as any[]).forEach(d => {
    const f = d.data();
    const cid = studentBranch.get(f.studentId || "");
    if (!cid) return;
    const fee = branchFees.get(cid)!;
    const amount    = f.amount || f.totalAmount || f.feeAmount || 0;
    const collected = f.paidAmount || f.collectedAmount || (f.status === "paid" ? amount : 0);
    fee.total += amount;
    fee.collected += collected;
  });

  const snapshot: CoreSnapshot = {
    branches, studentBranch, branchStudents,
    branchAtt, branchMonthAtt, branchRes, branchFees,
    branchTeachers, studentAttMap, months,
  };
  setCache(cacheKey, snapshot);
  return snapshot;
}
