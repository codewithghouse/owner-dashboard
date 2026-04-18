/**
 * teacherScorer.ts — Composite performance scoring for teachers.
 *
 * Signals & weights (total = 100):
 *   1. Class avg score          35%  (test_scores + results + gradebook_scores)
 *   2. Student pass rate (≥50%) 20%  (same score docs)
 *   3. Class attendance rate    20%  (attendance docs with their teacherId)
 *   4. Assignment activity      15%  (assignments count — normalized vs peer max)
 *   5. Teacher punctuality      10%  (teacher_attendance docs)
 *
 * Missing-data fallback: if a teacher has no data for a signal, that signal is
 * skipped and remaining weights are renormalized. This prevents a newly-added
 * teacher with no history from scoring 0 across the board.
 *
 * Output is a composite 0-100 score + an ordered list of "reason" badges
 * explaining WHY they rank where they do (data-driven, deterministic).
 */

// ── Types ──────────────────────────────────────────────────────────────────
export interface TeacherDoc {
  id: string;
  name?: string;
  email?: string;
  schoolId?: string;
  branchId?: string;
  subjects?: string[];
  [key: string]: any;
}

export interface ScoreDoc {
  teacherId?: string;
  studentId?: string;
  percentage?: number | string;
  score?: number | string;
  maxScore?: number | string;
  [key: string]: any;
}

export interface AttendanceDoc {
  teacherId?: string;
  studentId?: string;
  status?: string;
  date?: any;
  [key: string]: any;
}

export interface AssignmentDoc {
  teacherId?: string;
  [key: string]: any;
}

export interface TeacherAttendanceDoc {
  teacherId?: string;
  status?: string;
  date?: any;
  [key: string]: any;
}

export interface ReasonBadge {
  label: string;
  value: string;
  tone: "gold" | "blue" | "emerald" | "violet" | "rose";
}

export interface TeacherScore {
  teacher: TeacherDoc;
  composite: number;          // 0-100 final score
  classAvg: number | null;    // 0-100 or null if no data
  passRate: number | null;    // 0-100 or null
  attendance: number | null;  // 0-100 or null
  assignments: number;        // raw count
  assignmentPct: number | null; // 0-100 normalized vs peer max
  punctuality: number | null; // 0-100 or null
  testCount: number;
  studentCount: number;
  reasons: ReasonBadge[];
}

// ── Helpers ───────────────────────────────────────────────────────────────
const WEIGHTS = {
  classAvg:    35,
  passRate:    20,
  attendance:  20,
  assignments: 15,
  punctuality: 10,
};

/** Parse any known "number-like" field into a number, or NaN if unusable. */
function numOf(v: any): number {
  if (v === null || v === undefined || v === "") return NaN;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : NaN;
}

/** Normalize a raw score doc into a 0-100 percentage. Returns null if unusable.
 *  Supports multiple field-name conventions that show up across schools:
 *    percentage — direct 0-100
 *    score      | marks | obtainedMarks | marksObtained
 *    maxScore   | totalMarks | maxMarks | outOf
 */
function pctOf(s: ScoreDoc & Record<string, any>): number | null {
  // 1) Direct percentage
  const directPct = numOf(s.percentage);
  if (Number.isFinite(directPct)) return Math.max(0, Math.min(100, directPct));

  // 2) raw/max pair — try all known aliases (careful: 0 is valid, so don't
  //    rely on || which treats 0 as falsy)
  const firstFinite = (...vals: any[]): number => {
    for (const v of vals) {
      const n = numOf(v);
      if (Number.isFinite(n)) return n;
    }
    return NaN;
  };
  const raw = firstFinite(s.score, s.marks, s.obtainedMarks, s.marksObtained);
  const max = firstFinite(s.maxScore, s.totalMarks, s.maxMarks, s.outOf);

  if (Number.isFinite(raw) && Number.isFinite(max) && max > 0) {
    return Math.max(0, Math.min(100, (raw / max) * 100));
  }
  // Fallback: if raw alone looks like a % (0-100 range)
  if (Number.isFinite(raw) && raw >= 0 && raw <= 100) return raw;
  return null;
}

