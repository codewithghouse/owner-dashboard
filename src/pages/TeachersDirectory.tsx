import { useState, useEffect, useMemo } from "react";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  Search, ChevronDown, Loader2, Users, GraduationCap,
  TrendingDown, Award, Building2, BookOpen, AlertTriangle,
  ChevronRight, Trophy, Medal, Target, CheckCircle2, Filter, X,
  ClipboardCheck, FileText, MessageSquare, Sparkles, Activity,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

/* ── constants ───────────────────────────────────────── */
const AVATAR_COLORS = [
  "bg-[#1e3a8a]","bg-emerald-600","bg-orange-500","bg-purple-600",
  "bg-pink-500","bg-teal-600","bg-amber-600","bg-red-600",
];

/* Performance thresholds on the 0-100 overall score */
const TOP_SCORE_THRESHOLD = 75;
const LOW_SCORE_THRESHOLD = 45;

/* Weights for activity-based overall score (must sum to 1) */
const WEIGHTS = {
  testScore:   0.30,  // avg % across test_scores
  attendance:  0.15,  // teacher's own attendance %
  attMarking:  0.15,  // attendance marking consistency (records written / expected)
  assignments: 0.10,  // assignments created
  tests:       0.10,  // tests created
  lessonPlans: 0.10,  // lesson plans saved
  parentNotes: 0.05,  // parent communication
  reports:     0.05,  // reports generated
};

/* Activity targets — if a teacher hits these counts they get full marks for that activity */
const ACTIVITY_TARGETS = {
  assignments: 10,
  tests:       5,
  lessonPlans: 8,
  parentNotes: 6,
  reports:     4,
  attMarkings: 40,   // ~2 months of daily marking
};

