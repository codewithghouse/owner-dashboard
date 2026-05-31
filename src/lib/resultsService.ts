/**
 * resultsService.ts — Owner-side BRANCH-WISE view of exam result PDFs.
 *
 * Principals upload result PDFs into two collections (per principal-dashboard
 * PrincipalResultsUpload.tsx):
 *   • `principal_results`     — K-12 exams
 *   • `pp_principal_results`  — Pre-Primary report cards
 * Each doc carries `schoolId` (== owner uid, the tenant scope) + `classId` +
 * `studentResults[]`, but NO `branchId`. The owner oversees many branches, so
 * this service resolves every result to a branch and groups them.
 *
 * Branch attribution mirrors the canonical resolver used across the owner
 * dashboard (see analyticsService.ts `anyIdToCanonical` / `resolveCanonical`):
 *   1. The result doc's own branch fields (branchId/schoolId), if they map to a
 *      known branch.
 *   2. classId → class doc → its branch (direct branch field, else the class's
 *      teacher → teacher's branch).
 *   3. Anything left over → a synthetic "Unassigned" bucket so the per-branch
 *      totals always reconcile with the grand total (same pattern as
 *      AcademicsOverview — keeps the owner from seeing a silent shortfall).
 */
import { auth, db } from "./firebase";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";

// Same palette analyticsService uses so branch colours stay consistent
// across the whole owner dashboard.
const BRANCH_COLORS = ["#1e3a8a", "#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899"];
const UNASSIGNED_ID = "_unassigned";
const UNASSIGNED_NAME = "Unassigned";

export type ResultKind = "k12" | "pp";

export interface OwnerStudentResult {
  studentId: string;
  studentName: string;
  rollNumber?: string;
  pdfUrl: string;
  pdfName: string;
}

export interface OwnerResultDoc {
  id: string;
  kind: ResultKind;
  classId: string;
  className: string;
  section?: string;
  examName: string;
  examType: string;
  academicYear: string;
  term: string;
  examDate?: string;
  classPdfUrl?: string;
  classPdfName?: string;
  studentResults: OwnerStudentResult[];
  /** epoch ms, or null when the doc has no publishedAt yet (just-created drafts). */
  publishedAt: number | null;
  status: string;
  branchId: string;
  branchName: string;
}

export interface BranchResults {
  id: string;
  name: string;
  color: string;
  results: OwnerResultDoc[];
  /** result docs attributed to this branch */
  resultCount: number;
  /** total per-student PDFs across this branch's results */
  studentPdfCount: number;
  /** results that shipped a class-wide summary PDF */
  classPdfCount: number;
}

export interface OwnerResultsData {
  /** Only branches that actually have ≥1 result, leader-first by result count. */
  branches: BranchResults[];
  totalResults: number;
  totalStudentPdfs: number;
  k12Count: number;
  ppCount: number;
  /** True when some results couldn't be attributed to a real branch. */
  hasUnassigned: boolean;
}

interface BranchMeta { id: string; name: string; color: string }

// Firestore Timestamp | Date | string | number → epoch ms (or null).
function toMillis(v: any): number | null {
  if (!v) return null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : null;
}

function mapResultDoc(id: string, r: any, kind: ResultKind): Omit<OwnerResultDoc, "branchId" | "branchName"> {
  return {
    id,
    kind,
    classId: r.classId || "",
    className: r.className || "Class",
    section: r.section || "",
    examName: r.examName || "Result",
    examType: r.examType || "",
    academicYear: r.academicYear || "",
    term: r.term || "",
    examDate: r.examDate || "",
    classPdfUrl: r.classPdfUrl || undefined,
    classPdfName: r.classPdfName || undefined,
    studentResults: Array.isArray(r.studentResults)
      ? r.studentResults.map((s: any) => ({
          studentId: s.studentId || "",
          studentName: s.studentName || "Student",
          rollNumber: s.rollNumber ? String(s.rollNumber) : undefined,
          pdfUrl: s.pdfUrl || "",
          pdfName: s.pdfName || "result.pdf",
        }))
      : [],
    publishedAt: toMillis(r.publishedAt),
    status: r.status || "published",
  };
}