function avg(arr: number[]): number | null {
  const valid = arr.filter((n) => Number.isFinite(n));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

// ── Main scorer ───────────────────────────────────────────────────────────
export interface TeachingAssignmentDoc {
  teacherId?: string;
  classId?: string;
  status?: string;
  [key: string]: any;
}

export interface ScoreInput {
  teachers: TeacherDoc[];
  scores: ScoreDoc[];          // test_scores + results + gradebook_scores merged
  attendance: AttendanceDoc[]; // student attendance
  assignments: AssignmentDoc[];
  teacherAttendance: TeacherAttendanceDoc[];
  teachingAssignments?: TeachingAssignmentDoc[]; // for classId fallback resolution
}

export function scoreTeachers(input: ScoreInput): TeacherScore[] {
  const { teachers, scores, attendance, assignments, teacherAttendance, teachingAssignments = [] } = input;

  // Build classId → Set<teacherId> from teaching_assignments (active only)
  // for fallback matching when score/attendance/assignment docs lack
  // teacherId but have classId.
  const classTeachers = new Map<string, Set<string>>();
  teachingAssignments.forEach((ta) => {
    const tid = ta.teacherId;
    const cid = ta.classId;
    if (!tid || !cid) return;
    if (ta.status && ta.status !== "active") return;
    if (!classTeachers.has(cid)) classTeachers.set(cid, new Set());
    classTeachers.get(cid)!.add(tid);
  });

  // Resolve a doc to one or more teacherIds:
  //   1. If doc.teacherId is present → use that
  //   2. Else fall back to classId → all teachers teaching that class (from teaching_assignments)
  const resolveTeacherIds = (doc: { teacherId?: string; classId?: string }): string[] => {
    if (doc.teacherId) return [doc.teacherId];
    if (doc.classId) {
      const set = classTeachers.get(doc.classId);
      if (set && set.size > 0) return Array.from(set);
    }
    return [];
  };

  // Index data by teacherId, with classId fallback
  const scoresByTeacher    = new Map<string, ScoreDoc[]>();
  const attByTeacher       = new Map<string, AttendanceDoc[]>();
  const assignCountByT     = new Map<string, number>();
  const tAttByTeacher      = new Map<string, TeacherAttendanceDoc[]>();

  scores.forEach((s) => {
    const tids = resolveTeacherIds(s);
    tids.forEach((t) => {
      if (!scoresByTeacher.has(t)) scoresByTeacher.set(t, []);
      scoresByTeacher.get(t)!.push(s);
    });
  });
  attendance.forEach((a) => {
    const tids = resolveTeacherIds(a);
    tids.forEach((t) => {
      if (!attByTeacher.has(t)) attByTeacher.set(t, []);
      attByTeacher.get(t)!.push(a);
    });
  });
  assignments.forEach((a) => {
    const tids = resolveTeacherIds(a);
    tids.forEach((t) => {
      assignCountByT.set(t, (assignCountByT.get(t) || 0) + 1);
    });
  });
  teacherAttendance.forEach((a) => {
    // teacher_attendance is always teacher-scoped (no classId fallback applies)
    const t = a.teacherId;
    if (!t) return;
    if (!tAttByTeacher.has(t)) tAttByTeacher.set(t, []);
    tAttByTeacher.get(t)!.push(a);
  });

  // Max assignments across peers (for normalization)
  const maxAssigns = Math.max(1, ...Array.from(assignCountByT.values()));

  // First pass — compute raw metrics per teacher
  const raw = teachers.map((teacher) => {
    const tScores = scoresByTeacher.get(teacher.id) || [];
    const pcts = tScores.map(pctOf).filter((n): n is number => n !== null);
    const classAvg = pcts.length > 0 ? avg(pcts) : null;
    const passCount = pcts.filter((n) => n >= 50).length;
    const passRate = pcts.length > 0 ? (passCount / pcts.length) * 100 : null;

    const tAtt = attByTeacher.get(teacher.id) || [];
    const presentCount = tAtt.filter((a) => {
      const s = (a.status || "").toLowerCase();
      return s === "present" || s === "late";
    }).length;
    const attendance = tAtt.length > 0 ? (presentCount / tAtt.length) * 100 : null;

    const assignCount = assignCountByT.get(teacher.id) || 0;
    const assignmentPct = (assignCount / maxAssigns) * 100;

    const tAttOwn = tAttByTeacher.get(teacher.id) || [];
    const punctualCount = tAttOwn.filter((a) => {
      const s = (a.status || "").toLowerCase();
      return s === "present" || s === "on time";
    }).length;
    const punctuality = tAttOwn.length > 0 ? (punctualCount / tAttOwn.length) * 100 : null;

    // Student count = union of students seen across scores AND attendance.
    // This gives a useful count even if the teacher has attendance data but
    // no scores entered yet.
    const studentCount = new Set([
      ...tScores.map((s) => s.studentId),
      ...tAtt.map((a) => a.studentId),
    ].filter(Boolean)).size;

    return {
      teacher,
      classAvg,
      passRate,
      attendance,
      assignments: assignCount,
      assignmentPct: assignCount > 0 ? assignmentPct : null,
      punctuality,
      testCount: tScores.length,
      studentCount,
    };
  });

  // Compute composite score with renormalized weights for missing signals
  const withComposite = raw.map((r) => {
    let totalWeight = 0;
    let weightedSum = 0;
    if (r.classAvg !== null)      { weightedSum += r.classAvg      * WEIGHTS.classAvg;    totalWeight += WEIGHTS.classAvg; }
    if (r.passRate !== null)      { weightedSum += r.passRate      * WEIGHTS.passRate;    totalWeight += WEIGHTS.passRate; }
    if (r.attendance !== null)    { weightedSum += r.attendance    * WEIGHTS.attendance;  totalWeight += WEIGHTS.attendance; }
    if (r.assignmentPct !== null) { weightedSum += r.assignmentPct * WEIGHTS.assignments; totalWeight += WEIGHTS.assignments; }
    if (r.punctuality !== null)   { weightedSum += r.punctuality   * WEIGHTS.punctuality; totalWeight += WEIGHTS.punctuality; }
    const composite = totalWeight > 0 ? weightedSum / totalWeight : 0;
    return { ...r, composite };
  });

  // Identify per-signal leaders for reason badges
  const leaderClassAvg   = [...withComposite].filter((x) => x.classAvg   !== null).sort((a, b) => (b.classAvg!   - a.classAvg!));
  const leaderPass       = [...withComposite].filter((x) => x.passRate   !== null).sort((a, b) => (b.passRate!   - a.passRate!));
  const leaderAtt        = [...withComposite].filter((x) => x.attendance !== null).sort((a, b) => (b.attendance! - a.attendance!));
  const leaderAssign     = [...withComposite].filter((x) => x.assignments > 0).sort((a, b) => b.assignments  - a.assignments);
  const leaderPunctual   = [...withComposite].filter((x) => x.punctuality !== null).sort((a, b) => (b.punctuality! - a.punctuality!));

  const topClassAvgId = leaderClassAvg[0]?.teacher.id;
  const topPassId     = leaderPass[0]?.teacher.id;
  const topAttId      = leaderAtt[0]?.teacher.id;
  const topAssignId   = leaderAssign[0]?.teacher.id;
  const topPunctualId = leaderPunctual[0]?.teacher.id;

  // Build reason badges
  const final: TeacherScore[] = withComposite.map((r) => {
    const reasons: ReasonBadge[] = [];

    // Top of category badges (gold)
    if (r.teacher.id === topClassAvgId && r.classAvg !== null && r.classAvg > 0) {
      reasons.push({ label: "Highest Class Average", value: `${r.classAvg.toFixed(0)}%`, tone: "gold" });
    }
    if (r.teacher.id === topPassId && r.passRate !== null && r.passRate >= 50) {
      reasons.push({ label: "Top Pass Rate", value: `${r.passRate.toFixed(0)}%`, tone: "gold" });
    }
    if (r.teacher.id === topAttId && r.attendance !== null && r.attendance >= 80) {
      reasons.push({ label: "Best Class Attendance", value: `${r.attendance.toFixed(0)}%`, tone: "gold" });
    }
    if (r.teacher.id === topAssignId && r.assignments > 0) {
      reasons.push({ label: "Most Assignments Posted", value: `${r.assignments}`, tone: "gold" });
    }
    if (r.teacher.id === topPunctualId && r.punctuality !== null && r.punctuality >= 80) {
      reasons.push({ label: "Top Punctuality", value: `${r.punctuality.toFixed(0)}%`, tone: "gold" });
    }

    // Strong-performer badges (non-leaders but still excellent)
    if (reasons.length < 3) {
      if (r.classAvg !== null && r.classAvg >= 80 && !reasons.find((x) => x.label.includes("Class Average"))) {
        reasons.push({ label: "Strong Class Average", value: `${r.classAvg.toFixed(0)}%`, tone: "blue" });
      }
      if (r.passRate !== null && r.passRate >= 90 && !reasons.find((x) => x.label.includes("Pass"))) {
        reasons.push({ label: "Excellent Pass Rate", value: `${r.passRate.toFixed(0)}%`, tone: "emerald" });
      }
      if (r.attendance !== null && r.attendance >= 90 && !reasons.find((x) => x.label.includes("Attendance"))) {
        reasons.push({ label: "High Attendance", value: `${r.attendance.toFixed(0)}%`, tone: "blue" });
      }
      if (r.assignments >= 10 && !reasons.find((x) => x.label.includes("Assignments"))) {
        reasons.push({ label: "Highly Engaged", value: `${r.assignments} posted`, tone: "violet" });
      }
      if (r.punctuality !== null && r.punctuality >= 95 && !reasons.find((x) => x.label.includes("Punctuality"))) {
        reasons.push({ label: "Perfect Punctuality", value: `${r.punctuality.toFixed(0)}%`, tone: "emerald" });
      }
    }

    // No-data fallback
    if (reasons.length === 0 && r.testCount === 0 && r.assignments === 0) {
      reasons.push({ label: "New Teacher", value: "No data yet", tone: "rose" });
    }

    return { ...r, reasons: reasons.slice(0, 4) };
  });

  // Sort by composite DESC
  final.sort((a, b) => b.composite - a.composite);
  return final;
}