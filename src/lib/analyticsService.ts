/**
 * analyticsService.ts
 * Shared analytics primitives used by branchesService, academicsService,
 * financeFees, and risksService to ensure data consistency.
 */
import { db } from "./firebase";
import {
  collection, getDocs, query, limit as fsLimit,
  orderBy, startAfter, where,
  type QueryDocumentSnapshot, type DocumentData, type Query,
} from "firebase/firestore";

// Page size per Firestore round-trip. Kept small enough that one page
// fits comfortably in memory and the network round-trip stays responsive,
// large enough that we don't spam Firestore for big collections.
const PAGE_SIZE = 500;

// Hard cap per collection to prevent runaway loops if a bad filter lets
// the query scan unbounded. Tuned for ~5 years of data for a 5K-student school.
const MAX_DOCS_PER_COLLECTION = 100_000;

/**
 * fetchAll — cursor-paginated fetch of every doc matching `baseQuery`.
 *
 * Replaces the legacy 500-doc hard limit so owner analytics never silently
 * drop records for larger schools. Uses `orderBy(__name__)` for a stable,
 * index-free cursor. Callers must pre-filter with `where("schoolId", "==", ...)`
 * so we never scan cross-tenant.
 */
async function fetchAll<T = DocumentData>(
  baseQuery: Query<T>,
  label: string,
): Promise<QueryDocumentSnapshot<T>[]> {
  const out: QueryDocumentSnapshot<T>[] = [];
  let cursor: QueryDocumentSnapshot<T> | null = null;

  while (out.length < MAX_DOCS_PER_COLLECTION) {
    const q = cursor
      ? query(baseQuery, orderBy("__name__"), startAfter(cursor), fsLimit(PAGE_SIZE))
      : query(baseQuery, orderBy("__name__"), fsLimit(PAGE_SIZE));

    const snap = await getDocs(q);
    if (snap.empty) break;

    out.push(...snap.docs);
    if (snap.docs.length < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  if (out.length >= MAX_DOCS_PER_COLLECTION) {
    console.warn(
      `[analyticsService] ${label} hit MAX_DOCS_PER_COLLECTION (${MAX_DOCS_PER_COLLECTION}). ` +
      `Archive older records or raise the cap.`,
    );
  }

  return out;
}

/** Fetch a tenant-scoped collection. Falls back to unfiltered if the
 *  collection has no schoolId field (e.g. sub-collections). */
async function fetchSchoolScoped(
  collName: string,
  uid: string,
  { scoped = true }: { scoped?: boolean } = {},
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  try {
    const base = scoped
      ? query(collection(db, collName), where("schoolId", "==", uid))
      : query(collection(db, collName));
    return await fetchAll(base, collName);
  } catch (err) {
    console.error(`[analyticsService] fetch ${collName} failed:`, err);
    return [];
  }
}

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

export type MappingIssue = {
  /** Total students that didn't resolve to any branch via the normal chain. */
  unmapped: number;
  /** Total students in scope (denominator for the unmapped ratio). */
  total: number;
  /** True when the all-students-fall-back-to-first-branch hack fired —
   *  the dashboard would show single-branch attribution that is fictional. */
  fallbackTriggered: boolean;
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
  /** Diagnostic surface for student→branch mapping problems. Null when the
   *  dataset is clean. Non-null = UI should warn the Owner that branch
   *  attribution may be inaccurate. */
  mappingIssue: MappingIssue | null;
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

/** Single source of truth for "passed" classification across the whole owner
 *  dashboard + the `aggregateSchoolStats` cloud function. Mismatched thresholds
 *  in client vs cloud caused AHI to jump 5–10% between fast/slow paths. */
export const PASS_THRESHOLD_PERCENT = 50;

/** calculateAHI — weighted: 40% attendance, 40% passRate, 20% feeCollection.
 *  Only buckets with data (value > 0) contribute to the score; the denominator
 *  scales down accordingly so a branch with only attendance data isn't punished
 *  for having no test scores or fee records yet. */
export function calculateAHI(attendance: number, passRate: number, feeCollection: number): number {
  let weighted = 0;
  let weightUsed = 0;
  if (attendance    > 0) { weighted += attendance    * 0.4; weightUsed += 0.4; }
  if (passRate      > 0) { weighted += passRate      * 0.4; weightUsed += 0.4; }
  if (feeCollection > 0) { weighted += feeCollection * 0.2; weightUsed += 0.2; }
  return weightUsed > 0 ? Math.round(weighted / weightUsed) : 0;
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

/** getBranchTrends — monthly attendance % for a branch.
 *  Returns `null` (not 0) for months with no attendance docs so the line
 *  chart can break the line at gaps. Plotting 0 falsely tells the Owner
 *  "0% attendance in March 2025" when actually no data was recorded. */
export function getBranchTrends(
  branchMonthAtt: Map<string, { total: number; present: number }>,
  months: { key: string; label: string }[],
  schoolAvgAttendance: number
): { period: string; score: number | null; schoolAvg: number }[] {
  return months.map(m => {
    const mAtt = branchMonthAtt.get(m.key);
    return {
      period: m.label,
      score: mAtt?.total ? Math.round((mAtt.present / mAtt.total) * 100) : null,
      schoolAvg: schoolAvgAttendance,
    };
  });
}

// ── Core snapshot loader (shared, cached) ─────────────────────────────────────
export async function loadCoreSnapshot(uid: string): Promise<CoreSnapshot> {
  const cacheKey = `core:${uid}`;
  const cached = getCache<CoreSnapshot>(cacheKey);
  if (cached) return cached;

  const [
    branchesDocs, studentsDocs, attendanceDocs,
    resultsDocs, testScoresDocs, gradebookDocs,
    feesDocs, feeStructureDocs,
    teachersDocs, enrollmentsDocs,
  ] = await Promise.all([
    // Branches live as a subcollection under schools/{uid}/branches — no schoolId filter needed.
    fetchAll(query(collection(db, "schools", uid, "branches")), `schools/${uid}/branches`),
    fetchSchoolScoped("students",    uid),
    fetchSchoolScoped("attendance",  uid),
    fetchSchoolScoped("results",     uid),
    fetchSchoolScoped("test_scores", uid),
    /* gradebook_scores — Teacher Dashboard's Gradebook page writes here. Was
       previously ignored, so any school whose academic data lives only in
       gradebook_scores (not test_scores or results) saw branch pass rate as
       N/A despite having real grades in Firestore. */
    fetchSchoolScoped("gradebook_scores", uid),
    fetchSchoolScoped("fees",        uid),
    /* fee_structure — Principal Dashboard's FeeStructure page writes here
       (Excel upload of class-level rates and per-student paid/pending).
       Was previously ignored — schools that maintain fee data this way
       (which is most of them) saw fee collection as N/A even though the
       paid/pending split was clearly recorded. */
    fetchSchoolScoped("fee_structure", uid),
    fetchSchoolScoped("teachers",    uid),
    fetchSchoolScoped("enrollments", uid),
  ]);

  // Adapt to the { docs: [...] } shape the rest of this function already expects.
  const branchesSnap     = { docs: branchesDocs };
  const studentsSnap     = { docs: studentsDocs };
  const attendanceSnap   = { docs: attendanceDocs };
  const resultsSnap      = { docs: resultsDocs };
  const testScoresSnap   = { docs: testScoresDocs };
  const gradebookSnap    = { docs: gradebookDocs };
  const feesSnap         = { docs: feesDocs };
  const feeStructureSnap = { docs: feeStructureDocs };
  const teachersSnap     = { docs: teachersDocs };
  const enrollmentsSnap  = { docs: enrollmentsDocs };

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

  // Teachers → build teacherId-to-branchId map
  // CRITICAL: also try teacher's doc ID (= teacher auth uid, which branches store as `uid` field)
  const teacherBranchMap = new Map<string, string>();
  (teachersSnap.docs as any[]).forEach(d => {
    const t = d.data();
    let cid = resolveCanonical(t);
    // Fallback: teacher doc ID itself might match a branch's uid
    if (!cid) cid = anyIdToCanonical.get(d.id) || "";
    // Fallback: teacher.uid field (auth uid) might match
    if (!cid && t.uid) cid = anyIdToCanonical.get(t.uid) || "";
    if (cid && branchTeachers.has(cid)) {
      branchTeachers.set(cid, (branchTeachers.get(cid) || 0) + 1);
      teacherBranchMap.set(d.id, cid);
    }
  });

  // Enrollments → build studentId-to-branchId via teacher chain
  const studentBranchViaEnrollment = new Map<string, string>();
  (enrollmentsSnap.docs as any[]).forEach(d => {
    const e = d.data();
    const sid = e.studentId as string;
    const tid = e.teacherId as string;
    if (!sid || studentBranchViaEnrollment.has(sid)) return;
    const cid = teacherBranchMap.get(tid);
    if (cid) studentBranchViaEnrollment.set(sid, cid);
  });

  // Students — try direct fields first, then enrollment chain, then doc ID
  (studentsSnap.docs as any[]).forEach(d => {
    const s = d.data();
    let cid = resolveCanonical(s);
    if (!branchStudents.has(cid)) cid = studentBranchViaEnrollment.get(d.id) || "";
    if (!branchStudents.has(cid)) cid = anyIdToCanonical.get(d.id) || "";
    if (!branchStudents.has(cid)) return;
    branchStudents.get(cid)!.add(d.id);
    studentBranch.set(d.id, cid);
  });

  // Last-resort fallback: if no students matched any branch but students exist,
  // assign all to the first branch so dashboard is never empty
  const totalMapped = [...branchStudents.values()].reduce((s, set) => s + set.size, 0);
  const totalStudentsCount = studentsSnap.docs.length;
  let unmapped = totalStudentsCount - totalMapped;
  let fallbackTriggered = false;
  if (unmapped > 0 && totalMapped > 0) {
    // Some students matched, some didn't — warn about the gap
    console.warn(
      `[analyticsService] ${unmapped} of ${totalStudentsCount} students could not be mapped to any branch.` +
      ` Check that student documents contain a valid branchId/schoolId matching a known branch.`
    );
  }
  if (totalMapped === 0 && totalStudentsCount > 0 && branches.length > 0) {
    console.warn(
      `[analyticsService] No students could be mapped to any branch — falling back to first branch (${branches[0].name}).` +
      ` This usually means branchId/schoolId fields don't match any branch document. Check data structure.`
    );
    const fallbackId = branches[0].id;
    (studentsSnap.docs as any[]).forEach(d => {
      branchStudents.get(fallbackId)!.add(d.id);
      studentBranch.set(d.id, fallbackId);
    });
    fallbackTriggered = true;
    unmapped = totalStudentsCount;
  }
  /* Surface the issue so the UI layer can render a banner instead of letting
     a silent console.warn hide a fundamentally broken attribution. The
     fallback-triggered case is the worst — single branch credited with every
     student — and Owner should see that loudly. */
  const mappingIssue: MappingIssue | null =
    (unmapped > 0 || fallbackTriggered) && totalStudentsCount > 0
      ? { unmapped, total: totalStudentsCount, fallbackTriggered }
      : null;

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

  // Results — use both `results` and `test_scores` collections.
  // Pass threshold MUST come from the exported PASS_THRESHOLD_PERCENT constant
  // (line 154) — that's the single source of truth shared with the cloud
  // function. A hardcoded literal here would drift the moment that constant
  // is tuned (e.g. 50 → 60), causing the AHI to jump silently between the
  // client and `aggregateSchoolStats` paths.
  const processResult = (r: any, cid: string) => {
    const res = branchRes.get(cid)!;
    res.total++;
    if ((r.percentage || r.score || 0) >= PASS_THRESHOLD_PERCENT) res.passed++;
  };
  (resultsSnap.docs as any[]).forEach(d => {
    const r = d.data();
    const cid = studentBranch.get(r.studentId || "");
    if (cid) processResult(r, cid);
  });
  (testScoresSnap.docs as any[]).forEach(d => {
    const r = d.data();
    const cid = studentBranch.get(r.studentId || "");
    if (cid) processResult(r, cid);
  });
  /* gradebook_scores has `mark` + `maxMarks` instead of percentage. Compute
     percentage explicitly. Branch resolution prefers the row's own branchId
     (Gradebook writer sets it directly) and falls back to the studentId
     chain — handles both writers cleanly. */
  (gradebookSnap.docs as any[]).forEach(d => {
    const r = d.data();
    let cid = "";
    if (r.branchId) cid = anyIdToCanonical.get(r.branchId) || (branchRes.has(r.branchId) ? r.branchId : "");
    if (!cid) cid = studentBranch.get(r.studentId || "") || "";
    if (!cid || !branchRes.has(cid)) return;
    const mark = Number(r.mark) || 0;
    const maxMarks = Number(r.maxMarks) || 0;
    if (maxMarks <= 0) return;
    const pct = (mark / maxMarks) * 100;
    const res = branchRes.get(cid)!;
    res.total++;
    if (pct >= PASS_THRESHOLD_PERCENT) res.passed++;
  });

  // Fees (per-student `fees` collection)
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

  /* fee_structure — Principal-uploaded Excel with class-level rates and (when
     mode === "student") per-student paid/pending split. Each doc carries a
     direct branchId so we don't need the student chain. Preference order for
     the paid/pending source:
       1. studentRows (most granular) when mode === "student"
       2. rows[].paid + rows[].pending when class-level rows carry aggregates
     Either way we sum into branchFees so .feeCollection % stays consistent
     with the per-student `fees` collection above. */
  (feeStructureSnap.docs as any[]).forEach(d => {
    const fs = d.data() as any;
    const rawBranchId = fs.branchId;
    if (!rawBranchId) return;
    const cid = anyIdToCanonical.get(rawBranchId) || (branchFees.has(rawBranchId) ? rawBranchId : "");
    if (!cid || !branchFees.has(cid)) return;
    const fee = branchFees.get(cid)!;

    const studentRows: any[] = Array.isArray(fs.studentRows) ? fs.studentRows : [];
    const classRows:   any[] = Array.isArray(fs.rows)        ? fs.rows        : [];
    const useStudent = fs.mode === "student" && studentRows.length > 0;
    const source: any[] = useStudent ? studentRows : classRows;

    source.forEach((row: any) => {
      const paid    = Number(row.paid)    || 0;
      const pending = Number(row.pending) || 0;
      const total   = paid + pending;
      if (total <= 0) return;
      fee.total     += total;
      fee.collected += paid;
    });
  });

  const snapshot: CoreSnapshot = {
    branches, studentBranch, branchStudents,
    branchAtt, branchMonthAtt, branchRes, branchFees,
    branchTeachers, studentAttMap, months,
    mappingIssue,
  };
  setCache(cacheKey, snapshot);
  return snapshot;
}