// ── Core fetch ─────────────────────────────────────────────────────────────
export async function fetchOwnerResults(): Promise<OwnerResultsData> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  const swallow = (label: string) => (err: unknown) => {
    console.warn(`[resultsService] ${label} fetch failed:`, err);
    return { docs: [] as any[] } as any;
  };

  const [branchesSnap, teachersSnap, classesSnap, k12Snap, ppSnap] = await Promise.all([
    getDocs(collection(db, "schools", uid, "branches")).catch(swallow("branches")),
    getDocs(query(collection(db, "teachers"), where("schoolId", "==", uid))).catch(swallow("teachers")),
    getDocs(query(collection(db, "classes"), where("schoolId", "==", uid))).catch(swallow("classes")),
    getDocs(query(collection(db, "principal_results"), where("schoolId", "==", uid))).catch(swallow("principal_results")),
    getDocs(query(collection(db, "pp_principal_results"), where("schoolId", "==", uid))).catch(swallow("pp_principal_results")),
  ]);

  // ── Branch list + canonical-id resolver (mirrors analyticsService) ─────────
  const branchMeta: BranchMeta[] = (branchesSnap.docs as any[]).map((d, i) => ({
    id: (d.data().branchId || d.id) as string,
    name: (d.data().name || d.data().schoolName || `Branch ${i + 1}`) as string,
    color: d.data().color || BRANCH_COLORS[i % BRANCH_COLORS.length],
  }));

  const anyIdToCanonical = new Map<string, string>();
  (branchesSnap.docs as any[]).forEach((d) => {
    const canonical = (d.data().branchId || d.id) as string;
    [d.id, d.data().branchId, d.data().schoolId, d.data().uid]
      .filter(Boolean)
      .forEach((v: string) => anyIdToCanonical.set(v, canonical));
  });
  const validBranchIds = new Set(branchMeta.map((b) => b.id));

  const resolveCanonical = (obj: any): string => {
    for (const key of ["branchId", "schoolId", "school_id", "uid"]) {
      const v = obj?.[key];
      if (v && anyIdToCanonical.has(v)) return anyIdToCanonical.get(v)!;
    }
    return "";
  };

  // teacherId (doc id) → branchId
  const teacherBranchMap = new Map<string, string>();
  (teachersSnap.docs as any[]).forEach((d) => {
    const t = d.data();
    let cid = resolveCanonical(t);
    if (!cid) cid = anyIdToCanonical.get(d.id) || "";
    if (!cid && t.uid) cid = anyIdToCanonical.get(t.uid) || "";
    if (cid && validBranchIds.has(cid)) teacherBranchMap.set(d.id, cid);
  });

  // classId → branchId (direct branch field, else via the class's teacher)
  const classBranchMap = new Map<string, string>();
  (classesSnap.docs as any[]).forEach((d) => {
    const c = d.data();
    let cid = resolveCanonical(c);
    if (!validBranchIds.has(cid)) cid = teacherBranchMap.get(c.teacherId) || "";
    if (validBranchIds.has(cid)) classBranchMap.set(d.id, cid);
  });

  // Resolve a single result doc → branchId ("" = unresolved → Unassigned).
  const resolveResultBranch = (r: any): string => {
    const direct = resolveCanonical(r);
    if (validBranchIds.has(direct)) return direct;
    const viaClass = classBranchMap.get(r.classId);
    if (viaClass && validBranchIds.has(viaClass)) return viaClass;
    return "";
  };

  // ── Collect + attribute every result ───────────────────────────────────────
  const raw: OwnerResultDoc[] = [];
  let k12Count = 0;
  let ppCount = 0;

  const ingest = (snap: any, kind: ResultKind) => {
    (snap.docs as any[]).forEach((d) => {
      const data = d.data();
      const base = mapResultDoc(d.id, data, kind);
      const bid = resolveResultBranch(data);
      raw.push({ ...base, branchId: bid || UNASSIGNED_ID, branchName: "" });
      if (kind === "k12") k12Count++; else ppCount++;
    });
  };
  ingest(k12Snap, "k12");
  ingest(ppSnap, "pp");

  const hasUnassigned = raw.some((r) => r.branchId === UNASSIGNED_ID);

  // ── Group by branch ─────────────────────────────────────────────────────────
  const order: BranchMeta[] = [...branchMeta];
  if (hasUnassigned) order.push({ id: UNASSIGNED_ID, name: UNASSIGNED_NAME, color: "#94A3B8" });

  const byBranch = new Map<string, BranchResults>();
  order.forEach((b) =>
    byBranch.set(b.id, { id: b.id, name: b.name, color: b.color, results: [], resultCount: 0, studentPdfCount: 0, classPdfCount: 0 }),
  );

  raw.forEach((r) => {
    const bucket = byBranch.get(r.branchId);
    if (!bucket) return; // resolved to a branch the owner can't see — skip defensively
    r.branchName = bucket.name;
    bucket.results.push(r);
    bucket.resultCount++;
    bucket.studentPdfCount += r.studentResults.length;
    if (r.classPdfUrl) bucket.classPdfCount++;
  });

  // newest-first inside each branch
  byBranch.forEach((b) => b.results.sort((a, c) => (c.publishedAt || 0) - (a.publishedAt || 0)));

  // Only branches that actually have results, most-results-first.
  const branches = [...byBranch.values()]
    .filter((b) => b.resultCount > 0)
    .sort((a, b) => b.resultCount - a.resultCount);

  return {
    branches,
    totalResults: raw.length,
    totalStudentPdfs: raw.reduce((s, r) => s + r.studentResults.length, 0),
    k12Count,
    ppCount,
    hasUnassigned,
  };
}

// ── Real-time subscription ──────────────────────────────────────────────────
/**
 * Live wrapper: re-aggregates whenever either result collection changes.
 * Mirrors branchesService's hybrid pattern — light onSnapshot triggers a full
 * (cheap) re-fetch + a 60s poll backstop for branch/class metadata edits.
 */
export function subscribeOwnerResults(
  onData: (d: OwnerResultsData) => void,
  onError: (e: Error) => void,
): () => void {
  let cancelled = false;
  let inflight = false;
  const uid = auth.currentUser?.uid;
  if (!uid) { onError(new Error("Not authenticated")); return () => {}; }

  const run = () => {
    if (cancelled || inflight) return;
    inflight = true;
    fetchOwnerResults()
      .then((d) => { if (!cancelled) onData(d); })
      .catch((e) => { if (!cancelled) onError(e as Error); })
      .finally(() => { inflight = false; });
  };

  run();

  const subs: Array<() => void> = [];
  for (const coll of ["principal_results", "pp_principal_results"]) {
    let initialFired = false;
    subs.push(
      onSnapshot(
        query(collection(db, coll), where("schoolId", "==", uid)),
        () => {
          if (!initialFired) { initialFired = true; return; } // initial covered by run()
          run();
        },
        (err) => console.warn(`[resultsService] ${coll} live snapshot degraded:`, err),
      ),
    );
  }

  const interval = setInterval(run, 60_000);
  return () => {
    cancelled = true;
    clearInterval(interval);
    subs.forEach((u) => u());
  };
}
