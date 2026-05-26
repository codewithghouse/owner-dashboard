/**
 * academicsService.ts
 *
 * Data pipeline:
 *   schools       → branch list (excluding owner)
 *   teachers      → teacherId:schoolId + teacherId:subject maps
 *   classes       → classId:{ grade, subject } map
 *   results       → primary score source  (has schoolId)
 *   test_scores   → secondary score source (may lack schoolId → fallback via teacherId map)
 *   enrollments   → student counts per school
 *   attendance    → attendance rates per school
 */
import { db, auth } from "./firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { PASS_THRESHOLD_PERCENT } from "./analyticsService";

// Pass-rate sublabel — derived from the shared platform constant so the
// label and the math can never drift. (Earlier the label said "≥ 40%"
// while the cloud aggregator and Dashboard.tsx used 50% — same school
// showed two different numbers per page.)
const PASS_THRESHOLD_LABEL = `Students scoring ≥ ${PASS_THRESHOLD_PERCENT}%`;

// ── Module-level caches ──────────────────────────────────────────────────────
// 5-min TTL keyed by ownerUid (overview) and by ownerUid:subjectId
// (subject detail). Earlier the page re-ran 7 collection reads on every
// mount + every navigation back to /academics; with cache, repeat visits
// inside the TTL are 0 reads. Different owners signing in from the same
// SPA tab can't read each other's cache because the keys are uid-scoped.
const ACADEMICS_CACHE_TTL_MS = 5 * 60 * 1000;
let overviewCache: { uid: string; data: AcademicsOverviewData; ts: number } | null = null;
const subjectCache = new Map<string, { data: SubjectDetail; ts: number }>();

export function invalidateAcademicsCache(): void {
  overviewCache = null;
  subjectCache.clear();
}

