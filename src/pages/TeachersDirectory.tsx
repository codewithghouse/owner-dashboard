import { useState, useEffect, useMemo } from "react";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  Search, Loader2, Users, GraduationCap,
  TrendingDown, Award, Building2, BookOpen, AlertTriangle,
  ChevronRight, Trophy, Medal, Target, CheckCircle2, Filter, X,
  ClipboardCheck, FileText, MessageSquare, Sparkles, Activity,
  BarChart3,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD, VIOLET, ORANGE,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, GRAD_RED,
  SHADOW_SM, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, Card3D, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";
import { PortalSelect } from "@/components/PortalSelect";

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
  const isMobile = useIsMobile();
  const pageShellStyle = usePageShellStyle();

  /* ── raw state ──────────────────────────────────── */
  const [loading,   setLoading]   = useState(true);
  const [teachers,  setTeachers]  = useState<any[]>([]);
  const [branchMap, setBranchMap] = useState<Map<string, string>>(new Map());
  const [classes,   setClasses]   = useState<any[]>([]);
  /* classId → Set<teacherId> built from teaching_assignments (subject + class teachers union) */
  const [classTeacherMap, setClassTeacherMap] = useState<Map<string, Set<string>>>(new Map());

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

        setTeachers(rawTeachers);

        const teacherIds = rawTeachers.map(t => t._docId);
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

        /* 4a. attendance — student attendance ROWS written by teacher.
              We count UNIQUE marking DAYS (not raw rows) — a teacher who marked
              30 students on a single day is doing one marking event, not thirty.
              Source: `attendance` collection (each row = one student, has `date`). */
        const markingDays = new Map<string, Set<string>>();
        for (const chunk of idChunks) {
          const fetchAtt = async (withSchool: boolean) => {
            const constraints: any[] = [where("teacherId", "in", chunk)];
            if (withSchool) constraints.unshift(where("schoolId", "==", ownerUid));
            return getDocs(query(collection(db, "attendance"), ...constraints));
          };
          try {
            let snap;
            try { snap = await fetchAtt(true); }
            catch { snap = await fetchAtt(false); }
            snap.docs.forEach(d => {
              const data = d.data() as any;
              const tid  = data.teacherId;
              const date = data.date;
              if (!tid || !date) return;
              if (!markingDays.has(tid)) markingDays.set(tid, new Set());
              markingDays.get(tid)!.add(String(date));
            });
          } catch { /* ignore */ }
        }
        const markingMap = new Map<string, number>();
        markingDays.forEach((dates, tid) => markingMap.set(tid, dates.size));

        /* 4b. teacher_attendance — teacher's OWN punctuality.
              Canonical collection used by Owner TeacherLeaderboard, Principal scorer,
              and TeacherProfile. Replaces the previous (broken) self-detection on
              `attendance` rows that always carry `studentId`. */
        const aMap = new Map<string, { p: number; t: number }>();
        for (const chunk of idChunks) {
          const fetchTAtt = async (withSchool: boolean) => {
            const constraints: any[] = [where("teacherId", "in", chunk)];
            if (withSchool) constraints.unshift(where("schoolId", "==", ownerUid));
            return getDocs(query(collection(db, "teacher_attendance"), ...constraints));
          };
          try {
            let snap;
            try { snap = await fetchTAtt(true); }
            catch { snap = await fetchTAtt(false); }
            snap.docs.forEach(d => {
              const data = d.data() as any;
              const tid  = data.teacherId;
              if (!tid) return;
              const status = (data.status || "").toLowerCase();
              if (status === "holiday") return; // exclude whole-class off-days
              if (!aMap.has(tid)) aMap.set(tid, { p: 0, t: 0 });
              const cur = aMap.get(tid)!;
              cur.t++;
              if (status === "present" || status === "late") cur.p++;
            });
          } catch { /* ignore */ }
        }
        setAttMap(aMap);
        setAttMarkingMap(markingMap);

        /* 5a. classes — filter by schoolId */
        let clList: any[] = [];
        try {
          const clSnap = await getDocs(
            query(collection(db, "classes"), where("schoolId", "==", ownerUid))
          );
          clList = clSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        } catch { /* ignore */ }
        setClasses(clList);

        /* 5b. teaching_assignments — canonical map of which teachers teach which class.
              `classes.teacherId` only stores the PRIMARY/class teacher. Subject teachers
              (English/Maths assigned to an existing class) live ONLY here. Without this,
              subject teachers show classCount: 0 and miss "By Class" grouping. */
        const ctMap = new Map<string, Set<string>>();
        try {
          const taSnap = await getDocs(
            query(collection(db, "teaching_assignments"), where("schoolId", "==", ownerUid))
          );
          taSnap.docs.forEach(d => {
            const a = d.data() as any;
            const cid = a.classId;
            const tid = a.teacherId;
            const status = (a.status || "active").toLowerCase();
            if (!cid || !tid || status !== "active") return;
            if (!ctMap.has(cid)) ctMap.set(cid, new Set());
            ctMap.get(cid)!.add(tid);
          });
        } catch { /* ignore */ }
        /* Also fold direct classes.teacherId into the map so a single lookup is enough downstream. */
        clList.forEach(c => {
          if (!c.teacherId) return;
          if (!ctMap.has(c.id)) ctMap.set(c.id, new Set());
          ctMap.get(c.id)!.add(c.teacherId);
        });
        setClassTeacherMap(ctMap);

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
      /* Class membership: union of `classes.teacherId === tid` and `teaching_assignments`.
         Subject teachers only appear in teaching_assignments, so single-source lookup misses them. */
      const teacherClasses = classes.filter(c =>
        c.teacherId === tid || classTeacherMap.get(c.id)?.has(tid)
      );
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
  }, [teachers, scoreMap, attMap, attMarkingMap, classes, classTeacherMap, branchMap,
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
      <div style={{ ...pageShellStyle, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <Loader2 className="animate-spin" size={32} color={B1}/>
      </div>
    );
  }

  /* ══════════════════════════════════════════════ */
  const tabs: { key: TabKey; label: string; icon: any; count: number }[] = [
    { key: "branch",    label: "By Branch",       icon: Building2,     count: byBranch.length      },
    { key: "class",     label: "By Class",        icon: BookOpen,      count: byClass.length       },
    { key: "top",       label: "Top Performers",  icon: Trophy,        count: topPerformers.length },
    { key: "defaulter", label: "Needs Attention", icon: AlertTriangle, count: defaulters.length    },
  ];

  return (
    <>
      <DashGlobalStyles />
      <div style={pageShellStyle}>
        <PageHead
          icon={GraduationCap}
          title="Teachers Directory"
          subtitle="Branch & class-wise faculty with activity scoring"
          right={
            (search || branchFilter !== "All" || classFilter !== "All") ? (
              <button
                onClick={resetFilters}
                className="dash-btn"
                style={{
                  display:"inline-flex", alignItems:"center", justifyContent:"center", gap:7,
                  padding: isMobile ? "9px 14px" : "10px 16px", borderRadius:12,
                  background:"#fff", border:"0.5px solid rgba(0,85,255,.12)",
                  fontSize: isMobile ? 10 : 11, fontWeight:800, color:T3, letterSpacing:"0.08em", textTransform:"uppercase",
                  cursor:"pointer", boxShadow:SHADOW_SM, fontFamily:"inherit",
                  width: isMobile ? "100%" : "auto",
                }}
              >
                <X size={13}/> Clear Filters
              </button>
            ) : null
          }
        />

        <DarkHero
          icon={Award}
          eyebrow="Activity-Based Intelligence"
          title={`${avgOverall}%`}
          subtitle={`Weighted activity score across ${totalTeachers} teacher${totalTeachers !== 1 ? "s" : ""} · ${branchList.length-1} branch${branchList.length-1 !== 1 ? "es" : ""}`}
          stats={[
            { label:"Total", value:totalTeachers.toString() },
            { label:"Top", value:topCount.toString() },
            { label:"Needs Help", value:defCount.toString() },
          ]}
        />

        {/* Scoring banner */}
        <div
          className="dash3d"
          style={{
            background:"#fff", borderRadius: isMobile ? 14 : 18, padding: isMobile ? "12px 14px" : "14px 18px",
            border:"0.5px solid rgba(0,85,255,.10)", boxShadow:SHADOW_SM,
            marginBottom: isMobile ? 16 : 24, display:"flex", alignItems:"flex-start", gap: isMobile ? 10 : 12,
          }}
        >
          <div style={{ width: isMobile ? 30 : 36, height: isMobile ? 30 : 36, borderRadius: isMobile ? 10 : 11, background:GRAD_PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 6px 14px rgba(0,85,255,.28)", flexShrink:0 }}>
            <Sparkles size={isMobile ? 15 : 18} color="#fff" strokeWidth={2.3}/>
          </div>
          <div style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:T3, lineHeight:1.5 }}>
            <span style={{ fontWeight:800, color:B1 }}>Activity-Based Score</span> — weighted from test scores (30%),
            own attendance (15%), attendance marking (15%), assignments (10%), tests (10%), lesson plans (10%),
            parent notes (5%), reports (5%).
          </div>
        </div>

        {/* Filters row */}
        <Card3D padding={isMobile ? "14px 14px" : "16px 18px"} style={{ marginBottom: isMobile ? 16 : 24 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom: isMobile ? 10 : 12 }}>
            <Filter size={14} color={T4}/>
            <span style={{ fontSize:10, fontWeight:800, color:T4, letterSpacing:"0.14em", textTransform:"uppercase" }}>Filters</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 10 : 12 }}>
            <div style={{ position:"relative" }}>
              <Search size={14} color={T4} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}/>
              <input
                value={search}
                onChange={e=>setSearch(e.target.value)}
                placeholder="Search teacher name..."
                style={{
                  width:"100%", padding:"10px 12px 10px 36px", borderRadius:12,
                  border:"0.5px solid rgba(0,85,255,.14)", background:"#F5F9FF",
                  fontSize:13, fontWeight:500, color:T1, outline:"none", fontFamily:"inherit",
                }}
              />
            </div>
            <PortalSelect
              value={branchFilter}
              options={branchList.map(b => ({ value: b, label: b === "All" ? "All Branches" : b }))}
              onChange={setBranchFilter}
              leftIcon={<Building2 size={14} color={T4}/>}
            />
            <PortalSelect
              value={classFilter}
              options={classList.map(c => ({ value: c, label: c === "All" ? "All Classes" : c }))}
              onChange={setClassFilter}
              leftIcon={<BookOpen size={14} color={T4}/>}
            />
          </div>
        </Card3D>

        {/* Bright stat grid */}
        <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 16 : 24 }}>
          <StatTile label="Total Teachers"   value={totalTeachers.toString()}  sub={`In ${branchFilter === "All" ? "all branches" : branchFilter}`} grad={GRAD_BLUE}   icon={Users}        onClick={()=>{ setTab("branch"); }} />
          <StatTile label="Top Performers"   value={topCount.toString()}       sub={`${totalTeachers > 0 ? ((topCount/totalTeachers)*100).toFixed(0) : 0}% of staff`} grad={GRAD_GREEN}  icon={Trophy}       onClick={()=>{ setTab("top"); }} />
          <StatTile label="Defaulters"       value={defCount.toString()}       sub={`${totalTeachers > 0 ? ((defCount/totalTeachers)*100).toFixed(0) : 0}% need attention`} grad={defCount > 0 ? GRAD_RED : GRAD_GOLD} icon={TrendingDown} onClick={()=>{ setTab("defaulter"); }} />
          <StatTile label="Avg Performance"  value={`${avgOverall}%`}          sub="Activity-weighted"                                 grad={GRAD_VIOLET} icon={Target}       onClick={()=>{ setTab("branch"); }} />
        </div>

        {/* Tabs */}
        <div
          className="dash3d"
          style={{
            background:"#fff", borderRadius: isMobile ? 16 : 22,
            boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
            overflow:"hidden", marginBottom: isMobile ? 16 : 24,
          }}
        >
          <div style={{ display:"flex", gap:4, borderBottom:"0.5px solid rgba(0,85,255,.08)", padding: isMobile ? "6px 6px" : "6px 8px", overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
            {tabs.map(t => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={()=>{ setTab(t.key); setExpanded(new Set()); }}
                  className={`dash-btn td-tab${active ? "" : " td-tab--inactive"}`}
                  style={{
                    display:"inline-flex", alignItems:"center", gap: isMobile ? 6 : 8,
                    padding: isMobile ? "9px 13px" : "10px 16px", borderRadius:12,
                    background: active ? GRAD_PRIMARY : "transparent",
                    color: active ? "#fff" : "#1B2A55",
                    fontSize: isMobile ? 11 : 11, letterSpacing:"0.06em", textTransform:"uppercase",
                    border:"none", cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap",
                    boxShadow: active ? SHADOW_BTN : "none",
                    flexShrink:0,
                  }}
                >
                  <t.icon size={isMobile ? 13 : 14} strokeWidth={2.6} color={active ? "#fff" : "#1B2A55"}/>
                  <span>{t.label}</span>
                  <span className="td-tab__count" style={{
                    fontSize:10, padding:"2px 7px", borderRadius:999,
                    background: active ? "rgba(255,255,255,.3)" : "rgba(0,85,255,.10)",
                    color: active ? "#fff" : "#0044CC",
                  }}>
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ padding: isMobile ? 14 : 22 }}>
            {tab === "branch" && (
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
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
                      <div key={branchName} style={{ background:"#F5F9FF", borderRadius: isMobile ? 14 : 18, border:"0.5px solid rgba(0,85,255,.08)", overflow:"hidden" }}>
                        <button
                          onClick={()=>toggleGroup(branchName)}
                          className="dash-row"
                          style={{
                            width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", gap: isMobile ? 8 : 12,
                            padding: isMobile ? "12px 14px" : "14px 18px", background:"transparent", border:"none", cursor:"pointer",
                            fontFamily:"inherit",
                          }}
                        >
                          <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, minWidth:0, flex:1 }}>
                            <div style={{ width: isMobile ? 36 : 42, height: isMobile ? 36 : 42, borderRadius: isMobile ? 11 : 13, background:GRAD_PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 6px 14px rgba(0,85,255,.22)", flexShrink:0 }}>
                              <Building2 size={isMobile ? 17 : 20} color="#fff" strokeWidth={2.3}/>
                            </div>
                            <div style={{ textAlign:"left", minWidth:0 }}>
                              <h3 style={{ fontSize: isMobile ? 13 : 14, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.2px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{branchName}</h3>
                              <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:700, color:"#5A6E96", margin:"2px 0 0 0", letterSpacing:"0.10em", textTransform:"uppercase" }}>
                                {list.length} teacher{list.length !== 1 ? "s" : ""}
                              </p>
                            </div>
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 4 : 8, flexShrink:0 }}>
                            {topInBranch > 0 && (
                              <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize: isMobile ? 9 : 10, fontWeight:800, padding: isMobile ? "3px 7px" : "4px 10px", borderRadius:999, background:"rgba(0,200,83,.12)", color:GREEN }}>
                                <Trophy size={isMobile ? 10 : 11}/> {topInBranch}
                              </span>
                            )}
                            {defInBranch > 0 && (
                              <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize: isMobile ? 9 : 10, fontWeight:800, padding: isMobile ? "3px 7px" : "4px 10px", borderRadius:999, background:"rgba(255,51,85,.12)", color:RED }}>
                                <AlertTriangle size={isMobile ? 10 : 11}/> {defInBranch}
                              </span>
                            )}
                            <ChevronRight size={isMobile ? 16 : 18} color={T4} style={{ transition:"transform .3s", transform: isOpen ? "rotate(90deg)" : "rotate(0)" }}/>
                          </div>
                        </button>
                        {isOpen && (
                          <div style={{ padding: isMobile ? "4px 12px 14px 12px" : "4px 18px 18px 18px", display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(260px, 1fr))", gap: isMobile ? 10 : 12 }}>
                            {list.map(t => (
                              <TeacherCard key={t.id} teacher={t} onClick={() => navigate(`/teachers/${t.id}`)} isMobile={isMobile} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {tab === "class" && (
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
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
                      <div key={className} style={{ background:"#F5F9FF", borderRadius: isMobile ? 14 : 18, border:"0.5px solid rgba(0,85,255,.08)", overflow:"hidden" }}>
                        <button
                          onClick={()=>toggleGroup(className)}
                          className="dash-row"
                          style={{
                            width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", gap: isMobile ? 8 : 12,
                            padding: isMobile ? "12px 14px" : "14px 18px", background:"transparent", border:"none", cursor:"pointer",
                            fontFamily:"inherit",
                          }}
                        >
                          <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, minWidth:0, flex:1 }}>
                            <div style={{ width: isMobile ? 36 : 42, height: isMobile ? 36 : 42, borderRadius: isMobile ? 11 : 13, background:"linear-gradient(135deg,#7B3FF4 0%,#9333EA 100%)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 6px 14px rgba(123,63,244,.28)", flexShrink:0 }}>
                              <BookOpen size={isMobile ? 17 : 20} color="#fff" strokeWidth={2.3}/>
                            </div>
                            <div style={{ textAlign:"left", minWidth:0 }}>
                              <h3 style={{ fontSize: isMobile ? 13 : 14, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.2px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{className}</h3>
                              <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:700, color:"#5A6E96", margin:"2px 0 0 0", letterSpacing:"0.10em", textTransform:"uppercase", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                                {list.length} teacher{list.length !== 1 ? "s" : ""}{classInfo?.subject ? ` · ${classInfo.subject}` : ""}
                              </p>
                            </div>
                          </div>
                          <ChevronRight size={isMobile ? 16 : 18} color={T4} style={{ flexShrink:0, transition:"transform .3s", transform: isOpen ? "rotate(90deg)" : "rotate(0)" }}/>
                        </button>
                        {isOpen && (
                          <div style={{ padding: isMobile ? "4px 12px 14px 12px" : "4px 18px 18px 18px", display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(260px, 1fr))", gap: isMobile ? 10 : 12 }}>
                            {list.map(t => (
                              <TeacherCard key={t.id} teacher={t} onClick={() => navigate(`/teachers/${t.id}`)} isMobile={isMobile} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {tab === "top" && (
              <div style={{ display:"flex", flexDirection:"column", gap: isMobile ? 12 : 16 }}>
                <div
                  className="dash3d"
                  style={{
                    background:GRAD_GREEN, borderRadius: isMobile ? 14 : 18, padding: isMobile ? "14px 16px" : "18px 22px",
                    display:"flex", gap: isMobile ? 12 : 14, alignItems:"flex-start",
                    boxShadow:"0 8px 24px rgba(6,95,70,.14)", border:"0.5px solid rgba(6,95,70,.10)",
                  }}
                >
                  <div style={{ width: isMobile ? 38 : 44, height: isMobile ? 38 : 44, borderRadius: isMobile ? 11 : 13, background:"rgba(6,95,70,.12)", border:"0.5px solid rgba(6,95,70,.18)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <Trophy size={isMobile ? 18 : 22} color="#065F46" strokeWidth={2.2}/>
                  </div>
                  <div style={{ minWidth:0 }}>
                    <h3 style={{ fontSize: isMobile ? 14 : 16, fontWeight:800, color:"#065F46", margin:0, letterSpacing:"-0.3px" }}>Top Performing Teachers</h3>
                    <p style={{ fontSize: isMobile ? 11 : 12, fontWeight:500, color:"#047857", margin:"6px 0 0 0", lineHeight:1.5 }}>
                      Teachers with overall activity score ≥ <b>{TOP_SCORE_THRESHOLD}%</b>.
                      Scoring blends test results, attendance discipline, assignments, lesson plans &amp; parent communication.
                    </p>
                  </div>
                </div>
                {topPerformers.length === 0 ? (
                  <EmptyState message="No top performers yet — activity data will populate as teachers work" icon={Award} />
                ) : (
                  <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))", gap: isMobile ? 10 : 14 }}>
                    {topPerformers.map((t, i) => (
                      <TopCard key={t.id} teacher={t} rank={i + 1} onClick={() => navigate(`/teachers/${t.id}`)} isMobile={isMobile} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "defaulter" && (
              <div style={{ display:"flex", flexDirection:"column", gap: isMobile ? 12 : 16 }}>
                <div
                  className="dash3d"
                  style={{
                    background:GRAD_RED, borderRadius: isMobile ? 14 : 18, padding: isMobile ? "14px 16px" : "18px 22px",
                    display:"flex", gap: isMobile ? 12 : 14, alignItems:"flex-start",
                    boxShadow:"0 8px 24px rgba(153,27,27,.14)", border:"0.5px solid rgba(153,27,27,.10)",
                  }}
                >
                  <div style={{ width: isMobile ? 38 : 44, height: isMobile ? 38 : 44, borderRadius: isMobile ? 11 : 13, background:"rgba(153,27,27,.12)", border:"0.5px solid rgba(153,27,27,.18)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <AlertTriangle size={isMobile ? 18 : 22} color="#991B1B" strokeWidth={2.2}/>
                  </div>
                  <div style={{ minWidth:0 }}>
                    <h3 style={{ fontSize: isMobile ? 14 : 16, fontWeight:800, color:"#991B1B", margin:0, letterSpacing:"-0.3px" }}>Teachers Needing Attention</h3>
                    <p style={{ fontSize: isMobile ? 11 : 12, fontWeight:500, color:"#B91C1C", margin:"6px 0 0 0", lineHeight:1.5 }}>
                      Teachers with overall activity score below <b>{LOW_SCORE_THRESHOLD}%</b>.
                      Look at the reason tags to decide whether they need mentoring, training or a review.
                    </p>
                  </div>
                </div>
                {defaulters.length === 0 ? (
                  <EmptyState message="Great news — no defaulters in this filter" icon={CheckCircle2} />
                ) : (
                  <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))", gap: isMobile ? 10 : 14 }}>
                    {defaulters.map(t => (
                      <DefaulterCard key={t.id} teacher={t} onClick={() => navigate(`/teachers/${t.id}`)} isMobile={isMobile} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <AIInsightCard
          title="Faculty Intelligence Summary"
          items={[
            { label:"Team Strength", value: `${topCount} top performer${topCount!==1?"s":""}`, sub: totalTeachers>0 ? `${((topCount/totalTeachers)*100).toFixed(0)}% of staff` : "Awaiting data" },
            { label:"Attention Queue", value: defCount>0 ? `${defCount} need${defCount===1?"s":""} help` : "All stable", sub: defCount>0 ? "Recommend coaching" : "No intervention" },
            { label:"Performance Pulse", value: `${avgOverall}% avg activity`, sub: avgOverall>=70?"Healthy":avgOverall>=50?"Average":"Needs focus" },
          ]}
        />
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════ */
/* ── sub-components ─────────────────────────────── */

function GroupControls({ total, onExpandAll, onCollapseAll }: { total: number; onExpandAll: () => void; onCollapseAll: () => void }) {
  if (total === 0) return null;
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <p style={{ fontSize:10, fontWeight:800, color:T4, letterSpacing:"0.12em", textTransform:"uppercase", margin:0 }}>{total} group{total !== 1 ? "s" : ""}</p>
      <div style={{ display:"flex", gap:6 }}>
        <button
          onClick={onExpandAll}
          className="dash-btn"
          style={{
            padding:"6px 12px", borderRadius:10,
            background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
            fontSize:10, fontWeight:800, color:T3, letterSpacing:"0.12em", textTransform:"uppercase",
            cursor:"pointer", fontFamily:"inherit",
          }}
        >
          Expand All
        </button>
        <button
          onClick={onCollapseAll}
          className="dash-btn"
          style={{
            padding:"6px 12px", borderRadius:10,
            background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
            fontSize:10, fontWeight:800, color:T3, letterSpacing:"0.12em", textTransform:"uppercase",
            cursor:"pointer", fontFamily:"inherit",
          }}
        >
          Collapse All
        </button>
      </div>
    </div>
  );
}

function EmptyState({ message, icon: Icon = GraduationCap }: { message: string; icon?: any }) {
  return (
    <div style={{ padding:"50px 0", display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
      <div style={{ width:56, height:56, borderRadius:16, background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <Icon size={26} color={T4}/>
      </div>
      <p style={{ fontSize:12, fontWeight:700, color:T4, margin:0, letterSpacing:"0.04em" }}>{message}</p>
    </div>
  );
}

function tierFromScore(score: number): { label: string; grad: string; solidGrad: string; color: string; bg: string } {
  if (score >= 75) return { label:"Excellent", grad:GRAD_GREEN, solidGrad:"linear-gradient(135deg,#10B981 0%,#059669 100%)", color:GREEN, bg:"rgba(0,200,83,.10)" };
  if (score >= 60) return { label:"Good", grad:GRAD_BLUE, solidGrad:"linear-gradient(135deg,#0055FF 0%,#1166FF 100%)", color:B1, bg:"rgba(0,85,255,.08)" };
  if (score >= 45) return { label:"Average", grad:GRAD_GOLD, solidGrad:"linear-gradient(135deg,#F59E0B 0%,#D97706 100%)", color:GOLD, bg:"rgba(255,170,0,.10)" };
  if (score > 0)   return { label:"Needs Work", grad:GRAD_RED, solidGrad:"linear-gradient(135deg,#FF3355 0%,#DC2626 100%)", color:RED, bg:"rgba(255,51,85,.10)" };
  return             { label:"No Activity", grad:"linear-gradient(135deg,#99AACC,#5070B0)", solidGrad:"linear-gradient(135deg,#99AACC,#5070B0)", color:T4, bg:"rgba(153,170,204,.10)" };
}

function ActivityChip({ icon: Icon, count, label, color }: { icon: any; count: number; label: string; color: string }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5 }} title={`${label}: ${count}`}>
      <Icon size={12} color={color} strokeWidth={2.3}/>
      <span style={{ fontSize:10, fontWeight:800, color:T3 }}>{count}</span>
    </div>
  );
}

function TeacherCard({ teacher, onClick, isMobile = false }: { teacher: any; onClick: () => void; isMobile?: boolean }) {
  const tr = tierFromScore(teacher.overall);
  return (
    <div
      onClick={onClick}
      className="dash-card"
      style={{
        background:"#fff", border:"0.5px solid rgba(0,85,255,.08)", borderRadius: isMobile ? 14 : 18,
        padding: isMobile ? "14px 14px" : "16px 18px", cursor:"pointer", boxShadow:SHADOW_SM,
      }}
    >
      <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, marginBottom: isMobile ? 10 : 12 }}>
        <div style={{
          width: isMobile ? 36 : 40, height: isMobile ? 36 : 40, borderRadius: isMobile ? 11 : 12, background:tr.solidGrad,
          display:"flex", alignItems:"center", justifyContent:"center",
          color:"#fff", fontSize:11, fontWeight:800,
          boxShadow:`0 6px 14px ${tr.color}33`, flexShrink:0,
        }}>
          {initials(teacher.name)}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <p style={{ fontSize:13, fontWeight:800, color:T1, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", letterSpacing:"-0.2px" }}>{teacher.name}</p>
          <p style={{ fontSize:10, fontWeight:700, color:T4, margin:"2px 0 0 0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{teacher.subject || "—"}</p>
        </div>
        <span style={{
          fontSize:9, fontWeight:800, padding:"3px 9px", borderRadius:999,
          background:tr.bg, color:tr.color, flexShrink:0,
          letterSpacing:"0.10em", textTransform:"uppercase",
        }}>
          {tr.label}
        </span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:6, textAlign:"center", padding: isMobile ? "8px 0" : "10px 0", borderTop:"0.5px solid rgba(0,85,255,.08)", borderBottom:"0.5px solid rgba(0,85,255,.08)", marginBottom: isMobile ? 8 : 10 }}>
        <div>
          <p style={{ fontSize:8, fontWeight:800, color:T4, letterSpacing:"0.12em", textTransform:"uppercase", margin:"0 0 2px 0" }}>Overall</p>
          <p style={{ fontSize:13, fontWeight:800, color:tr.color, margin:0 }}>{teacher.overall > 0 ? `${teacher.overall}%` : "—"}</p>
        </div>
        <div>
          <p style={{ fontSize:8, fontWeight:800, color:T4, letterSpacing:"0.12em", textTransform:"uppercase", margin:"0 0 2px 0" }}>Score</p>
          <p style={{ fontSize:13, fontWeight:800, color:T1, margin:0 }}>{teacher.avgScore > 0 ? `${teacher.avgScore}%` : "—"}</p>
        </div>
        <div>
          <p style={{ fontSize:8, fontWeight:800, color:T4, letterSpacing:"0.12em", textTransform:"uppercase", margin:"0 0 2px 0" }}>Classes</p>
          <p style={{ fontSize:13, fontWeight:800, color:T1, margin:0 }}>{teacher.classCount}</p>
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", background:"#F5F9FF", borderRadius:10, padding: isMobile ? "6px 8px" : "6px 10px", gap:4 }}>
        <ActivityChip icon={ClipboardCheck} count={teacher.attMarkCount} label="Attendance Days" color={B1}/>
        <ActivityChip icon={FileText}       count={teacher.assignCount}  label="Assignments" color={ORANGE}/>
        <ActivityChip icon={Activity}       count={teacher.testCount}    label="Tests" color={VIOLET}/>
        <ActivityChip icon={BookOpen}       count={teacher.lessonCount}  label="Lessons" color={GREEN}/>
        <ActivityChip icon={MessageSquare}  count={teacher.noteCount}    label="Notes" color={GOLD}/>
        <ActivityChip icon={BarChart3}      count={teacher.reportCount}  label="Reports" color="#0EA5E9"/>
      </div>
    </div>
  );
}

function TopCard({ teacher, rank, onClick, isMobile = false }: { teacher: any; rank: number; onClick: () => void; isMobile?: boolean }) {
  const medalGrad =
    rank === 1 ? "linear-gradient(135deg,#FFD700,#FFAA00)" :
    rank === 2 ? "linear-gradient(135deg,#C0C0C0,#808080)" :
    rank === 3 ? "linear-gradient(135deg,#CD7F32,#8B4513)" :
                 GRAD_GREEN;
  return (
    <div
      onClick={onClick}
      className="dash-card"
      style={{
        background:"#fff", border:"0.5px solid rgba(0,200,83,.18)", borderRadius: isMobile ? 16 : 20,
        padding: isMobile ? "16px 16px" : "20px 22px", cursor:"pointer", boxShadow:SHADOW_SM,
        position:"relative", overflow:"hidden",
      }}
    >
      <div style={{ position:"absolute", top:-30, right:-30, width:120, height:120, background:"radial-gradient(circle, rgba(0,200,83,.14) 0%, transparent 70%)", borderRadius:"50%", pointerEvents:"none" }}/>
      <div style={{ position:"relative", zIndex:1 }}>
        <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, marginBottom: isMobile ? 12 : 14 }}>
          <div style={{
            width: isMobile ? 38 : 44, height: isMobile ? 38 : 44, borderRadius: isMobile ? 11 : 13, background:"linear-gradient(135deg,#10B981 0%,#059669 100%)",
            display:"flex", alignItems:"center", justifyContent:"center",
            color:"#fff", fontSize:12, fontWeight:800,
            boxShadow:"0 6px 14px rgba(16,185,129,.28)", flexShrink:0,
          }}>
            {initials(teacher.name)}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontSize: isMobile ? 13 : 14, fontWeight:800, color:T1, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", letterSpacing:"-0.2px" }}>{teacher.name}</p>
            <p style={{ fontSize:10, fontWeight:700, color:T4, margin:"2px 0 0 0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{teacher.subject || "—"} · {teacher.branchName}</p>
          </div>
          <div style={{
            width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: isMobile ? 10 : 11, background:medalGrad,
            display:"flex", alignItems:"center", justifyContent:"center",
            boxShadow:"0 6px 14px rgba(0,0,0,.22)", flexShrink:0,
          }}>
            <Medal size={isMobile ? 14 : 16} color="#fff" strokeWidth={2.3}/>
          </div>
        </div>

        {teacher.reasons.length > 0 && (
          <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom: isMobile ? 12 : 14 }}>
            {teacher.reasons.map((r: string) => (
              <span key={r} style={{
                fontSize:9, fontWeight:800, padding:"3px 8px", borderRadius:999,
                background:"rgba(0,200,83,.10)", color:GREEN,
                letterSpacing:"0.10em", textTransform:"uppercase",
              }}>
                {r}
              </span>
            ))}
          </div>
        )}

        <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:8, marginBottom: isMobile ? 10 : 12 }}>
          <div style={{ textAlign:"center", background:"rgba(0,200,83,.10)", borderRadius:12, padding: isMobile ? "7px 6px" : "8px 6px" }}>
            <p style={{ fontSize:9, fontWeight:800, color:GREEN, letterSpacing:"0.12em", textTransform:"uppercase", margin:"0 0 2px 0" }}>Overall</p>
            <p style={{ fontSize: isMobile ? 16 : 18, fontWeight:800, color:GREEN, margin:0 }}>{teacher.overall}%</p>
          </div>
          <div style={{ textAlign:"center", background:"rgba(0,85,255,.08)", borderRadius:12, padding: isMobile ? "7px 6px" : "8px 6px" }}>
            <p style={{ fontSize:9, fontWeight:800, color:B1, letterSpacing:"0.12em", textTransform:"uppercase", margin:"0 0 2px 0" }}>Test Avg</p>
            <p style={{ fontSize: isMobile ? 16 : 18, fontWeight:800, color:B1, margin:0 }}>{teacher.avgScore > 0 ? `${teacher.avgScore}%` : "—"}</p>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap:4, paddingTop:10, borderTop:"0.5px solid rgba(0,85,255,.08)" }}>
          <ActivityChip icon={ClipboardCheck} count={teacher.attMarkCount} label="Attendance Days" color={B1}/>
          <ActivityChip icon={FileText}       count={teacher.assignCount}  label="Assignments" color={ORANGE}/>
          <ActivityChip icon={Activity}       count={teacher.testCount}    label="Tests" color={VIOLET}/>
          <ActivityChip icon={BookOpen}       count={teacher.lessonCount}  label="Lessons" color={GREEN}/>
          <ActivityChip icon={MessageSquare}  count={teacher.noteCount}    label="Notes" color={GOLD}/>
          <ActivityChip icon={BarChart3}      count={teacher.reportCount}  label="Reports" color="#0EA5E9"/>
        </div>
      </div>
    </div>
  );
}

function DefaulterCard({ teacher, onClick, isMobile = false }: { teacher: any; onClick: () => void; isMobile?: boolean }) {
  return (
    <div
      onClick={onClick}
      className="dash-card"
      style={{
        background:"#fff", border:"0.5px solid rgba(255,51,85,.18)", borderRadius: isMobile ? 16 : 20,
        padding: isMobile ? "16px 16px" : "20px 22px", cursor:"pointer", boxShadow:SHADOW_SM,
        position:"relative", overflow:"hidden",
      }}
    >
      <div style={{ position:"absolute", top:-30, right:-30, width:120, height:120, background:"radial-gradient(circle, rgba(255,51,85,.14) 0%, transparent 70%)", borderRadius:"50%", pointerEvents:"none" }}/>
      <div style={{ position:"relative", zIndex:1 }}>
        <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, marginBottom: isMobile ? 12 : 14 }}>
          <div style={{
            width: isMobile ? 38 : 44, height: isMobile ? 38 : 44, borderRadius: isMobile ? 11 : 13, background:"linear-gradient(135deg,#FF3355 0%,#DC2626 100%)",
            display:"flex", alignItems:"center", justifyContent:"center",
            color:"#fff", fontSize:12, fontWeight:800,
            boxShadow:"0 6px 14px rgba(255,51,85,.28)", flexShrink:0,
          }}>
            {initials(teacher.name)}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontSize: isMobile ? 13 : 14, fontWeight:800, color:T1, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", letterSpacing:"-0.2px" }}>{teacher.name}</p>
            <p style={{ fontSize:10, fontWeight:700, color:T4, margin:"2px 0 0 0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{teacher.subject || "—"} · {teacher.branchName}</p>
          </div>
          <div style={{
            width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: isMobile ? 10 : 11, background:"linear-gradient(135deg,#FF3355 0%,#DC2626 100%)",
            display:"flex", alignItems:"center", justifyContent:"center",
            boxShadow:"0 6px 14px rgba(255,51,85,.28)", flexShrink:0,
          }}>
            <AlertTriangle size={isMobile ? 14 : 16} color="#fff" strokeWidth={2.3}/>
          </div>
        </div>

        {teacher.reasons.length > 0 && (
          <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom: isMobile ? 12 : 14 }}>
            {teacher.reasons.map((r: string) => (
              <span key={r} style={{
                fontSize:9, fontWeight:800, padding:"3px 8px", borderRadius:999,
                background:"rgba(255,51,85,.10)", color:RED,
                letterSpacing:"0.10em", textTransform:"uppercase",
              }}>
                {r}
              </span>
            ))}
          </div>
        )}

        <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:8, marginBottom: isMobile ? 10 : 12 }}>
          <div style={{ textAlign:"center", background:"rgba(255,51,85,.10)", borderRadius:12, padding: isMobile ? "7px 6px" : "8px 6px" }}>
            <p style={{ fontSize:9, fontWeight:800, color:RED, letterSpacing:"0.12em", textTransform:"uppercase", margin:"0 0 2px 0" }}>Overall</p>
            <p style={{ fontSize: isMobile ? 16 : 18, fontWeight:800, color:RED, margin:0 }}>{teacher.overall > 0 ? `${teacher.overall}%` : "—"}</p>
          </div>
          <div style={{ textAlign:"center", background:"rgba(255,136,0,.10)", borderRadius:12, padding: isMobile ? "7px 6px" : "8px 6px" }}>
            <p style={{ fontSize:9, fontWeight:800, color:ORANGE, letterSpacing:"0.12em", textTransform:"uppercase", margin:"0 0 2px 0" }}>Test Avg</p>
            <p style={{ fontSize: isMobile ? 16 : 18, fontWeight:800, color:ORANGE, margin:0 }}>{teacher.avgScore > 0 ? `${teacher.avgScore}%` : "—"}</p>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap:4, paddingTop:10, borderTop:"0.5px solid rgba(0,85,255,.08)" }}>
          <ActivityChip icon={ClipboardCheck} count={teacher.attMarkCount} label="Attendance Days" color={B1}/>
          <ActivityChip icon={FileText}       count={teacher.assignCount}  label="Assignments" color={ORANGE}/>
          <ActivityChip icon={Activity}       count={teacher.testCount}    label="Tests" color={VIOLET}/>
          <ActivityChip icon={BookOpen}       count={teacher.lessonCount}  label="Lessons" color={GREEN}/>
          <ActivityChip icon={MessageSquare}  count={teacher.noteCount}    label="Notes" color={GOLD}/>
          <ActivityChip icon={BarChart3}      count={teacher.reportCount}  label="Reports" color="#0EA5E9"/>
        </div>
      </div>
    </div>
  );
}