/* ── helpers ─────────────────────────────────────────── */
function initials(name: string) {
  return (name || "?").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function scoreLabel(s: number): { label: string; color: string; bg: string } {
  if (s >= 75) return { label: "Excellent",  color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" };
  if (s >= 60) return { label: "Good",       color: "text-blue-700",    bg: "bg-blue-50 border-blue-200"       };
  if (s >= 45) return { label: "Average",    color: "text-amber-700",   bg: "bg-amber-50 border-amber-200"     };
  if (s > 0)   return { label: "Needs Work", color: "text-red-700",     bg: "bg-red-50 border-red-200"         };
  return            { label: "No Activity",  color: "text-slate-500",   bg: "bg-slate-50 border-slate-200"     };
}

function pctOfTarget(count: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((count / target) * 100));
}

function parseScoreValue(data: any): number | null {
  const raw =
    data.percentage ??
    data.score ??
    data.marks ??
    data.marksObtained ??
    data.obtainedMarks ??
    null;
  if (raw === null || raw === undefined || raw === "") return null;
  const v = parseFloat(raw);
  return isNaN(v) ? null : v;
}

type TabKey = "branch" | "class" | "top" | "defaulter";

/* ══════════════════════════════════════════════════════ */
export default function TeachersDirectory() {
  const navigate = useNavigate();

  /* ── raw state ──────────────────────────────────── */
  const [loading,   setLoading]   = useState(true);
  const [teachers,  setTeachers]  = useState<any[]>([]);
  const [branchMap, setBranchMap] = useState<Map<string, string>>(new Map());
  const [classes,   setClasses]   = useState<any[]>([]);

  /* activity aggregates per teacherId */
  const [scoreMap,      setScoreMap]      = useState<Map<string, number[]>>(new Map());
  const [attMap,        setAttMap]        = useState<Map<string, { p: number; t: number }>>(new Map());
  const [attMarkingMap, setAttMarkingMap] = useState<Map<string, number>>(new Map());
  const [assignMap,     setAssignMap]     = useState<Map<string, number>>(new Map());
  const [testsMap,      setTestsMap]      = useState<Map<string, number>>(new Map());
  const [lessonMap,     setLessonMap]     = useState<Map<string, number>>(new Map());
  const [noteMap,       setNoteMap]       = useState<Map<string, number>>(new Map());
  const [reportMap,     setReportMap]     = useState<Map<string, number>>(new Map());

  /* ── UI state ───────────────────────────────────── */
  const [tab,          setTab]          = useState<TabKey>("branch");
  const [search,       setSearch]       = useState("");
  const [branchFilter, setBranchFilter] = useState("All");
  const [classFilter,  setClassFilter]  = useState("All");
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set());

  /* ── fetch all once ─────────────────────────────── */
  useEffect(() => {
    const ownerUid = auth.currentUser?.uid;
    if (!ownerUid) {
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        /* 1. Branches (scoped) */
        const bMap = new Map<string, string>();
        const bSnap = await getDocs(collection(db, "schools", ownerUid, "branches"));
        bSnap.docs.forEach(d => {
          const data = d.data() as any;
          const bid  = data.branchId || d.id;
          const bn   = data.name || data.branchName || "";
          if (bid && bn) bMap.set(bid, bn);
        });
        setBranchMap(bMap);

        const branchIds = [...bMap.keys()];

        /* 2. Teachers — filter by schoolId */
        let rawTeachers: any[] = [];
        try {
          const tSnap = await getDocs(
            query(collection(db, "teachers"), where("schoolId", "==", ownerUid))
          );
          rawTeachers = tSnap.docs.map(d => ({ _docId: d.id, ...(d.data() as any) }));
        } catch {
          rawTeachers = [];
        }

        /* Fallback: if no teachers carry schoolId, grab by branchId */
        if (rawTeachers.length === 0 && branchIds.length > 0) {
          const chunks: string[][] = [];
          for (let i = 0; i < branchIds.length; i += 10) chunks.push(branchIds.slice(i, i + 10));
          const seen = new Set<string>();
          for (const chunk of chunks) {
            try {
              const snap = await getDocs(
                query(collection(db, "teachers"), where("branchId", "in", chunk))
              );
              snap.docs.forEach(d => {
                if (seen.has(d.id)) return;
                seen.add(d.id);
                rawTeachers.push({ _docId: d.id, ...(d.data() as any) });
              });
            } catch { /* ignore */ }
          }
        }

        const teachersColored = rawTeachers.map((t, i) => ({
          ...t,
          _color: AVATAR_COLORS[i % AVATAR_COLORS.length],
        }));
        setTeachers(teachersColored);

        const teacherIds = teachersColored.map(t => t._docId);
        if (teacherIds.length === 0) {
          setLoading(false);
          return;
        }

        /* Chunk teacherIds into groups of 10 for Firestore `in` queries */
        const idChunks: string[][] = [];
        for (let i = 0; i < teacherIds.length; i += 10) idChunks.push(teacherIds.slice(i, i + 10));

        /* Generic helper: fetch a collection filtered by teacherId and schoolId, aggregate via reducer */
        const aggregateByTeacher = async <T,>(
          coll: string,
          reducer: (acc: Map<string, T>, doc: any) => void,
          initialValue: () => T,
        ) => {
          const map = new Map<string, T>();
          for (const chunk of idChunks) {
            try {
              const snap = await getDocs(
                query(
                  collection(db, coll),
                  where("schoolId", "==", ownerUid),
                  where("teacherId", "in", chunk),
                )
              );
              snap.docs.forEach(d => {
                const data = d.data() as any;
                const tid  = data.teacherId;
                if (!tid) return;
                if (!map.has(tid)) map.set(tid, initialValue());
                reducer(map, { ...data, _tid: tid });
              });
            } catch {
              /* Fallback without schoolId if it fails */
              try {
                const snap = await getDocs(
                  query(collection(db, coll), where("teacherId", "in", chunk))
                );
                snap.docs.forEach(d => {
                  const data = d.data() as any;
                  const tid  = data.teacherId;
                  if (!tid) return;
                  if (!map.has(tid)) map.set(tid, initialValue());
                  reducer(map, { ...data, _tid: tid });
                });
              } catch { /* ignore */ }
            }
          }
          return map;
        };

        /* 3. test_scores → teacherId → percentage[] */
        const sMap = await aggregateByTeacher<number[]>(
          "test_scores",
          (acc, data) => {
            const pct = parseScoreValue(data);
            if (pct !== null) acc.get(data._tid)!.push(pct);
          },
          () => [],
        );
        setScoreMap(sMap);

        /* 4. attendance — teacher's OWN attendance (when teacherId === self)
              AND attendance marking count (how many records teacher created) */
        const aMap        = new Map<string, { p: number; t: number }>();
        const markingMap  = new Map<string, number>();
        for (const chunk of idChunks) {
          try {
            const snap = await getDocs(
              query(
                collection(db, "attendance"),
                where("schoolId", "==", ownerUid),
                where("teacherId", "in", chunk),
              )
            );
            snap.docs.forEach(d => {
              const data = d.data() as any;
              const tid  = data.teacherId;
              if (!tid) return;
              /* attendance marking = every record written by this teacher */
              markingMap.set(tid, (markingMap.get(tid) || 0) + 1);
              /* teacher's own attendance = rows where studentId is absent / row targets teacher */
              const isSelf = !data.studentId || data.studentId === tid;
              if (isSelf) {
                if (!aMap.has(tid)) aMap.set(tid, { p: 0, t: 0 });
                const cur = aMap.get(tid)!;
                cur.t++;
                if ((data.status || "").toLowerCase() === "present") cur.p++;
              }
            });
          } catch {
            /* retry without schoolId */
            try {
              const snap = await getDocs(
                query(collection(db, "attendance"), where("teacherId", "in", chunk))
              );
              snap.docs.forEach(d => {
                const data = d.data() as any;
                const tid  = data.teacherId;
                if (!tid) return;
                markingMap.set(tid, (markingMap.get(tid) || 0) + 1);
                const isSelf = !data.studentId || data.studentId === tid;
                if (isSelf) {
                  if (!aMap.has(tid)) aMap.set(tid, { p: 0, t: 0 });
                  const cur = aMap.get(tid)!;
                  cur.t++;
                  if ((data.status || "").toLowerCase() === "present") cur.p++;
                }
              });
            } catch { /* ignore */ }
          }
        }
        setAttMap(aMap);
        setAttMarkingMap(markingMap);

        /* 5. classes — filter by schoolId */
        let clList: any[] = [];
        try {
          const clSnap = await getDocs(
            query(collection(db, "classes"), where("schoolId", "==", ownerUid))
          );
          clList = clSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        } catch { /* ignore */ }
        setClasses(clList);

        /* 6-10. Activity counters — assignments, tests, lessonPlans, parent_notes, reports */
        const countReducer = (acc: Map<string, number>, data: any) => {
          acc.set(data._tid, (acc.get(data._tid) || 0) + 1);
        };

        const [assignM, testsM, lessonM, notesM, reportsM] = await Promise.all([
          aggregateByTeacher<number>("assignments", countReducer, () => 0),
          aggregateByTeacher<number>("tests",       countReducer, () => 0),
          aggregateByTeacher<number>("lessonPlans", countReducer, () => 0),
          aggregateByTeacher<number>("parent_notes",countReducer, () => 0),
          aggregateByTeacher<number>("reports",     countReducer, () => 0),
        ]);

        setAssignMap(assignM);
        setTestsMap(testsM);
        setLessonMap(lessonM);
        setNoteMap(notesM);
        setReportMap(reportsM);
      } catch (e) {
        console.error("[TeachersDirectory] fetch error:", e);
      }
      setLoading(false);
    };
    load();
  }, []);

  /* ── enrich teachers with activity-based metrics ── */
  const enriched = useMemo(() => {
    return teachers.map(t => {
      const tid = t._docId;

      const scores        = scoreMap.get(tid) || [];
      const att           = attMap.get(tid);
      const attMarkCount  = attMarkingMap.get(tid) || 0;
      const teacherClasses = classes.filter(c => c.teacherId === tid);
      const assignCount   = assignMap.get(tid)  || 0;
      const testCount     = testsMap.get(tid)   || 0;
      const lessonCount   = lessonMap.get(tid)  || 0;
      const noteCount     = noteMap.get(tid)    || 0;
      const reportCount   = reportMap.get(tid)  || 0;

      const avgScore = scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;
      const attPct   = att && att.t > 0 ? Math.round((att.p / att.t) * 100) : 0;

      /* Activity-target percentages (0-100) */
      const attMarkingPct  = pctOfTarget(attMarkCount, ACTIVITY_TARGETS.attMarkings);
      const assignPct      = pctOfTarget(assignCount,  ACTIVITY_TARGETS.assignments);
      const testPct        = pctOfTarget(testCount,    ACTIVITY_TARGETS.tests);
      const lessonPct      = pctOfTarget(lessonCount,  ACTIVITY_TARGETS.lessonPlans);
      const notePct        = pctOfTarget(noteCount,    ACTIVITY_TARGETS.parentNotes);
      const reportPct      = pctOfTarget(reportCount,  ACTIVITY_TARGETS.reports);

      /* Weighted overall score — skip zero buckets gracefully */
      let weightedSum = 0;
      let weightUsed  = 0;
      const addBucket = (value: number, weight: number, hasData: boolean) => {
        if (!hasData) return;
        weightedSum += value * weight;
        weightUsed  += weight;
      };
      addBucket(avgScore,       WEIGHTS.testScore,   scores.length > 0);
      addBucket(attPct,         WEIGHTS.attendance,  !!att && att.t > 0);
      addBucket(attMarkingPct,  WEIGHTS.attMarking,  attMarkCount > 0);
      addBucket(assignPct,      WEIGHTS.assignments, assignCount  > 0);
      addBucket(testPct,        WEIGHTS.tests,       testCount    > 0);
      addBucket(lessonPct,      WEIGHTS.lessonPlans, lessonCount  > 0);
      addBucket(notePct,        WEIGHTS.parentNotes, noteCount    > 0);
      addBucket(reportPct,      WEIGHTS.reports,     reportCount  > 0);

      const overall = weightUsed > 0 ? Math.round(weightedSum / weightUsed) : 0;
      const totalActivity = assignCount + testCount + lessonCount + noteCount + reportCount + attMarkCount;

      /* Classify */
      let category: "top" | "defaulter" | "average" | "nodata";
      const reasons: string[] = [];

      if (overall === 0 && totalActivity === 0) {
        category = "nodata";
      } else if (overall >= TOP_SCORE_THRESHOLD) {
        category = "top";
        if (avgScore >= 80)       reasons.push("Excellent Scores");
        if (attMarkingPct >= 80)  reasons.push("Consistent Attendance Marking");
        if (assignPct >= 80)      reasons.push("Active Assignment Creation");
        if (lessonPct >= 80)      reasons.push("Regular Lesson Plans");
        if (notePct >= 80)        reasons.push("Strong Parent Communication");
        if (reasons.length === 0) reasons.push("High Overall Activity");
      } else if (overall > 0 && overall < LOW_SCORE_THRESHOLD) {
        category = "defaulter";
        if (avgScore > 0 && avgScore < 60)   reasons.push("Low Test Scores");
        if (attPct > 0 && attPct < 70)       reasons.push("Poor Own Attendance");
        if (attMarkCount < 5)                reasons.push("Not Marking Attendance");
        if (assignCount === 0)               reasons.push("No Assignments Created");
        if (lessonCount === 0)               reasons.push("No Lesson Plans");
        if (reasons.length === 0)            reasons.push("Low Overall Activity");
      } else {
        category = "average";
      }

      const branchName = branchMap.get(t.branchId || "") || t.branchName || t.branch || "Unassigned";

      return {
        ...t,
        id: tid,
        branchName,
        avgScore,
        attPct,
        classCount: teacherClasses.length,
        classList:  teacherClasses,
        /* activity counters */
        attMarkCount, assignCount, testCount, lessonCount, noteCount, reportCount,
        totalActivity,
        /* computed */
        overall,
        category,
        reasons,
      };
    });
  }, [teachers, scoreMap, attMap, attMarkingMap, classes, branchMap,
      assignMap, testsMap, lessonMap, noteMap, reportMap]);

  /* ── filter dropdown options ────────────────────── */
  const branchList = useMemo(() =>
    ["All", ...[...branchMap.values()].sort()],
  [branchMap]);

  const classList = useMemo(() => {
    const names = new Set<string>();
    classes.forEach(c => {
      const label = c.name || [c.grade, c.section].filter(Boolean).join(" ");
      if (label) names.add(label);
    });
    return ["All", ...[...names].sort()];
  }, [classes]);

  /* ── apply filters ──────────────────────────────── */
  const filtered = useMemo(() => {
    return enriched.filter(t => {
      if (search && !(t.name || "").toLowerCase().includes(search.toLowerCase())) return false;
      if (branchFilter !== "All" && t.branchName !== branchFilter) return false;
      if (classFilter !== "All") {
        const hasClass = (t.classList || []).some((c: any) => {
          const label = c.name || [c.grade, c.section].filter(Boolean).join(" ");
          return label === classFilter;
        });
        if (!hasClass) return false;
      }
      return true;
    });
  }, [enriched, search, branchFilter, classFilter]);

  /* ── grouped views ──────────────────────────────── */
  const byBranch = useMemo(() => {
    const map = new Map<string, any[]>();
    filtered.forEach(t => {
      const key = t.branchName || "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const byClass = useMemo(() => {
    const map = new Map<string, { classInfo: any; teachers: any[] }>();
    filtered.forEach(t => {
      (t.classList || []).forEach((c: any) => {
        const label = c.name || [c.grade, c.section].filter(Boolean).join(" ") || "Unnamed";
        if (classFilter !== "All" && label !== classFilter) return;
        if (!map.has(label)) map.set(label, { classInfo: c, teachers: [] });
        const entry = map.get(label)!;
        if (!entry.teachers.find(x => x.id === t.id)) entry.teachers.push(t);
      });
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, classFilter]);

  const topPerformers = useMemo(
    () => filtered.filter(t => t.category === "top")
                  .sort((a, b) => b.overall - a.overall),
    [filtered]
  );

  const defaulters = useMemo(
    () => filtered.filter(t => t.category === "defaulter")
                  .sort((a, b) => a.overall - b.overall),
    [filtered]
  );

  /* ── stat cards ─────────────────────────────────── */
  const totalTeachers = filtered.length;
  const topCount      = topPerformers.length;
  const defCount      = defaulters.length;
  const avgOverall    = useMemo(() => {
    const withData = filtered.filter(t => t.overall > 0);
    return withData.length
      ? Math.round(withData.reduce((a, t) => a + t.overall, 0) / withData.length)
      : 0;
  }, [filtered]);

  /* ── expand/collapse ────────────────────────────── */
  const toggleGroup = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const expandAll   = (keys: string[]) => setExpanded(new Set(keys));
  const collapseAll = () => setExpanded(new Set());
  const resetFilters = () => {
    setSearch("");
    setBranchFilter("All");
    setClassFilter("All");
  };

  /* ─────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#1e3a8a]" />
      </div>
    );
  }

  /* ══════════════════════════════════════════════ */
  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#1e294b] tracking-tight">Teachers Directory</h1>
          <p className="text-slate-500 text-xs md:text-sm font-medium">
            Branch &amp; class-wise faculty with activity-based performance scoring
          </p>
        </div>
        {(search || branchFilter !== "All" || classFilter !== "All") && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold uppercase tracking-wider transition-all self-start"
          >
            <X className="w-3.5 h-3.5" /> Clear Filters
          </button>
        )}
      </div>

      {/* Scoring explanation banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#1e3a8a] flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="text-[11px] md:text-xs text-slate-600 font-medium leading-relaxed">
          <span className="font-black text-[#1e3a8a]">Activity-Based Score</span> — weighted from
          test scores (30%), own attendance (15%), attendance marking (15%), assignments (10%),
          tests (10%), lesson plans (10%), parent notes (5%), reports (5%).
        </div>
      </div>

      {/* Filters row */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search teacher name..."
              className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-[#1e3a8a]/10 bg-slate-50"
            />
          </div>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <select
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value)}
              className="w-full appearance-none border border-slate-200 rounded-xl pl-9 pr-10 py-2.5 text-sm font-semibold text-slate-600 bg-slate-50 outline-none focus:ring-2 focus:ring-[#1e3a8a]/10"
            >
              {branchList.map(b => (
                <option key={b} value={b}>{b === "All" ? "All Branches" : b}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <div className="relative">
            <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <select
              value={classFilter}
              onChange={e => setClassFilter(e.target.value)}
              className="w-full appearance-none border border-slate-200 rounded-xl pl-9 pr-10 py-2.5 text-sm font-semibold text-slate-600 bg-slate-50 outline-none focus:ring-2 focus:ring-[#1e3a8a]/10"
            >
              {classList.map(c => (
                <option key={c} value={c}>{c === "All" ? "All Classes" : c}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Teachers",   value: totalTeachers,   icon: Users,        color: "text-blue-600",    bg: "bg-blue-50",    note: `In ${branchFilter === "All" ? "all branches" : branchFilter}`,                                            route: "/teachers",          onClick: () => setTab("branch") },
          { label: "Top Performers",   value: topCount,        icon: Trophy,       color: "text-emerald-600", bg: "bg-emerald-50", note: `${totalTeachers > 0 ? ((topCount/totalTeachers)*100).toFixed(0) : 0}% of staff`,                           route: null,                 onClick: () => setTab("top") },
          { label: "Defaulters",       value: defCount,        icon: TrendingDown, color: "text-red-600",     bg: "bg-red-50",     note: `${totalTeachers > 0 ? ((defCount/totalTeachers)*100).toFixed(0) : 0}% need attention`,                    route: null,                 onClick: () => setTab("defaulter") },
          { label: "Avg Performance",  value: `${avgOverall}%`,icon: Target,       color: "text-purple-600",  bg: "bg-purple-50",  note: "Activity-weighted score",                                                                                   route: "/teachers",          onClick: () => setTab("branch") },
        ].map(s => (
          <div
            key={s.label}
            onClick={() => { if (s.route) navigate(s.route); else s.onClick(); }}
            role="button"
            tabIndex={0}
            className="clickable-card bg-white p-4 md:p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{s.label}</p>
              <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center`}>
                <s.icon className={`w-4 h-4 ${s.color}`} />
              </div>
            </div>
            <h3 className="text-2xl md:text-3xl font-extrabold text-[#1e294b] tracking-tight mb-1">{s.value}</h3>
            <p className={`text-[10px] font-bold ${s.color}`}>{s.note}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-1 border-b border-slate-100 px-2 md:px-4 overflow-x-auto">
          {[
            { key: "branch",    label: "By Branch",       icon: Building2,     count: byBranch.length      },
            { key: "class",     label: "By Class",        icon: BookOpen,      count: byClass.length       },
            { key: "top",       label: "Top Performers",  icon: Trophy,        count: topPerformers.length },
            { key: "defaulter", label: "Needs Attention", icon: AlertTriangle, count: defaulters.length    },
          ].map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key as TabKey); setExpanded(new Set()); }}
                className={`flex items-center gap-2 px-3 md:px-4 py-3 text-xs font-bold whitespace-nowrap border-b-2 transition-all ${
                  active
                    ? "border-[#1e3a8a] text-[#1e3a8a]"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                <t.icon className="w-4 h-4" />
                <span>{t.label}</span>
                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                  active ? "bg-[#1e3a8a] text-white" : "bg-slate-100 text-slate-500"
                }`}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="p-4 md:p-6">

          {/* ── BY BRANCH ────────────────────────── */}
          {tab === "branch" && (
            <div className="space-y-4">
              <GroupControls
                total={byBranch.length}
                onExpandAll={() => expandAll(byBranch.map(([k]) => k))}
                onCollapseAll={collapseAll}
              />
              {byBranch.length === 0 ? (
                <EmptyState message="No teachers match the current filters" />
              ) : (
                byBranch.map(([branchName, list]) => {
                  const isOpen = expanded.has(branchName);
                  const topInBranch = list.filter(t => t.category === "top").length;
                  const defInBranch = list.filter(t => t.category === "defaulter").length;
                  return (
                    <div key={branchName} className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
                      <button
                        onClick={() => toggleGroup(branchName)}
                        className="w-full flex items-center justify-between px-4 md:px-5 py-4 hover:bg-slate-100 transition-all"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-[#1e3a8a] flex items-center justify-center shrink-0">
                            <Building2 className="w-5 h-5 text-white" />
                          </div>
                          <div className="text-left min-w-0">
                            <h3 className="text-sm md:text-base font-extrabold text-[#1e294b] truncate">{branchName}</h3>
                            <p className="text-[10px] md:text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              {list.length} teacher{list.length !== 1 ? "s" : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {topInBranch > 0 && (
                            <span className="hidden sm:flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100">
                              <Trophy className="w-3 h-3" /> {topInBranch}
                            </span>
                          )}
                          {defInBranch > 0 && (
                            <span className="hidden sm:flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-red-50 text-red-700 border border-red-100">
                              <AlertTriangle className="w-3 h-3" /> {defInBranch}
                            </span>
                          )}
                          <ChevronRight className={`w-5 h-5 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                        </div>
                      </button>
                      {isOpen && (
                        <div className="px-4 md:px-5 pb-5 pt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 animate-in fade-in duration-200">
                          {list.map(t => (
                            <TeacherCard key={t.id} teacher={t} onClick={() => navigate(`/teachers/${t.id}`)} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ── BY CLASS ────────────────────────── */}
          {tab === "class" && (
            <div className="space-y-4">
              <GroupControls
                total={byClass.length}
                onExpandAll={() => expandAll(byClass.map(([k]) => k))}
                onCollapseAll={collapseAll}
              />
              {byClass.length === 0 ? (
                <EmptyState message="No classes found for the selected filters" />
              ) : (
                byClass.map(([className, { classInfo, teachers: list }]) => {
                  const isOpen = expanded.has(className);
                  return (
                    <div key={className} className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
                      <button
                        onClick={() => toggleGroup(className)}
                        className="w-full flex items-center justify-between px-4 md:px-5 py-4 hover:bg-slate-100 transition-all"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center shrink-0">
                            <BookOpen className="w-5 h-5 text-white" />
                          </div>
                          <div className="text-left min-w-0">
                            <h3 className="text-sm md:text-base font-extrabold text-[#1e294b] truncate">{className}</h3>
                            <p className="text-[10px] md:text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              {list.length} teacher{list.length !== 1 ? "s" : ""}
                              {classInfo?.subject ? ` · ${classInfo.subject}` : ""}
                            </p>
                          </div>
                        </div>
                        <ChevronRight className={`w-5 h-5 text-slate-400 transition-transform shrink-0 ${isOpen ? "rotate-90" : ""}`} />
                      </button>
                      {isOpen && (
                        <div className="px-4 md:px-5 pb-5 pt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 animate-in fade-in duration-200">
                          {list.map(t => (
                            <TeacherCard key={t.id} teacher={t} onClick={() => navigate(`/teachers/${t.id}`)} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ── TOP PERFORMERS ──────────────────── */}
          {tab === "top" && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl p-5 flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
                  <Trophy className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-emerald-900 mb-1">Top Performing Teachers</h3>
                  <p className="text-xs text-emerald-800 font-semibold leading-relaxed">
                    Teachers with overall activity score <b>≥ {TOP_SCORE_THRESHOLD}%</b>.
                    Scoring blends test results, attendance discipline, assignments, lesson plans &amp; parent communication.
                  </p>
                </div>
              </div>
              {topPerformers.length === 0 ? (
                <EmptyState message="No top performers yet — activity data will populate as teachers work" icon={Award} />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {topPerformers.map((t, i) => (
                    <TopCard key={t.id} teacher={t} rank={i + 1} onClick={() => navigate(`/teachers/${t.id}`)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── DEFAULTERS ──────────────────────── */}
          {tab === "defaulter" && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-100 rounded-2xl p-5 flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-red-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-red-900 mb-1">Teachers Needing Attention</h3>
                  <p className="text-xs text-red-800 font-semibold leading-relaxed">
                    Teachers with overall activity score below <b>{LOW_SCORE_THRESHOLD}%</b>.
                    Look at the reason tags to decide whether they need mentoring, training or a review.
                  </p>
                </div>
              </div>
              {defaulters.length === 0 ? (
                <EmptyState message="Great news — no defaulters in this filter" icon={CheckCircle2} />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {defaulters.map(t => (
                    <DefaulterCard key={t.id} teacher={t} onClick={() => navigate(`/teachers/${t.id}`)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════ */
/* ── sub-components ─────────────────────────────── */

function GroupControls({ total, onExpandAll, onCollapseAll }: { total: number; onExpandAll: () => void; onCollapseAll: () => void }) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between">
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{total} group{total !== 1 ? "s" : ""}</p>
      <div className="flex items-center gap-2">
        <button
          onClick={onExpandAll}
          className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600 transition-all"
        >
          Expand All
        </button>
        <button
          onClick={onCollapseAll}
          className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600 transition-all"
        >
          Collapse All
        </button>
      </div>
    </div>
  );
}

function EmptyState({ message, icon: Icon = GraduationCap }: { message: string; icon?: any }) {
  return (
    <div className="py-16 flex flex-col items-center gap-3">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
        <Icon className="w-7 h-7 text-slate-300" />
      </div>
      <p className="text-sm text-slate-400 font-semibold">{message}</p>
    </div>
  );
}

/* Small activity row inside cards — icon + count + label */
function ActivityChip({ icon: Icon, count, label, color }: { icon: any; count: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${count}`}>
      <Icon className={`w-3 h-3 ${color}`} />
      <span className="text-[10px] font-bold text-slate-600">{count}</span>
    </div>
  );
}

function TeacherCard({ teacher, onClick }: { teacher: any; onClick: () => void }) {
  const sl = scoreLabel(teacher.overall);
  return (
    <div
      onClick={onClick}
      className="bg-white border border-slate-100 rounded-2xl p-4 hover:shadow-lg hover:border-[#1e3a8a]/20 cursor-pointer group transition-all"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl ${teacher._color} flex items-center justify-center text-white text-xs font-extrabold shrink-0`}>
          {initials(teacher.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[#1e294b] truncate group-hover:text-[#1e3a8a]">{teacher.name}</p>
          <p className="text-[10px] text-slate-400 font-semibold truncate">{teacher.subject || "—"}</p>
        </div>
        <span className={`text-[9px] font-black px-2 py-1 rounded-lg border ${sl.bg} ${sl.color} shrink-0 uppercase tracking-wider`}>
          {sl.label}
        </span>
      </div>

      {/* overall + sub-scores */}
      <div className="grid grid-cols-3 gap-2 text-center pt-3 border-t border-slate-100 mb-3">
        <div>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Overall</p>
          <p className={`text-sm font-extrabold ${sl.color}`}>{teacher.overall > 0 ? `${teacher.overall}%` : "—"}</p>
        </div>
        <div>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Score</p>
          <p className="text-sm font-extrabold text-[#1e294b]">{teacher.avgScore > 0 ? `${teacher.avgScore}%` : "—"}</p>
        </div>
        <div>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Classes</p>
          <p className="text-sm font-extrabold text-[#1e294b]">{teacher.classCount}</p>
        </div>
      </div>

      {/* activity strip */}
      <div className="flex items-center justify-between bg-slate-50 rounded-lg px-2 py-1.5">
        <ActivityChip icon={ClipboardCheck} count={teacher.attMarkCount} label="Attendance entries"   color="text-blue-500"    />
        <ActivityChip icon={FileText}       count={teacher.assignCount}  label="Assignments created"  color="text-orange-500"  />
        <ActivityChip icon={Activity}       count={teacher.testCount}    label="Tests created"        color="text-purple-500"  />
        <ActivityChip icon={BookOpen}       count={teacher.lessonCount}  label="Lesson plans"         color="text-teal-500"    />
        <ActivityChip icon={MessageSquare}  count={teacher.noteCount}    label="Parent notes"         color="text-pink-500"    />
      </div>
    </div>
  );
}

function TopCard({ teacher, rank, onClick }: { teacher: any; rank: number; onClick: () => void }) {
  const medalColor =
    rank === 1 ? "bg-gradient-to-br from-yellow-400 to-amber-500" :
    rank === 2 ? "bg-gradient-to-br from-slate-300 to-slate-400" :
    rank === 3 ? "bg-gradient-to-br from-orange-400 to-amber-600" :
                 "bg-emerald-500";
  return (
    <div
      onClick={onClick}
      className="bg-white border border-emerald-100 rounded-2xl p-5 hover:shadow-xl hover:border-emerald-300 cursor-pointer group transition-all relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-full blur-2xl opacity-60" />
      <div className="relative">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-11 h-11 rounded-xl ${teacher._color} flex items-center justify-center text-white text-sm font-extrabold shrink-0`}>
            {initials(teacher.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-[#1e294b] truncate group-hover:text-emerald-700">{teacher.name}</p>
            <p className="text-[10px] text-slate-400 font-semibold truncate">{teacher.subject || "—"} · {teacher.branchName}</p>
          </div>
          <div className={`w-9 h-9 rounded-xl ${medalColor} flex items-center justify-center shrink-0 shadow-md`}>
            <Medal className="w-4 h-4 text-white" />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {teacher.reasons.map((r: string) => (
            <span key={r} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase tracking-wider">
              {r}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="text-center bg-emerald-50 rounded-xl py-2">
            <p className="text-[9px] text-emerald-600 font-bold uppercase tracking-wider">Overall</p>
            <p className="text-lg font-extrabold text-emerald-700">{teacher.overall}%</p>
          </div>
          <div className="text-center bg-blue-50 rounded-xl py-2">
            <p className="text-[9px] text-blue-600 font-bold uppercase tracking-wider">Test Avg</p>
            <p className="text-lg font-extrabold text-blue-700">{teacher.avgScore > 0 ? `${teacher.avgScore}%` : "—"}</p>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-1 pt-3 border-t border-slate-100">
          <ActivityChip icon={ClipboardCheck} count={teacher.attMarkCount} label="Attendance" color="text-blue-500"/>
          <ActivityChip icon={FileText}       count={teacher.assignCount}  label="Assignments" color="text-orange-500"/>
          <ActivityChip icon={Activity}       count={teacher.testCount}    label="Tests" color="text-purple-500"/>
          <ActivityChip icon={BookOpen}       count={teacher.lessonCount}  label="Lessons" color="text-teal-500"/>
          <ActivityChip icon={MessageSquare}  count={teacher.noteCount}    label="Notes" color="text-pink-500"/>
        </div>
      </div>
    </div>
  );
}

function DefaulterCard({ teacher, onClick }: { teacher: any; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="bg-white border border-red-100 rounded-2xl p-5 hover:shadow-xl hover:border-red-300 cursor-pointer group transition-all relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-24 h-24 bg-red-50 rounded-full blur-2xl opacity-60" />
      <div className="relative">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-11 h-11 rounded-xl ${teacher._color} flex items-center justify-center text-white text-sm font-extrabold shrink-0`}>
            {initials(teacher.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-[#1e294b] truncate group-hover:text-red-700">{teacher.name}</p>
            <p className="text-[10px] text-slate-400 font-semibold truncate">{teacher.subject || "—"} · {teacher.branchName}</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-red-600 flex items-center justify-center shrink-0 shadow-md">
            <AlertTriangle className="w-4 h-4 text-white" />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {teacher.reasons.map((r: string) => (
            <span key={r} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-red-50 text-red-700 border border-red-100 uppercase tracking-wider">
              {r}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="text-center bg-red-50 rounded-xl py-2">
            <p className="text-[9px] text-red-600 font-bold uppercase tracking-wider">Overall</p>
            <p className="text-lg font-extrabold text-red-700">{teacher.overall > 0 ? `${teacher.overall}%` : "—"}</p>
          </div>
          <div className="text-center bg-orange-50 rounded-xl py-2">
            <p className="text-[9px] text-orange-600 font-bold uppercase tracking-wider">Test Avg</p>
            <p className="text-lg font-extrabold text-orange-700">{teacher.avgScore > 0 ? `${teacher.avgScore}%` : "—"}</p>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-1 pt-3 border-t border-slate-100">
          <ActivityChip icon={ClipboardCheck} count={teacher.attMarkCount} label="Attendance" color="text-blue-500"/>
          <ActivityChip icon={FileText}       count={teacher.assignCount}  label="Assignments" color="text-orange-500"/>
          <ActivityChip icon={Activity}       count={teacher.testCount}    label="Tests" color="text-purple-500"/>
          <ActivityChip icon={BookOpen}       count={teacher.lessonCount}  label="Lessons" color="text-teal-500"/>
          <ActivityChip icon={MessageSquare}  count={teacher.noteCount}    label="Notes" color="text-pink-500"/>
        </div>
      </div>
    </div>
  );
}
