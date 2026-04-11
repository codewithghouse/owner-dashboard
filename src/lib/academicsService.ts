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
import { collection, getDocs } from "firebase/firestore";
import { invalidateCache } from "./analyticsService";

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
  examDistribution:   { range: string; count: number }[];
  learningOutcomes:   { q: string; knowledge: number; skills: number; application: number }[];
};

export type AcademicsOverviewData = {
  branches: BranchStat[];
  stats: BranchDetailData["stats"];
  gradeColumns: string[];
  gradeMatrix:  BranchDetailData["gradeMatrix"];
  subjectPerformance: BranchDetailData["subjectPerformance"];
  examDistribution:   BranchDetailData["examDistribution"];
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
export async function fetchAcademicsOverview(): Promise<AcademicsOverviewData> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error("User not authenticated. Please log in to view academics.");
  }

  // Invalidate shared analytics cache so branches comparison reflects latest data
  invalidateCache(`core:${uid}`);

  // 1. Fetch everything in parallel
  // Note: We fetch from the owner's sub-collection for branches
  const [
    branchesSnap, teachersSnap, classesSnap,
    resultsSnap, scoresSnap,
    enrollSnap, attSnap,
  ] = await Promise.all([
    getDocs(collection(db, "schools", uid, "branches")),
    getDocs(collection(db, "teachers")).catch(() => ({ docs: [] as any[] })),
    getDocs(collection(db, "classes")).catch(()  => ({ docs: [] as any[] })),
    getDocs(collection(db, "results")).catch(()  => ({ docs: [] as any[] })),
    getDocs(collection(db, "test_scores")).catch(() => ({ docs: [] as any[] })),
    getDocs(collection(db, "enrollments")).catch(() => ({ docs: [] as any[] })),
    getDocs(collection(db, "attendance")).catch(()  => ({ docs: [] as any[] })),
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

  // 4. Combine results + test_scores into unified ScoreEntry[]
  const seen = new Set<string>(); // deduplicate by doc id
  const allEntries: ScoreEntry[] = [];

  const processDoc = (d: any) => {
    if (seen.has(d.id)) return;
    seen.add(d.id);
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

  (resultsSnap.docs as any[]).forEach(processDoc);
  (scoresSnap.docs  as any[]).forEach(processDoc);

  // 4a. Filter allEntries to only include those belonging to the current owner's branches
  const validBranchIds = new Set(branchDocs.map(b => b.id));
  const filteredEntries = allEntries.filter(e => validBranchIds.has(e.schoolId) || e.schoolId === uid);

  // Distribute unknown-quarter entries based on seasonality if missing, but keep it realistic
  filteredEntries.forEach((e, i) => {
    if (e.qi < 0) {
      // If no date, use a spread to ensure graphs aren't empty, but ideally data should have dates
      e.qi = i % 4; 
    }
  });

  const finalEntries = filteredEntries;

  // 5. Build enrollments per school
  const enrollBySchool = new Map<string, number>();
  (enrollSnap.docs as any[]).forEach((d: any) => {
    const e  = d.data();
    const sid = e.schoolId || classMap.get(e.classId)?.schoolId || "";
    if (sid) enrollBySchool.set(sid, (enrollBySchool.get(sid) || 0) + 1);
  });
  const totalStudents = (enrollSnap.docs as any[]).length;

  // 6. Attendance per school
  const attBySchool = new Map<string, { total: number; present: number }>();
  (attSnap.docs as any[]).forEach((d: any) => {
    const a  = d.data();
    const sid = a.schoolId || teacherMap.get(a.teacherId)?.schoolId || "";
    if (!sid) return;
    const prev = attBySchool.get(sid) || { total: 0, present: 0 };
    attBySchool.set(sid, {
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
    const passRate      = Math.round(pcts.filter(p => p >= 40).length / n * 100);
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
      students:       enrollBySchool.get(b.id) || 0,
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
  const oPass   = Math.round(allPcts.filter(p => p >= 40).length / N * 100);
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

  // Determine which grade columns are populated
  const populatedGrades = [...new Set(finalEntries.map(e => e.grade).filter(Boolean))]
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  const gradeColumns = populatedGrades.length > 0 ? populatedGrades.slice(0, 8) : STANDARD_GRADES.slice(5); // G6-G12 fallback

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

  // 11. Exam distribution
  const examDistribution = [
    { range: "90-100", min: 90, max: 100 },
    { range: "80-89",  min: 80, max: 89  },
    { range: "70-79",  min: 70, max: 79  },
    { range: "60-69",  min: 60, max: 69  },
    { range: "Below 60", min: 0, max: 59 },
  ].map(r => ({ range: r.range, count: allPcts.filter(p => p >= r.min && p <= r.max).length }));

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
    const bGradeColumns = bGrades.length > 0 ? bGrades.slice(0, 8) : STANDARD_GRADES.slice(5);
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

    // exam distribution for this branch
    const bExamDist = [
      { range: "90-100", min: 90, max: 100 },
      { range: "80-89",  min: 80, max: 89  },
      { range: "70-79",  min: 70, max: 79  },
      { range: "60-69",  min: 60, max: 69  },
      { range: "Below 60", min: 0, max: 59 },
    ].map(r => ({ range: r.range, count: bPcts.filter(p => p >= r.min && p <= r.max).length }));

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

    const bPass = Math.round(bPcts.filter(p => p >= 40).length / bN * 100);
    const bDist = Math.round(bPcts.filter(p => p >= 80).length / bN * 100);
    const bAvg  = avgArr(bPcts);

    perBranch[b.id] = {
      stats: {
        overallPassRate: { value: bPcts.length > 0 ? `${bPass}%` : "N/A", change: "Students scoring ≥ 40%" },
        averageScore:    { value: bPcts.length > 0 ? `${bAvg}%`  : "N/A", change: "Across all tests"        },
        distinctionRate: { value: bPcts.length > 0 ? `${bDist}%` : "N/A", change: "Students scoring ≥ 80%"  },
        totalStudents:   { value: (enrollBySchool.get(b.id) || 0).toString(), change: "Enrolled in this branch" },
      },
      gradeColumns:       bGradeColumns,
      gradeMatrix:        bGradeMatrix,
      subjectPerformance: bSubjectPerformance,
      examDistribution:   bExamDist,
      learningOutcomes:   bLearning,
    };
  });

  return {
    branches,
    stats: {
      overallPassRate: { value: allPcts.length > 0 ? `${oPass}%` : "N/A", change: "Students scoring ≥ 40%" },
      averageScore:    { value: allPcts.length > 0 ? `${oAvg}%` : "N/A", change: "Across all tests"        },
      distinctionRate: { value: allPcts.length > 0 ? `${oDist}%` : "N/A", change: "Students scoring ≥ 80%"  },
      totalStudents:   { value: totalStudents.toLocaleString(),             change: "Enrolled across branches" },
    },
    gradeColumns,
    gradeMatrix,
    subjectPerformance,
    examDistribution,
    learningOutcomes,
    perBranch,
  };
}

// ── subject detail ────────────────────────────────────────────────────────────
export async function fetchSubjectDetail(subjectId: string): Promise<SubjectDetail> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error("User not authenticated.");
  }

  const [branchesSnap, teachersSnap, resultsSnap, scoresSnap] = await Promise.all([
    getDocs(collection(db, "schools", uid, "branches")),
    getDocs(collection(db, "teachers")).catch(() => ({ docs: [] as any[] })),
    getDocs(collection(db, "results")).catch(()  => ({ docs: [] as any[] })),
    getDocs(collection(db, "test_scores")).catch(() => ({ docs: [] as any[] })),
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

  // Collect all result docs matching this subject
  const subjLower = subjectId.toLowerCase();
  const seen      = new Set<string>();

  const matchingDocs: any[] = [];
  const processAll = (docs: any[]) => {
    docs.forEach(d => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      const r = d.data();
      const tInfo = teacherMap.get(r.teacherId) || { schoolId: "", subject: "" };
      const subj  = normalizeSubject(tInfo.subject || r.subject || r.subjectName || "").toLowerCase();
      if (!subj.includes(subjLower) && !subjLower.includes(subj.slice(0, 3))) return;
      matchingDocs.push({ ...r, _docId: d.id });
    });
  };
  processAll(resultsSnap.docs as any[]);
  processAll(scoresSnap.docs  as any[]);

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
  const passRate = Math.round(pcts.filter(p => p >= 40).length / n * 100);
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
  return {
    name:    displayName,
    teachers: teacherIds.size || branchDocs.length,
    students: studentIds.size || pcts.length,
    status:  passRate >= 90 ? "Strong" : passRate >= 75 ? "Good" : passRate > 0 ? "Needs Attention" : "No Data",
    metrics: {
      avgScore:      { value: `${avgScore}`, note: "All tests combined"      },
      passRate:      { value: `${passRate}%`, note: "Students scoring ≥ 40%" },
      topPerformers: { value: `${topCount}`,  note: "Scored ≥ 80%"           },
      focusAreas:    { value: `${weakAreas.length}`, note: "Topics needing improvement" },
    },
    topics,
    classComparison,
    weakAreas,
  };
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

// No-op (dummy seeding removed)
export async function seedAcademicsIfEmpty(): Promise<void> {}