// ── constants ─────────────────────────────────────────────────────────────────
const BRANCH_COLORS = ["#1e3a8a", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444"];
const STANDARD_GRADES = ["G1","G2","G3","G4","G5","G6","G7","G8","G9","G10","G11","G12"];

// ── types ─────────────────────────────────────────────────────────────────────
export type BranchStat = {
  id: string;
  name: string;
  color: string;
  students: number;
  avgScore: number;
  passRate: number;
  distinctionRate: number;
  avgAttendance: number;
  subjectScores: Record<string, number>;
};

// Each row groups counts by score range. `total` is the sum across series;
// any other key is a series (a branch name in the overall view, a grade
// label in the per-branch view) and its value is the count contributing
// from that series. The chart renders one stacked Bar per series so the
// user can see WHICH branches / grades make up each score bucket — answers
// "where do these students come from?" at a glance.
export type ExamDistRow = {
  range: string;
  total: number;
  [series: string]: number | string;
};

export type BranchDetailData = {
  stats: {
    overallPassRate: { value: string; change: string };
    averageScore:    { value: string; change: string };
    distinctionRate: { value: string; change: string };
    totalStudents:   { value: string; change: string };
  };
  gradeColumns: string[];
  gradeMatrix:  { subject: string; [grade: string]: number | string }[];
  subjectPerformance: { subject: string; [branchName: string]: number | string }[];
  examDistribution:        ExamDistRow[];
  examDistributionSeries:  string[]; // branch names (overall) or grade labels (per-branch)
  examDistributionDimension: "branch" | "grade";
  learningOutcomes:   { q: string; knowledge: number; skills: number; application: number }[];
};

export type AcademicsOverviewData = {
  branches: BranchStat[];
  stats: BranchDetailData["stats"];
  gradeColumns: string[];
  gradeMatrix:  BranchDetailData["gradeMatrix"];
  subjectPerformance: BranchDetailData["subjectPerformance"];
  examDistribution:        BranchDetailData["examDistribution"];
  examDistributionSeries:  BranchDetailData["examDistributionSeries"];
  examDistributionDimension: BranchDetailData["examDistributionDimension"];
  learningOutcomes:   BranchDetailData["learningOutcomes"];
  perBranch: Record<string, BranchDetailData>;
};

export type SubjectDetail = {
  name: string;
  teachers: number;
  students: number;
  status: string;
  metrics: {
    avgScore:      { value: string; note: string };
    passRate:      { value: string; note: string };
    topPerformers: { value: string; note: string };
    focusAreas:    { value: string; note: string };
  };
  topics:          { name: string; score: number }[];
  classComparison: { grade: string; [key: string]: string | number }[];
  weakAreas:       { topic: string; avgScore: string; affected: string; recommendation: string; status: string }[];
};

// ── helpers ───────────────────────────────────────────────────────────────────
/** Extract 0-100 percentage from a result/test_score document */
function getScore(r: any): number | null {
  if (typeof r.percentage === "number" && r.percentage > 0) return Math.round(r.percentage);
  if (typeof r.percentage === "string" && parseFloat(r.percentage) > 0) return Math.round(parseFloat(r.percentage));
  const raw = r.marksObtained ?? r.marks ?? r.score ?? r.obtainedMarks ?? r.obtained ?? r.marksScored ?? null;
  if (raw === null || raw === undefined) return null;
  const rawNum = Number(raw);
  if (isNaN(rawNum)) return null;
  const total = r.totalMarks ?? r.maxMarks ?? r.totalScore ?? r.fullMarks ?? r.total ?? r.outOf ?? null;
  if (total === null) return Math.min(100, Math.round(rawNum));
  const totalNum = Number(total);
  return totalNum > 0 ? Math.round((rawNum / totalNum) * 100) : null;
}

function normalizeGrade(raw: string): string | null {
  if (!raw) return null;
  // "Grade 9", "Gr 9", "9th", "Class 9", "G9", "9" → "G9"
  const m = (raw + "").match(/\b(\d{1,2})\b/);
  if (!m) return null;
  const n = parseInt(m[1]);
  if (n < 1 || n > 12) return null;
  return `G${n}`;
}

function normalizeSubject(raw: string): string {
  if (!raw) return "General";
  const s = raw.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function avgArr(arr: number[]): number {
  return arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
}

function classifySubject(subj: string): "knowledge" | "skills" | "application" {
  const s = subj.toLowerCase();
  // Knowledge: STEM subjects
  if (s.includes("math") || s.includes("sci") || s.includes("phy") || s.includes("chem") || s.includes("bio") || s.includes("comp") || s.includes("algebra") || s.includes("geometry") || s.includes("ict")) {
    return "knowledge";
  }
  // Skills: Languages and Communication
  if (s.includes("eng") || s.includes("lang") || s.includes("hin") || s.includes("urd") || s.includes("lit") || s.includes("guj") || s.includes("arabic") || s.includes("french") || s.includes("gram")) {
    return "skills";
  }
  // Application: Social Sciences, Arts, and others
  if (s.includes("soc") || s.includes("pst") || s.includes("isl") || s.includes("hist") || s.includes("geo") || s.includes("art") || s.includes("civic") || s.includes("ethic")) {
    return "application";
  }
  return "application"; // Default fallback
}

// ── normalised score entry ────────────────────────────────────────────────────
type ScoreEntry = {
  pct:      number;
  subject:  string;
  grade:    string;       // "G9" or ""
  schoolId: string;
  teacherId: string;
  qi:       number;       // -1 = unknown quarter
};

// ── main fetch ────────────────────────────────────────────────────────────────
export async function fetchAcademicsOverview(opts: { force?: boolean } = {}): Promise<AcademicsOverviewData> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error("User not authenticated. Please log in to view academics.");
  }

  // Cache hit → return immediately. Refresh actions pass force:true.
  if (!opts.force && overviewCache && overviewCache.uid === uid &&
      Date.now() - overviewCache.ts < ACADEMICS_CACHE_TTL_MS) {
    return overviewCache.data;
  }

  // (Earlier this function called `invalidateCache(\`core:${uid}\`)` to
  // wipe the shared analytics cache used by the Dashboard. That was a
  // cross-page side effect — every visit to /academics regressed
  // Dashboard perf by forcing a cold re-aggregation. Removed: each page
  // owns its own cache TTL; staleness is handled per-cache, not by
  // pages stomping on each other.)

  // Bound attendance to last 12 months — heatmap-style usage doesn't need
  // all-time history. Composite index (schoolId, date) already deployed.
  // Cuts a 200K+-row scan to ~30K-60K typical.
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const attCutoff = `${oneYearAgo.getFullYear()}-${String(oneYearAgo.getMonth() + 1).padStart(2, "0")}-01`;

  // 1. Fetch everything in parallel — every collection scoped by schoolId.
  //    Earlier these queries had NO schoolId filter, which read the entire
  //    cross-tenant database and then filtered client-side at line 232.
  //    That's a security leak (one owner's bytes hitting another owner's
  //    page) AND a cost disaster (50K+ docs of other schools fetched only
  //    to be thrown away). (See memory: security_hardening_apr18.) Strict
  //    scoping at query level — legacy docs missing schoolId should be
  //    backfilled by the enforceBranchId_* trigger, not silently included.
  const swallow = (label: string) => (err: unknown) => {
    console.warn(`[academicsService] ${label} fetch failed:`, err);
    return { docs: [] as any[] } as any;
  };
  const [
    branchesSnap, teachersSnap, classesSnap,
    resultsSnap, scoresSnap,
    enrollSnap, attSnap,
  ] = await Promise.all([
    getDocs(collection(db, "schools", uid, "branches")),
    getDocs(query(collection(db, "teachers"),    where("schoolId", "==", uid))).catch(swallow("teachers")),
    getDocs(query(collection(db, "classes"),     where("schoolId", "==", uid))).catch(swallow("classes")),
    getDocs(query(collection(db, "results"),     where("schoolId", "==", uid))).catch(swallow("results")),
    getDocs(query(collection(db, "test_scores"), where("schoolId", "==", uid))).catch(swallow("test_scores")),
    getDocs(query(collection(db, "enrollments"), where("schoolId", "==", uid))).catch(swallow("enrollments")),
    getDocs(query(
      collection(db, "attendance"),
      where("schoolId", "==", uid),
      where("date", ">=", attCutoff),
    )).catch(swallow("attendance")),
  ]);

  // 2. Branch list from sub-collection
  const branchDocs = branchesSnap.docs
    .map((d, i) => ({
      id:    d.data().branchId || d.id, // Prefer branchId slug if exists
      name:  (d.data().name || d.data().schoolName || "Branch") as string,
      color: d.data().color || BRANCH_COLORS[i % BRANCH_COLORS.length],
    }));

  // 3. Build lookup maps
  // teacherId → { schoolId, subject }
  const teacherMap = new Map<string, { schoolId: string; subject: string }>();
  (teachersSnap.docs as any[]).forEach((d: any) => {
    const t = d.data();
    teacherMap.set(d.id, {
      schoolId: t.schoolId || t.branchId || "",
      subject:  normalizeSubject(t.subject || t.subjectName || ""),
    });
  });

  // classId → { grade, subject, schoolId (via teacherId) }
  const classMap = new Map<string, { grade: string; subject: string; schoolId: string }>();
  (classesSnap.docs as any[]).forEach((d: any) => {
    const c = d.data();
    const tInfo = teacherMap.get(c.teacherId) || { schoolId: "", subject: "" };
    classMap.set(d.id, {
      grade:    normalizeGrade(c.grade || c.className || c.name || "") || "",
      subject:  normalizeSubject(c.subject || tInfo.subject || ""),
      schoolId: c.schoolId || tInfo.schoolId || "",
    });
  });

  // 4. Combine results + test_scores into unified ScoreEntry[].
  //    Dedup key is `${collection}:${docId}` — earlier we deduped on
  //    docId alone, but doc IDs are only unique WITHIN a collection,
  //    not across them. Collisions (a results doc and a test_scores
  //    doc with the same id) silently dropped one of them.
  const seen = new Set<string>();
  const allEntries: ScoreEntry[] = [];

  const processDoc = (source: "results" | "test_scores") => (d: any) => {
    const key = `${source}:${d.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const r   = d.data();
    const pct = getScore(r);
    if (pct === null || pct < 0 || pct > 100) return;

    const cls     = classMap.get(r.classId) || { grade: "", subject: "", schoolId: "" };
    const tInfo   = teacherMap.get(r.teacherId) || { schoolId: "", subject: "" };

    const subject = normalizeSubject(
      tInfo.subject || r.subject || r.subjectName || cls.subject || "General"
    );
    const grade   = normalizeGrade(r.grade || r.className?.match?.(/\d+/)?.[0] || cls.grade || "") || "";
    const schoolId = r.branchId || r.schoolId || tInfo.schoolId || cls.schoolId || "";

    let dateObj: Date | null = null;
    const rawDate = r.createdAt || r.testDate || r.date || null;
    if (rawDate) {
      if (typeof rawDate.toDate === "function") dateObj = rawDate.toDate();
      else if (typeof rawDate === "string" || typeof rawDate === "number") {
        const d = new Date(rawDate); if (!isNaN(d.getTime())) dateObj = d;
      } else if (rawDate instanceof Date) dateObj = rawDate;
    }
    const qi = dateObj ? Math.min(3, Math.floor(dateObj.getMonth() / 3)) : -1;

    allEntries.push({ pct, subject, grade, schoolId, teacherId: r.teacherId || "", qi });
  };

  (resultsSnap.docs as any[]).forEach(processDoc("results"));
  (scoresSnap.docs  as any[]).forEach(processDoc("test_scores"));

  // Some legacy result/test_score docs were written before the
  // enforceBranchId_* trigger backfilled `branchId` — they only carry
  // `schoolId == ownerUid` and no real branchId. Earlier we silently
  // included them in school-wide aggregates but excluded them from every
  // per-branch rollup, which produced visible mismatches: "All Branches"
  // showed 100 students/100% pass while the per-branch cards added up to
  // 70. Fix: route every orphan entry into a synthetic "Unassigned"
  // branch so the per-branch breakdown reconciles with the school total.
  // (2026-05-26 — see AcademicsOverview audit.)
  const UNASSIGNED_ID   = "_unassigned";
  const UNASSIGNED_NAME = "Unassigned";
  const initialValidBranchIds = new Set(branchDocs.map(b => b.id));
  const isOrphanEntry = (e: ScoreEntry) =>
    !e.schoolId || e.schoolId === uid || !initialValidBranchIds.has(e.schoolId);

  if (allEntries.some(isOrphanEntry)) {
    branchDocs.push({ id: UNASSIGNED_ID, name: UNASSIGNED_NAME, color: "#94A3B8" });
  }
  const validBranchIds = new Set(branchDocs.map(b => b.id));
  const finalEntries = allEntries
    .map(e => isOrphanEntry(e) ? { ...e, schoolId: UNASSIGNED_ID } : e)
    .filter(e => validBranchIds.has(e.schoolId));

  // (Earlier we had a synthetic-quarter loop here that distributed undated
  // entries across Q1-Q4 by array index. That made the Learning Outcomes
  // chart show fabricated trends whenever timestamps were missing. Removed
  // — undated entries are now excluded from the quarterly chart, and the
  // empty-state copy on the page already explains "Trends appear as
  // results are recorded over time".)

  // 5. Build enrollments per BRANCH (deduped by studentId).
  //
  //    Earlier this map was keyed by `e.schoolId` (the owner UID), but
  //    branch cards look it up via `enrollBySchool.get(b.id)` where
  //    `b.id` is the branchId — the lookup never matched, every branch
  //    showed 0 students even when scores existed. Switch to bucketing
  //    by `branchId` (the cloud trigger backfills branchId on every
  //    enrollment, so it's reliable), and dedup by studentId so a
  //    multi-class student counts once per branch (memory:
  //    bug_pattern_enrollment_row_dedup).
  // If the Unassigned bucket was added (score orphans existed), route
  // enrollment + attendance orphans here too so the per-branch breakdown
  // stays internally consistent (total students = Σ branch students).
  const hasUnassigned = validBranchIds.has(UNASSIGNED_ID);
  const bucketBranchId = (bid: string): string => {
    if (!bid || bid === uid || !validBranchIds.has(bid)) {
      return hasUnassigned ? UNASSIGNED_ID : "";
    }
    return bid;
  };

  const branchStudents = new Map<string, Set<string>>();
  const allStudentIds  = new Set<string>();
  (enrollSnap.docs as any[]).forEach((d: any) => {
    const e   = d.data();
    const sid = e.studentId || e.studentEmail || d.id;
    const bid = bucketBranchId(e.branchId || classMap.get(e.classId)?.schoolId || "");
    if (sid) allStudentIds.add(sid);
    if (!bid || !sid) return;
    let set = branchStudents.get(bid);
    if (!set) { set = new Set(); branchStudents.set(bid, set); }
    set.add(sid);
  });
  const totalStudents = allStudentIds.size;

  // 6. Attendance per BRANCH — same key fix as enrollments.
  const attBySchool = new Map<string, { total: number; present: number }>();
  (attSnap.docs as any[]).forEach((d: any) => {
    const a  = d.data();
    const bid = bucketBranchId(a.branchId || teacherMap.get(a.teacherId)?.schoolId || "");
    if (!bid) return;
    const prev = attBySchool.get(bid) || { total: 0, present: 0 };
    attBySchool.set(bid, {
      total:   prev.total + 1,
      present: prev.present + (a.status?.toLowerCase() === "present" ? 1 : 0),
    });
  });

  // 7. Per-branch stats
  const branches: BranchStat[] = branchDocs.map(b => {
    const branchEntries = finalEntries.filter(e => e.schoolId === b.id);
    const pcts          = branchEntries.map(e => e.pct);
    const n             = pcts.length || 1;
    const avgScore      = avgArr(pcts);
    const passRate      = Math.round(pcts.filter(p => p >= PASS_THRESHOLD_PERCENT).length / n * 100);
    const distRate      = Math.round(pcts.filter(p => p >= 80).length / n * 100);

    const subjectMap: Record<string, number[]> = {};
    branchEntries.forEach(e => {
      if (!subjectMap[e.subject]) subjectMap[e.subject] = [];
      subjectMap[e.subject].push(e.pct);
    });
    const subjectScores: Record<string, number> = {};
    Object.entries(subjectMap).forEach(([s, v]) => { subjectScores[s] = avgArr(v); });

    const att = attBySchool.get(b.id);
    return {
      id:             b.id,
      name:           b.name,
      color:          b.color,
      students:       branchStudents.get(b.id)?.size ?? 0,
      avgScore,
      passRate,
      distinctionRate: distRate,
      avgAttendance:  att ? Math.round(att.present / att.total * 100) : 0,
      subjectScores,
    };
  });

  // 8. Overall stats
  const allPcts = finalEntries.map(e => e.pct);
  const N       = allPcts.length || 1;
  const oPass   = Math.round(allPcts.filter(p => p >= PASS_THRESHOLD_PERCENT).length / N * 100);
  const oDist   = Math.round(allPcts.filter(p => p >= 80).length / N * 100);
  const oAvg    = avgArr(allPcts);

  // 9. Grade matrix (subjects × grades)
  const gradeSubjMap: Record<string, Record<string, number[]>> = {};
  finalEntries.forEach(e => {
    if (!e.grade) return;
    if (!gradeSubjMap[e.subject]) gradeSubjMap[e.subject] = {};
    if (!gradeSubjMap[e.subject][e.grade]) gradeSubjMap[e.subject][e.grade] = [];
    gradeSubjMap[e.subject][e.grade].push(e.pct);
  });

  // Determine which grade columns are populated. When the school has zero
  // populated grades, show the full G1-G12 spread (capped at 8) instead of
  // a biased G6-G12 default — schools that operate at primary level
  // shouldn't see a secondary-school-only fallback.
  const populatedGrades = [...new Set(finalEntries.map(e => e.grade).filter(Boolean))]
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  const gradeColumns = populatedGrades.length > 0 ? populatedGrades.slice(0, 8) : STANDARD_GRADES.slice(0, 8);

  const matrixSubjects = Object.keys(gradeSubjMap)
    .filter(s => s !== "General")
    .sort()
    .slice(0, 7);

  const gradeMatrix = matrixSubjects.map(subj => {
    const row: { subject: string; [g: string]: string | number } = { subject: subj };
    gradeColumns.forEach(g => {
      const vals = gradeSubjMap[subj]?.[g] || [];
      row[g] = vals.length > 0 ? avgArr(vals) : 0;
    });
    return row;
  });

  // 10. Subject performance by branch (chart)
  // Include "General" if no named subjects exist so chart always has data
  const namedSubjects = [...new Set(finalEntries.map(e => e.subject).filter(s => s !== "General"))];
  const chartSubjects = (namedSubjects.length > 0 ? namedSubjects : [...new Set(finalEntries.map(e => e.subject))]).slice(0, 6);

  const branchSubjMap: Record<string, Record<string, number[]>> = {};
  finalEntries.forEach(e => {
    const bName = branchDocs.find(b => b.id === e.schoolId)?.name;
    if (!bName) return;
    if (!branchSubjMap[e.subject]) branchSubjMap[e.subject] = {};
    if (!branchSubjMap[e.subject][bName]) branchSubjMap[e.subject][bName] = [];
    branchSubjMap[e.subject][bName].push(e.pct);
  });

  const subjectPerformance = chartSubjects.map(subj => {
    const row: { subject: string; [k: string]: string | number } = { subject: subj };
    // Overall aggregate — used as fallback when no branch attribution exists
    const overallVals = finalEntries.filter(e => e.subject === subj).map(e => e.pct);
    row["Overall"] = overallVals.length > 0 ? avgArr(overallVals) : 0;
    branchDocs.forEach(b => {
      const vals = branchSubjMap[subj]?.[b.name] || [];
      row[b.name] = vals.length > 0 ? avgArr(vals) : 0;
    });
    return row;
  });

  // 11. Exam distribution — STACKED by branch.
  //     Each row keeps a `total` (sum across all branches) plus one numeric
  //     field per branch name, so the chart can render stacked bars
  //     showing WHICH branches contribute to each score bucket. Earlier
  //     the chart was just a flat count per range — users couldn't tell
  //     where the students came from.
  const SCORE_RANGES = [
    { range: "90-100",   min: 90, max: 100 },
    { range: "80-89",    min: 80, max: 89  },
    { range: "70-79",    min: 70, max: 79  },
    { range: "60-69",    min: 60, max: 69  },
    { range: "Below 60", min: 0,  max: 59  },
  ];
  // Pre-group entries by branch name once (avoid per-row filtering).
  const branchEntriesByName = new Map<string, number[]>();
  branchDocs.forEach(b => branchEntriesByName.set(b.name, []));
  finalEntries.forEach(e => {
    const bName = branchDocs.find(b => b.id === e.schoolId)?.name;
    if (bName) branchEntriesByName.get(bName)!.push(e.pct);
  });
  const overviewExamSeries = branchDocs.map(b => b.name);
  const examDistribution: ExamDistRow[] = SCORE_RANGES.map(r => {
    const row: ExamDistRow = {
      range: r.range,
      total: allPcts.filter(p => p >= r.min && p <= r.max).length,
    };
    overviewExamSeries.forEach(name => {
      const pcts = branchEntriesByName.get(name) ?? [];
      row[name] = pcts.filter(p => p >= r.min && p <= r.max).length;
    });
    return row;
  });

  // 12. Learning outcomes quarterly
  const qMap: Record<number, Record<"knowledge"|"skills"|"application", number[]>> = {
    0: { knowledge: [], skills: [], application: [] },
    1: { knowledge: [], skills: [], application: [] },
    2: { knowledge: [], skills: [], application: [] },
    3: { knowledge: [], skills: [], application: [] },
  };
  finalEntries.forEach(e => {
    if (e.qi < 0) return;
    const cat = classifySubject(e.subject);
    qMap[e.qi][cat].push(e.pct);
  });
  const learningOutcomes = [0, 1, 2, 3].map(qi => ({
    q:           `Q${qi + 1}`,
    knowledge:   avgArr(qMap[qi].knowledge),
    skills:      avgArr(qMap[qi].skills),
    application: avgArr(qMap[qi].application),
  }));

  // 13. Per-branch detailed data (for branch tabs)
  const perBranch: Record<string, BranchDetailData> = {};
  branchDocs.forEach(b => {
    const bEntries = finalEntries.filter(e => e.schoolId === b.id);
    const bPcts    = bEntries.map(e => e.pct);
    const bN       = bPcts.length || 1;

    // grade matrix for this branch
    const bGSMap: Record<string, Record<string, number[]>> = {};
    bEntries.forEach(e => {
      if (!e.grade) return;
      if (!bGSMap[e.subject]) bGSMap[e.subject] = {};
      if (!bGSMap[e.subject][e.grade]) bGSMap[e.subject][e.grade] = [];
      bGSMap[e.subject][e.grade].push(e.pct);
    });
    const bGrades = [...new Set(bEntries.map(e => e.grade).filter(Boolean))]
      .sort((a, c) => parseInt(a.slice(1)) - parseInt(c.slice(1)));
    const bGradeColumns = bGrades.length > 0 ? bGrades.slice(0, 8) : STANDARD_GRADES.slice(0, 8);
    const bMatrixSubjs  = Object.keys(bGSMap).filter(s => s !== "General").sort().slice(0, 7);
    const bGradeMatrix  = bMatrixSubjs.map(subj => {
      const row: { subject: string; [g: string]: string | number } = { subject: subj };
      bGradeColumns.forEach(g => { row[g] = avgArr(bGSMap[subj]?.[g] || []); });
      return row;
    });

    // subject performance for this branch (single "Overall" bar)
    const bNamed = [...new Set(bEntries.map(e => e.subject).filter(s => s !== "General"))];
    const bSubjs = (bNamed.length > 0 ? bNamed : [...new Set(bEntries.map(e => e.subject))]).slice(0, 6);
    const bSubjectPerformance = bSubjs.map(subj => ({
      subject: subj,
      Overall: avgArr(bEntries.filter(e => e.subject === subj).map(e => e.pct)),
    }));

    // exam distribution for this branch — STACKED by grade. When the user
    // drills into a single branch, the breakdown axis flips from
    // "branches" (overview) to "grades" (this view), so they can see
    // which grade levels are in each score bucket within this branch.
    const bGradesPresent = [...new Set(bEntries.map(e => e.grade).filter(Boolean))]
      .sort((a, c) => parseInt(a.slice(1)) - parseInt(c.slice(1)));
    const branchEntriesByGrade = new Map<string, number[]>();
    bGradesPresent.forEach(g => branchEntriesByGrade.set(g, []));
    bEntries.forEach(e => {
      if (!e.grade) return;
      branchEntriesByGrade.get(e.grade)?.push(e.pct);
    });
    const bExamDist: ExamDistRow[] = SCORE_RANGES.map(r => {
      const row: ExamDistRow = {
        range: r.range,
        total: bPcts.filter(p => p >= r.min && p <= r.max).length,
      };
      bGradesPresent.forEach(g => {
        const pcts = branchEntriesByGrade.get(g) ?? [];
        row[g] = pcts.filter(p => p >= r.min && p <= r.max).length;
      });
      return row;
    });

    // learning outcomes for this branch
    const bQMap: Record<number, Record<"knowledge"|"skills"|"application", number[]>> = {
      0: { knowledge: [], skills: [], application: [] },
      1: { knowledge: [], skills: [], application: [] },
      2: { knowledge: [], skills: [], application: [] },
      3: { knowledge: [], skills: [], application: [] },
    };
    bEntries.forEach(e => {
      if (e.qi < 0) return;
      bQMap[e.qi][classifySubject(e.subject)].push(e.pct);
    });
    const bLearning = [0, 1, 2, 3].map(qi => ({
      q:           `Q${qi + 1}`,
      knowledge:   avgArr(bQMap[qi].knowledge),
      skills:      avgArr(bQMap[qi].skills),
      application: avgArr(bQMap[qi].application),
    }));

    const bPass = Math.round(bPcts.filter(p => p >= PASS_THRESHOLD_PERCENT).length / bN * 100);
    const bDist = Math.round(bPcts.filter(p => p >= 80).length / bN * 100);
    const bAvg  = avgArr(bPcts);

    perBranch[b.id] = {
      stats: {
        overallPassRate: { value: bPcts.length > 0 ? `${bPass}%` : "N/A", change: PASS_THRESHOLD_LABEL },
        averageScore:    { value: bPcts.length > 0 ? `${bAvg}%`  : "N/A", change: "Across all tests"        },
        distinctionRate: { value: bPcts.length > 0 ? `${bDist}%` : "N/A", change: "Students scoring ≥ 80%"  },
        totalStudents:   { value: (branchStudents.get(b.id)?.size ?? 0).toString(), change: "Enrolled in this branch" },
      },
      gradeColumns:       bGradeColumns,
      gradeMatrix:        bGradeMatrix,
      subjectPerformance: bSubjectPerformance,
      examDistribution:        bExamDist,
      examDistributionSeries:  bGradesPresent,
      examDistributionDimension: "grade",
      learningOutcomes:   bLearning,
    };
  });

  const result: AcademicsOverviewData = {
    branches,
    stats: {
      overallPassRate: { value: allPcts.length > 0 ? `${oPass}%` : "N/A", change: PASS_THRESHOLD_LABEL },
      averageScore:    { value: allPcts.length > 0 ? `${oAvg}%` : "N/A", change: "Across all tests"        },
      distinctionRate: { value: allPcts.length > 0 ? `${oDist}%` : "N/A", change: "Students scoring ≥ 80%"  },
      totalStudents:   { value: totalStudents.toLocaleString(),             change: "Enrolled across branches" },
    },
    gradeColumns,
    gradeMatrix,
    subjectPerformance,
    examDistribution,
    examDistributionSeries:    overviewExamSeries,
    examDistributionDimension: "branch",
    learningOutcomes,
    perBranch,
  };

  overviewCache = { uid, data: result, ts: Date.now() };
  return result;
}

// ── subject detail ────────────────────────────────────────────────────────────
export async function fetchSubjectDetail(
  subjectId: string,
  opts: { force?: boolean } = {},
): Promise<SubjectDetail> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error("User not authenticated.");
  }

  const cacheKey = `${uid}:${subjectId.toLowerCase()}`;
  if (!opts.force) {
    const cached = subjectCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ACADEMICS_CACHE_TTL_MS) {
      return cached.data;
    }
  }

  // schoolId-scoped — same security fix as fetchAcademicsOverview above.
  const swallow = (label: string) => (err: unknown) => {
    console.warn(`[academicsService:subject] ${label} fetch failed:`, err);
    return { docs: [] as any[] } as any;
  };
  const [branchesSnap, teachersSnap, resultsSnap, scoresSnap] = await Promise.all([
    getDocs(collection(db, "schools", uid, "branches")),
    getDocs(query(collection(db, "teachers"),    where("schoolId", "==", uid))).catch(swallow("teachers")),
    getDocs(query(collection(db, "results"),     where("schoolId", "==", uid))).catch(swallow("results")),
    getDocs(query(collection(db, "test_scores"), where("schoolId", "==", uid))).catch(swallow("test_scores")),
  ]);

  const branchDocs = branchesSnap.docs
    .map((d, i) => ({ 
      id: d.data().branchId || d.id, 
      name: (d.data().name || d.data().schoolName || "Branch") as string, 
      color: d.data().color || BRANCH_COLORS[i % BRANCH_COLORS.length] 
    }));

  const teacherMap = new Map<string, { schoolId: string; subject: string }>();
  (teachersSnap.docs as any[]).forEach((d: any) => {
    const t = d.data();
    teacherMap.set(d.id, { schoolId: t.schoolId || "", subject: normalizeSubject(t.subject || "") });
  });

  // Collect all result docs matching this subject. Earlier the match was
  // a fuzzy substring (`subj.includes(subjLower) || subjLower.includes(...)`)
  // which let "phy" match BOTH "Physics" and "Philosophy" — wrong subject's
  // scores leaked into the wrong page. Subject URLs are generated FROM the
  // normalised subject name (toLowerCase), so an exact lowercase match is
  // both correct and sufficient.
  // Composite dedup key (collection:docId) — same fix as fetchAcademicsOverview.
  const subjLower = subjectId.toLowerCase();
  const seen      = new Set<string>();

  const matchingDocs: any[] = [];
  const processAll = (source: "results" | "test_scores") => (docs: any[]) => {
    docs.forEach(d => {
      const key = `${source}:${d.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      const r = d.data();
      const tInfo = teacherMap.get(r.teacherId) || { schoolId: "", subject: "" };
      const subj  = normalizeSubject(tInfo.subject || r.subject || r.subjectName || "").toLowerCase();
      if (subj !== subjLower) return;
      matchingDocs.push({ ...r, _docId: d.id });
    });
  };
  processAll("results")(resultsSnap.docs as any[]);
  processAll("test_scores")(scoresSnap.docs  as any[]);

  const pcts: number[] = [];
  const studentIds       = new Set<string>();
  const teacherIds       = new Set<string>();
  const topicMap: Record<string, number[]>                        = {};
  const branchPctMap: Record<string, number[]>                    = {};
  // grade → branchName → scores
  const gradeBranchMap: Record<string, Record<string, number[]>> = {};

  matchingDocs.forEach(r => {
    const pct = getScore(r);
    if (pct === null || pct < 0 || pct > 100) return;
    pcts.push(pct);
    if (r.studentId) studentIds.add(r.studentId);
    if (r.teacherId) teacherIds.add(r.teacherId);

    // Topic grouping
    const topic = (r.topic || r.testTitle || r.examName || "General").slice(0, 20);
    if (!topicMap[topic]) topicMap[topic] = [];
    topicMap[topic].push(pct);

    // Branch grouping
    const tInfo = teacherMap.get(r.teacherId) || { schoolId: "" };
    const sId   = r.schoolId || tInfo.schoolId;
    const bName = branchDocs.find(b => b.id === sId)?.name || null;
    if (bName) {
      if (!branchPctMap[bName]) branchPctMap[bName] = [];
      branchPctMap[bName].push(pct);

      // Grade × Branch grouping
      const gradeRaw = r.grade || r.className || "";
      const gradeMatch = (gradeRaw + "").match(/\b(\d{1,2})\b/);
      if (gradeMatch) {
        const grade = `G${gradeMatch[1]}`;
        if (!gradeBranchMap[grade]) gradeBranchMap[grade] = {};
        if (!gradeBranchMap[grade][bName]) gradeBranchMap[grade][bName] = [];
        gradeBranchMap[grade][bName].push(pct);
      }
    }
  });

  const n        = pcts.length || 1;
  const avgScore = avgArr(pcts);
  const passRate = Math.round(pcts.filter(p => p >= PASS_THRESHOLD_PERCENT).length / n * 100);
  const topCount = pcts.filter(p => p >= 80).length;

  const topics = Object.entries(topicMap)
    .map(([name, vals]) => ({ name, score: avgArr(vals) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  // ── classComparison: grade × branch matrix ────────────────────────────────
  const gradeKeys = Object.keys(gradeBranchMap)
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));

  let classComparison: { grade: string; [k: string]: string | number }[];

  if (gradeKeys.length > 0) {
    // Preferred: one row per grade, one bar per branch
    classComparison = gradeKeys.slice(0, 8).map(grade => {
      const row: { grade: string; [k: string]: string | number } = { grade };
      branchDocs.forEach(b => {
        row[b.name] = avgArr(gradeBranchMap[grade][b.name] || []);
      });
      return row;
    });
  } else {
    // Fallback: one row showing each branch's overall score for this subject
    const row: { grade: string; [k: string]: string | number } = { grade: "Overall" };
    branchDocs.forEach(b => {
      row[b.name] = avgArr(branchPctMap[b.name] || []);
    });
    classComparison = [row];
  }

  const weakAreas = topics
    .filter(t => t.score < 75)
    .slice(0, 3)
    .map(t => ({
      topic:    t.name,
      avgScore: `${t.score}/100`,
      affected: `~${Math.round(studentIds.size * ((100 - t.score) / 100) || 1)} students`,
      recommendation:
        t.score < 60
          ? "Additional tutoring sessions and visual learning materials recommended"
          : "Increase practice assignments and peer-study group sessions",
      status: t.score < 60 ? "Critical" : "Moderate",
    }));

  const displayName = subjectId.charAt(0).toUpperCase() + subjectId.slice(1);
  // Honest counts — earlier these fell back to `branchDocs.length` /
  // `pcts.length`, which surfaced "5 teachers" when the truth was "0
  // teachers found, but we have 5 branches" (misleading data integrity).
  // Now we show 0 when the underlying set is empty; the page already has
  // a "No Data" status to handle the empty-school case.
  const result: SubjectDetail = {
    name:    displayName,
    teachers: teacherIds.size,
    students: studentIds.size,
    status:  passRate >= 90 ? "Strong" : passRate >= 75 ? "Good" : passRate > 0 ? "Needs Attention" : "No Data",
    metrics: {
      avgScore:      { value: `${avgScore}`, note: "All tests combined"      },
      passRate:      { value: `${passRate}%`, note: PASS_THRESHOLD_LABEL },
      topPerformers: { value: `${topCount}`,  note: "Scored ≥ 80%"           },
      focusAreas:    { value: `${weakAreas.length}`, note: "Topics needing improvement" },
    },
    topics,
    classComparison,
    weakAreas,
  };

  subjectCache.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

// ── hook wrapper ──────────────────────────────────────────────────────────────
export function subscribeAcademicsOverview(
  onData: (d: AcademicsOverviewData) => void,
  onError: (e: Error) => void
): () => void {
  let cancelled = false;
  fetchAcademicsOverview()
    .then(d => { if (!cancelled) onData(d); })
    .catch(e => { if (!cancelled) onError(e as Error); });
  return () => { cancelled = true; };
}

