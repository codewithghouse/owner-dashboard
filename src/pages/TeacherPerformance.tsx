import { useState, useEffect, useMemo } from "react";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  Search, X, Users, BookOpen, TrendingUp, Loader2,
  Award, ChevronDown, GraduationCap, Sparkles, ArrowUpRight,
  BarChart3, Activity, Target, ChevronRight, ArrowLeft
} from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, Legend, AreaChart, Area
} from "recharts";
import { useParams, useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { tilt3D, tilt3DStyle } from "@/lib/use3DTilt";
import { GRAD_ACCENTS } from "@/lib/dashboardTokens";

/* ── constants ────────────────────────────────────────── */
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ── helpers ──────────────────────────────────────────── */
function initials(name: string) {
  return (name || "?").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function last6Months() {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return MONTH_NAMES[d.getMonth()];
  });
}

/* ══════════════════════════════════════════════════════ */
export default function TeacherPerformance() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  /* ── raw state ────────────────────────────────────── */
  const [loading,     setLoading]     = useState(true);
  const [teachers,    setTeachers]    = useState<any[]>([]);
  const [branchMap,   setBranchMap]   = useState<Map<string, string>>(new Map()); // branchId→name
  const [scoreMap,    setScoreMap]    = useState<Map<string, number[]>>(new Map()); // teacherId→pcts[]
  const [attMap,      setAttMap]      = useState<Map<string, { p: number; t: number }>>(new Map());
  const [classMap,    setClassMap]    = useState<Map<string, any[]>>(new Map()); // teacherId→classes[]
  // monthly aggregates for overview chart
  const [monthlyAgg,  setMonthlyAgg]  = useState<{ month: string; performance: number; attendance: number }[]>([]);

  /* ── UI state ─────────────────────────────────────── */
  const [search,       setSearch]       = useState("");
  const [branchFilter, setBranchFilter] = useState("All");

  /* ── teacher detail extra data ────────────────────── */
  const [detailLoading,    setDetailLoading]    = useState(false);
  const [detailTimeline,   setDetailTimeline]   = useState<{ month: string; score: number }[]>([]);
  const [detailVsBranch,   setDetailVsBranch]   = useState<{ category: string; teacher: number; branchAvg: number }[]>([]);
  const [detailClasses,    setDetailClasses]    = useState<any[]>([]);
  const [detailStudents,   setDetailStudents]   = useState(0);
  const [detailAttPct,     setDetailAttPct]     = useState<number | null>(null);

  /* ── fetch all overview data once ────────────────── */
  useEffect(() => {
    const load = async () => {
      try {
        const ownerUid = auth.currentUser?.uid;
        if (!ownerUid) { setLoading(false); return; }

        /* 1. branches subcollection */
        const bMap = new Map<string, string>();
        const bSnap = await getDocs(collection(db, "schools", ownerUid, "branches"));
        bSnap.docs.forEach(d => {
          const data = d.data() as any;
          const bid  = data.branchId || d.id;
          const bn   = data.name || data.branchName || "";
          if (bid && bn) bMap.set(bid, bn);
        });
        setBranchMap(bMap);

        /* 2. teachers — scoped to this school */
        const tSnap = await getDocs(
          query(collection(db, "teachers"), where("schoolId", "==", ownerUid))
        );
        const rawTeachers = tSnap.docs.map((d) => ({
          _docId: d.id,
          ...d.data() as any,
        }));
        setTeachers(rawTeachers);

        /* 3. test_scores → teacherId → percentage[] — scoped */
        const scSnap = await getDocs(
          query(collection(db, "test_scores"), where("schoolId", "==", ownerUid))
        );
        const sMap = new Map<string, number[]>();
        // for monthly overview
        const monthScoreMap = new Map<string, number[]>(); // month → scores[]
        scSnap.docs.forEach(d => {
          const data = d.data() as any;
          const tid  = data.teacherId || "";
          const pct  = parseFloat(data.percentage ?? data.score ?? "");
          if (tid && !isNaN(pct)) {
            if (!sMap.has(tid)) sMap.set(tid, []);
            sMap.get(tid)!.push(pct);
          }
          // monthly
          const ts = data.timestamp?.toDate?.();
          if (ts && !isNaN(pct)) {
            const mk = MONTH_NAMES[ts.getMonth()];
            if (!monthScoreMap.has(mk)) monthScoreMap.set(mk, []);
            monthScoreMap.get(mk)!.push(pct);
          }
        });
        setScoreMap(sMap);

        /* 4. attendance → teacherId → {p,t} — scoped */
        const attSnap = await getDocs(
          query(collection(db, "attendance"), where("schoolId", "==", ownerUid))
        );
        const aMap = new Map<string, { p: number; t: number }>();
        const monthAttMap = new Map<string, { p: number; t: number }>();
        attSnap.docs.forEach(d => {
          const data = d.data() as any;
          const tid  = data.teacherId || "";
          const isPresent = (data.status || "").toLowerCase() === "present";
          if (tid) {
            if (!aMap.has(tid)) aMap.set(tid, { p: 0, t: 0 });
            const cur = aMap.get(tid)!;
            cur.t++;
            if (isPresent) cur.p++;
          }
          // monthly
          let date: Date | null = null;
          if (data.timestamp?.toDate) date = data.timestamp.toDate();
          else if (typeof data.date === "string" && data.date) date = new Date(data.date + "T00:00:00");
          if (date && !isNaN(date.getTime())) {
            const mk = MONTH_NAMES[date.getMonth()];
            if (!monthAttMap.has(mk)) monthAttMap.set(mk, { p: 0, t: 0 });
            const mc = monthAttMap.get(mk)!;
            mc.t++;
            if (isPresent) mc.p++;
          }
        });
        setAttMap(aMap);

        /* 5. classes → teacherId → classes[] — scoped */
        const clSnap = await getDocs(
          query(collection(db, "classes"), where("schoolId", "==", ownerUid))
        );
        const cMap = new Map<string, any[]>();
        clSnap.docs.forEach(d => {
          const data = d.data() as any;
          const tid  = data.teacherId || "";
          if (tid) {
            if (!cMap.has(tid)) cMap.set(tid, []);
            cMap.get(tid)!.push({ id: d.id, ...data });
          }
        });
        setClassMap(cMap);

        /* 6. monthly aggregates for overview chart */
        const months = last6Months();
        const monthly = months.map(m => {
          const sc = monthScoreMap.get(m);
          const at = monthAttMap.get(m);
          return {
            month: m,
            performance: sc ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : 0,
            attendance:  at && at.t > 0 ? Math.round((at.p / at.t) * 100) : 0,
          };
        });
        setMonthlyAgg(monthly);

      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    };
    load();
  }, []);

  /* ── enrich teachers with computed metrics ────────── */
  const enriched = useMemo(() => {
    return teachers.map(t => {
      const tid      = t._docId;
      const scores   = scoreMap.get(tid) || [];
      const att      = attMap.get(tid);
      const classes  = classMap.get(tid) || [];
      const avgScore = scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;
      const attPct   = att && att.t > 0 ? Math.round((att.p / att.t) * 100) : 0;
      const branchName = branchMap.get(t.branchId || "") || t.branch || "—";
      return {
        ...t,
        id:         tid,
        branchName,
        avgScore,
        attPct,
        classCount: classes.length,
      };
    });
  }, [teachers, scoreMap, attMap, classMap, branchMap]);

  /* ── branch list ──────────────────────────────────── */
  const branchList = useMemo(() =>
    ["All", ...[...branchMap.values()].sort()],
  [branchMap]);

  /* ── filtered teacher list ────────────────────────── */
  const filtered = useMemo(() =>
    enriched.filter(t =>
      (t.name || "").toLowerCase().includes(search.toLowerCase()) &&
      (branchFilter === "All" || t.branchName === branchFilter)
    ),
  [enriched, search, branchFilter]);

  /* ── stat cards ───────────────────────────────────── */
  const totalTeachers   = filtered.length;
  const avgEffectiveness = useMemo(() => {
    const withScore = filtered.filter(t => t.avgScore > 0);
    return withScore.length
      ? (withScore.reduce((a, t) => a + t.avgScore, 0) / withScore.length).toFixed(1)
      : "—";
  }, [filtered]);
  const topPerformers    = filtered.filter(t => t.avgScore >= 80).length;
  const needsImprovement = filtered.filter(t => t.avgScore > 0 && t.avgScore < 60).length;

  /* ── performance distribution pie ────────────────── */
  const perfDist = useMemo(() => {
    let excellent = 0, good = 0, average = 0, needsWork = 0;
    filtered.forEach(t => {
      if (t.avgScore >= 80) excellent++;
      else if (t.avgScore >= 60) good++;
      else if (t.avgScore >= 40) average++;
      else if (t.avgScore > 0) needsWork++;
    });
    return [
      { name: "Excellent",   value: excellent,   fill: "#22c55e" },
      { name: "Good",        value: good,        fill: "#3b82f6" },
      { name: "Average",     value: average,     fill: "#f59e0b" },
      { name: "Needs Work",  value: needsWork,   fill: "#ef4444" },
    ].filter(d => d.value > 0);
  }, [filtered]);

  /* ── subject-wise avg score ───────────────────────── */
  const subjectRatings = useMemo(() => {
    const map: Record<string, number[]> = {};
    filtered.forEach(t => {
      if (!t.subject || !t.avgScore) return;
      if (!map[t.subject]) map[t.subject] = [];
      map[t.subject].push(t.avgScore);
    });
    return Object.entries(map)
      .map(([subject, scores]) => ({
        subject,
        rating: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      }))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 7);
  }, [filtered]);

  /* ══════════════════════════════════════════════════ */
  /* ── TEACHER DETAIL: fetch when id changes ─────── */
  const selectedTeacher = useMemo(
    () => enriched.find(t => t.id === id) || null,
    [enriched, id]
  );

  useEffect(() => {
    if (!id || !selectedTeacher) return;
    setDetailLoading(true);
    setDetailTimeline([]);
    setDetailVsBranch([]);
    setDetailClasses([]);
    setDetailStudents(0);
    setDetailAttPct(null);

    const fetchDetail = async () => {
      try {
        const ownerUid = auth.currentUser?.uid;
        if (!ownerUid) { setDetailLoading(false); return; }

        /* a. test_scores for this teacher — scoped */
        const scSnap = await getDocs(
          query(
            collection(db, "test_scores"),
            where("schoolId", "==", ownerUid),
            where("teacherId", "==", id),
          )
        );
        const tScores = scSnap.docs.map(d => d.data() as any);

        // monthly performance timeline
        const byMonth = new Map<string, number[]>();
        tScores.forEach(d => {
          const ts  = d.timestamp?.toDate?.();
          const pct = parseFloat(d.percentage ?? d.score ?? "");
          if (ts && !isNaN(pct)) {
            const mk = MONTH_NAMES[ts.getMonth()];
            if (!byMonth.has(mk)) byMonth.set(mk, []);
            byMonth.get(mk)!.push(pct);
          }
        });
        const timeline = last6Months().map(m => {
          const sc = byMonth.get(m);
          return { month: m, score: sc ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : 0 };
        });
        setDetailTimeline(timeline);

        /* b. attendance for this teacher — scoped */
        const attSnap = await getDocs(
          query(
            collection(db, "attendance"),
            where("schoolId", "==", ownerUid),
            where("teacherId", "==", id),
          )
        );
        const attDocs = attSnap.docs.map(d => d.data() as any);
        const attP = attDocs.filter(d => (d.status || "").toLowerCase() === "present").length;
        const attT = attDocs.length;
        const tAttPct = attT > 0 ? Math.round((attP / attT) * 100) : null;
        setDetailAttPct(tAttPct);

        /* c. classes for this teacher — scoped */
        const clSnap = await getDocs(
          query(
            collection(db, "classes"),
            where("schoolId", "==", ownerUid),
            where("teacherId", "==", id),
          )
        );
        const tClasses = clSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
        setDetailClasses(tClasses);

        /* d. students taught: enrollments in those classes — scoped */
        let studentCount = 0;
        if (tClasses.length > 0) {
          const classIds = tClasses.map(c => c.id).slice(0, 10);
          const enSnap = await getDocs(
            query(
              collection(db, "enrollments"),
              where("schoolId", "==", ownerUid),
              where("classId", "in", classIds),
            )
          );
          studentCount = enSnap.size;
        }
        setDetailStudents(studentCount);

        /* e. vs branch avg — compare teacher avg score & att vs branch teachers */
        const branchId = selectedTeacher.branchId || "";
        const branchTeacherIds = enriched
          .filter(t => t.branchId === branchId && t.id !== id)
          .map(t => t.id);

        const tAvgScore = tScores.length
          ? tScores.reduce((a, d) => a + (parseFloat(d.percentage ?? d.score ?? "0") || 0), 0) / tScores.length
          : 0;

        const branchScores = enriched
          .filter(t => t.branchId === branchId && t.id !== id && t.avgScore > 0)
          .map(t => t.avgScore);
        const branchAvgScore = branchScores.length
          ? branchScores.reduce((a, b) => a + b, 0) / branchScores.length
          : tAvgScore;

        const branchAttScores = enriched
          .filter(t => t.branchId === branchId && t.id !== id && t.attPct > 0)
          .map(t => t.attPct);
        const branchAvgAtt = branchAttScores.length
          ? branchAttScores.reduce((a, b) => a + b, 0) / branchAttScores.length
          : tAttPct ?? 0;

        const tPassRate = tScores.length
          ? Math.round(tScores.filter(d => (parseFloat(d.percentage ?? d.score ?? "0") || 0) >= 60).length / tScores.length * 100)
          : 0;
        const branchPassRates = enriched
          .filter(t => t.branchId === branchId && t.id !== id && t.avgScore > 0)
          .map(t => t.avgScore >= 60 ? 100 : t.avgScore);
        const branchAvgPass = branchPassRates.length
          ? branchPassRates.reduce((a, b) => a + b, 0) / branchPassRates.length
          : tPassRate;

        setDetailVsBranch([
          { category: "Avg Score",   teacher: Math.round(tAvgScore),  branchAvg: Math.round(branchAvgScore)  },
          { category: "Attendance",  teacher: tAttPct ?? 0,           branchAvg: Math.round(branchAvgAtt)   },
          { category: "Pass Rate",   teacher: tPassRate,              branchAvg: Math.round(branchAvgPass)  },
          { category: "Classes",     teacher: tClasses.length,        branchAvg: Math.round(branchTeacherIds.length > 0 ? enriched.filter(t => t.branchId === branchId).reduce((a, t) => a + t.classCount, 0) / enriched.filter(t => t.branchId === branchId).length : tClasses.length) },
        ]);

      } catch (e) {
        console.error(e);
      }
      setDetailLoading(false);
    };

    fetchDetail();
  }, [id, selectedTeacher?.id]);

  /* ─── Design tokens (principal/owner dashboard system) ─── */
  const B1 = "#0055FF", B2 = "#1166FF";
  const T1 = "#001040", T3 = "#5070B0", T4 = "#99AACC";
  const GREEN = "#00C853", RED = "#FF3355", GOLD = "#FFAA00", VIOLET = "#7B3FF4";
  const GRAD_PRIMARY = `linear-gradient(135deg, ${B1}, ${B2})`;
  const GRAD_HERO = "linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)";
  const GRAD_BLUE   = "linear-gradient(135deg,#F7FAFF 0%,#EEF3FF 100%)";
  const GRAD_GREEN  = "linear-gradient(135deg,#F5FCF8 0%,#E9F8EF 100%)";
  const GRAD_VIOLET = "linear-gradient(135deg,#FAF7FF 0%,#F2EBFF 100%)";
  const GRAD_GOLD   = "linear-gradient(135deg,#FFFCF0 0%,#FEF5DC 100%)";
  const GRAD_RED    = "linear-gradient(135deg,#FEF8F9 0%,#FCEAEE 100%)";
  const SHADOW_SM = "0 0 0 .5px rgba(0,85,255,.08), 0 2px 8px rgba(0,85,255,.08), 0 10px 26px rgba(0,85,255,.10)";
  const SHADOW_LG = "0 0 0 .5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.11), 0 18px 44px rgba(0,85,255,.13)";
  const SHADOW_BTN = "0 6px 22px rgba(0,85,255,.40), 0 2px 5px rgba(0,85,255,.20)";

  /* ─── Score tier helper (new design) ─── */
  const tierStyle = (s: number) => {
    if (s >= 80) return { label: "Excellent", grad: GRAD_GREEN, solidGrad: "linear-gradient(135deg,#10B981 0%,#059669 100%)", color: GREEN, bg: "rgba(0,200,83,.10)" };
    if (s >= 60) return { label: "Good", grad: GRAD_BLUE, solidGrad: "linear-gradient(135deg,#0055FF 0%,#1166FF 100%)", color: B1, bg: "rgba(0,85,255,.08)" };
    if (s >= 40) return { label: "Average", grad: GRAD_GOLD, solidGrad: "linear-gradient(135deg,#F59E0B 0%,#D97706 100%)", color: GOLD, bg: "rgba(255,170,0,.10)" };
    if (s > 0) return { label: "Needs Work", grad: GRAD_RED, solidGrad: "linear-gradient(135deg,#FF3355 0%,#DC2626 100%)", color: RED, bg: "rgba(255,51,85,.10)" };
    return { label: "No Data", grad: "linear-gradient(135deg,#99AACC,#5070B0)", solidGrad: "linear-gradient(135deg,#99AACC,#5070B0)", color: T4, bg: "rgba(153,170,204,.10)" };
  };

  const globalStyles = (
    <style>{`
      .tp-btn {
        transition: transform .2s ease, box-shadow .2s ease, background .2s ease;
      }
      .tp-btn:hover {
        transform: translateY(-1px);
      }
      .tp-row {
        transition: transform .3s ease, background .2s ease;
      }
      .tp-row:hover {
        transform: translateX(4px);
        background: rgba(0,85,255,.04) !important;
      }
    `}</style>
  );

  /* ─────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:260, background:"#EEF4FF", minHeight:"100vh", margin: isMobile ? "-12px -12px 0" : "-40px -40px 0" }}>
        <Loader2 className="animate-spin" size={32} color={B1}/>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════ */
  /* ── DETAIL VIEW ─────────────────────────────────── */
  if (id && selectedTeacher) {
    const sl = tierStyle(selectedTeacher.avgScore);
    return (
      <>
        {globalStyles}
        <div
          style={{
            fontFamily:"'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            background:"#EEF4FF", minHeight:"100vh",
            margin: isMobile ? "-12px -12px 0" : "-40px -40px 0",
            padding: isMobile ? "14px 14px 28px" : "24px 32px 40px",
          }}
        >
          {/* ── Back Nav ──────────────────────────────── */}
          <button
            onClick={()=>navigate("/teachers")}
            className="tp-btn"
            style={{
              display:"inline-flex", alignItems:"center", gap:7,
              padding: isMobile ? "7px 12px" : "8px 14px", borderRadius:12,
              background:"#fff", border:"0.5px solid rgba(0,85,255,.12)",
              fontSize: isMobile ? 10 : 11, fontWeight:700, color:T3,
              letterSpacing:"0.06em", textTransform:"uppercase",
              cursor:"pointer", marginBottom: isMobile ? 14 : 18, boxShadow:SHADOW_SM, fontFamily:"inherit",
            }}
          >
            <ArrowLeft size={isMobile ? 12 : 14}/> {isMobile ? "Back" : "Back to Teachers"}
          </button>

          {/* ── Hero Detail Card ──────────────────────── */}
          <div
            {...tilt3D}
            onClick={()=>navigate(`/teachers/profile/${id}`)}
            role="button" tabIndex={0}
            style={{
              background:GRAD_HERO, borderRadius: isMobile ? 18 : 24, padding: isMobile ? "18px 16px" : "24px 28px", color:"#fff",
              marginBottom: isMobile ? 16 : 24, position:"relative", overflow:"hidden",
              boxShadow:"0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)",
              cursor:"pointer",
              ...tilt3DStyle,
            }}
          >
            <div style={{ position:"absolute", top:-60, right:-40, width:280, height:280, background:"radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 65%)", borderRadius:"50%", pointerEvents:"none" }}/>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 14 : 20, flexWrap:"wrap", position:"relative", zIndex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 12 : 16, minWidth:0, flex: isMobile ? "1 1 100%" : undefined }}>
                <div
                  style={{
                    width: isMobile ? 52 : 64, height: isMobile ? 52 : 64, borderRadius: isMobile ? 15 : 18, background:sl.solidGrad,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    color:"#fff", fontSize: isMobile ? 18 : 22, fontWeight:800, flexShrink:0,
                    boxShadow:"0 10px 28px rgba(0,0,0,.26), 0 0 0 2px rgba(255,255,255,.2)",
                  }}
                >
                  {initials(selectedTeacher.name)}
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"3px 10px", borderRadius:999, background:"rgba(255,255,255,.14)", border:"0.5px solid rgba(255,255,255,.22)", fontSize: isMobile ? 8 : 9, fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:8 }}>
                    <Sparkles size={10}/> Teacher Profile
                  </div>
                  <h2 style={{ fontSize: isMobile ? 20 : 30, fontWeight:800, letterSpacing: isMobile ? "-0.4px" : "-0.8px", margin:0, color:"#fff", lineHeight:1.1, whiteSpace: isMobile ? "normal" : "nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                    {selectedTeacher.name}
                  </h2>
                  <p style={{ fontSize: isMobile ? 10 : 12, color:"rgba(255,255,255,.72)", fontWeight:600, margin:"8px 0 0 0", letterSpacing:"0.06em", textTransform:"uppercase" }}>
                    {selectedTeacher.subject || "—"} · {selectedTeacher.branchName}
                  </p>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 6 : 10, flexWrap:"wrap", width: isMobile ? "100%" : "auto" }}>
                <span style={{
                  fontSize: isMobile ? 9 : 10, fontWeight:800, padding: isMobile ? "6px 10px" : "8px 14px", borderRadius:10,
                  background:sl.solidGrad, color:"#fff", letterSpacing:"0.12em", textTransform:"uppercase",
                  boxShadow:"0 4px 12px rgba(0,0,0,.24)",
                }}>
                  {sl.label}
                </span>
                <span style={{
                  fontSize: isMobile ? 9 : 10, fontWeight:800, padding: isMobile ? "6px 10px" : "8px 14px", borderRadius:10,
                  background:selectedTeacher.status === "Active" ? "rgba(0,200,83,.25)" : "rgba(255,255,255,.14)",
                  color:"#fff", letterSpacing:"0.12em", textTransform:"uppercase",
                  border:"0.5px solid rgba(255,255,255,.22)",
                }}>
                  {selectedTeacher.status || "—"}
                </span>
                <button
                  onClick={(e)=>{e.stopPropagation();navigate(`/teachers/profile/${id}`);}}
                  className="tp-btn"
                  style={{
                    padding: isMobile ? "9px 14px" : "10px 18px", borderRadius:12,
                    background:"#fff", color:T1,
                    fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                    border:"none", cursor:"pointer",
                    boxShadow:"0 4px 12px rgba(0,0,0,.18)", fontFamily:"inherit",
                    marginLeft: isMobile ? "auto" : 0,
                  }}
                >
                  Full Profile
                </button>
              </div>
            </div>
          </div>

          {detailLoading ? (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:160 }}>
              <Loader2 className="animate-spin" size={28} color={B1}/>
            </div>
          ) : (
            <>
              {/* ── Bright Stat Grid ─────────────────── */}
              <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 16 : 24, perspective:"1200px" }}>
                {[
                  {
                    label:"Effectiveness Score",
                    value:selectedTeacher.avgScore > 0 ? `${selectedTeacher.avgScore}%` : "—",
                    sub:selectedTeacher.avgScore > 0 ? sl.label : "No exam data",
                    icon:Award, grad:GRAD_BLUE,
                    route:`/teachers/profile/${id}`,
                    delta: selectedTeacher.avgScore >= 70 ? "up" : null,
                  },
                  {
                    label:"Class Attendance",
                    value:detailAttPct !== null ? `${detailAttPct}%` : "—",
                    sub:detailAttPct !== null ? (detailAttPct >= 90 ? "Excellent" : detailAttPct >= 75 ? "Good" : "Needs attention") : "No data",
                    icon:Users, grad:GRAD_GREEN,
                    route:`/teachers/profile/${id}`,
                    delta: detailAttPct !== null && detailAttPct >= 80 ? "up" : null,
                  },
                  {
                    label:"Classes Assigned",
                    value:detailClasses.length.toString(),
                    sub:`${detailClasses.filter(c => c.status === "Active").length} active`,
                    icon:BookOpen, grad:GRAD_VIOLET,
                    route:`/teachers/profile/${id}`,
                    delta:null,
                  },
                  {
                    label:"Students Taught",
                    value:detailStudents > 0 ? detailStudents.toString() : (selectedTeacher.classCount > 0 ? "—" : "0"),
                    sub:"Across all classes",
                    icon:GraduationCap, grad:GRAD_GOLD,
                    route:`/students`,
                    delta:null,
                  },
                ].map(s=>{
                  const Icon = s.icon;
                  const accent = GRAD_ACCENTS[s.grad] || "#4F46E5";
                  return (
                    <div
                      key={s.label}
                      onClick={()=>navigate(s.route)}
                      role="button" tabIndex={0}
                      {...tilt3D}
                      style={{
                        background:s.grad, borderRadius: isMobile ? 16 : 22, padding: isMobile ? "14px 14px" : "20px 22px",
                        cursor:"pointer", position:"relative", overflow:"hidden",
                        boxShadow:"0 4px 8px rgba(0,85,255,.12), 0 12px 24px rgba(0,85,255,.16), 0 28px 56px rgba(0,85,255,.18)",
                        ...tilt3DStyle,
                      }}
                    >
                      {/* Decorative faded icon — bottom-right */}
                      <div style={{ position:"absolute", bottom: isMobile ? 8 : 12, right: isMobile ? 10 : 16, color: accent, opacity: 0.22, pointerEvents:"none", lineHeight: 0 }}>
                        <Icon size={isMobile ? 48 : 64} strokeWidth={2}/>
                      </div>
                      {/* Solid icon badge — top-left */}
                      <div style={{ width: isMobile ? 36 : 44, height: isMobile ? 36 : 44, borderRadius: isMobile ? 10 : 12, display:"flex", alignItems:"center", justifyContent:"center", background: accent, marginBottom: isMobile ? 10 : 14, boxShadow: `0 4px 12px ${accent}33`, position:"relative", zIndex:1 }}>
                        <Icon size={isMobile ? 18 : 20} color="#FFFFFF" strokeWidth={2.5}/>
                      </div>
                      {s.delta && (
                        <div style={{ position:"absolute", top: isMobile ? 14 : 20, right: isMobile ? 14 : 20, display:"inline-flex", alignItems:"center", gap:3, padding:"4px 8px", borderRadius:8, background: `${accent}1A`, zIndex:1 }}>
                          <ArrowUpRight size={11} color={accent}/>
                        </div>
                      )}
                      <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:700, color:"#94A3B8", letterSpacing:"0.10em", textTransform:"uppercase", margin:"0 0 6px 0", position:"relative", zIndex:1 }}>{s.label}</p>
                      <p style={{ fontSize: isMobile ? 22 : 30, fontWeight:800, color:"#0F172A", letterSpacing:"-0.6px", margin:0, lineHeight:1.1, position:"relative", zIndex:1 }}>{s.value}</p>
                      <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:"#64748B", margin:"6px 0 0 0", position:"relative", zIndex:1 }}>{s.sub}</p>
                    </div>
                  );
                })}
              </div>

              {/* ── Charts Row (2-col) ───────────────── */}
              <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: isMobile ? 12 : 16, marginBottom: isMobile ? 16 : 24, perspective:"1200px" }}>

                {/* Performance Timeline */}
                <div
                  {...tilt3D}
                  onClick={()=>navigate(`/teachers/profile/${id}`)}
                  role="button" tabIndex={0}
                  style={{
                    background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px" : "22px 24px",
                    boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
                    cursor:"pointer",
                    ...tilt3DStyle,
                  }}
                >
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                    <div>
                      <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Performance Timeline</h3>
                      <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Last 6 months</p>
                    </div>
                    <div style={{ width:34, height:34, borderRadius:11, background:"rgba(0,85,255,.08)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <Activity size={17} color={B1} strokeWidth={2.3}/>
                    </div>
                  </div>
                  {detailTimeline.every(d => d.score === 0) ? (
                    <div style={{ height: isMobile ? 180 : 220, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:T4 }}>No exam data yet</div>
                  ) : (
                    <div style={{ height: isMobile ? 190 : 220 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={detailTimeline} margin={{ left:-20, right:10, top:5 }}>
                          <defs>
                            <linearGradient id="tpTlGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor={B1} stopOpacity={0.22}/>
                              <stop offset="95%" stopColor={B1} stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill:T3, fontSize:11, fontWeight:600 }} dy={8}/>
                          <YAxis axisLine={false} tickLine={false} tick={{ fill:T3, fontSize:11, fontWeight:600 }} domain={[0, 100]}/>
                          <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }}/>
                          <Area type="monotone" dataKey="score" name="Avg Score" stroke={B1} strokeWidth={3}
                            fill="url(#tpTlGrad)" dot={{ r:4, fill:B1, strokeWidth:2, stroke:"#fff" }} activeDot={{r:6}} connectNulls={false}/>
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* vs Branch Average */}
                <div
                  {...tilt3D}
                  onClick={()=>navigate(selectedTeacher?.branchId ? `/branches/${selectedTeacher.branchId}` : "/branches")}
                  role="button" tabIndex={0}
                  style={{
                    background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px" : "22px 24px",
                    boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
                    cursor:"pointer",
                    ...tilt3DStyle,
                  }}
                >
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                    <div>
                      <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>vs Branch Average</h3>
                      <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>{selectedTeacher.branchName}</p>
                    </div>
                    <div style={{ width:34, height:34, borderRadius:11, background:"rgba(123,63,244,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <Target size={17} color={VIOLET} strokeWidth={2.3}/>
                    </div>
                  </div>
                  {detailVsBranch.length === 0 ? (
                    <div style={{ height: isMobile ? 180 : 220, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:T4 }}>No comparison data</div>
                  ) : (
                    <div style={{ height: isMobile ? 200 : 220 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={detailVsBranch} margin={{ left:-20, right:10, bottom:10 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                          <XAxis dataKey="category" axisLine={false} tickLine={false} tick={{ fill:T3, fontSize:11, fontWeight:600 }} dy={8}/>
                          <YAxis axisLine={false} tickLine={false} tick={{ fill:T3, fontSize:11, fontWeight:600 }}/>
                          <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }} cursor={{ fill:"rgba(0,85,255,.04)" }}/>
                          <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize:11, fontWeight:700, paddingTop:8 }}/>
                          <Bar dataKey="teacher"   name="This Teacher" fill={B1} radius={[6,6,0,0]} barSize={20}/>
                          <Bar dataKey="branchAvg" name="Branch Avg"   fill={T4} radius={[6,6,0,0]} barSize={20} opacity={0.65}/>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Current Classes ──────────────────── */}
              <div
                {...tilt3D}
                onClick={()=>navigate(`/teachers/profile/${id}`)}
                role="button" tabIndex={0}
                style={{
                  background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px" : "22px 24px",
                  boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
                  marginBottom: isMobile ? 16 : 24, perspective:"1200px",
                  cursor:"pointer",
                  ...tilt3DStyle,
                }}
              >
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 12 : 16 }}>
                  <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12 }}>
                    <div style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius:11, background:GRAD_PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 6px 14px rgba(0,85,255,.28)" }}>
                      <BookOpen size={isMobile ? 16 : 18} color="#fff" strokeWidth={2.3}/>
                    </div>
                    <div>
                      <h3 style={{ fontSize: isMobile ? 13 : 15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Current Classes</h3>
                      <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>{detailClasses.length} total</p>
                    </div>
                  </div>
                </div>
                {detailClasses.length === 0 ? (
                  <p style={{ padding:"30px 0", textAlign:"center", fontSize:12, fontWeight:700, color:T4, letterSpacing:"0.08em" }}>No classes assigned yet</p>
                ) : (
                  <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 10 : 14 }}>
                    {detailClasses.map(cls => (
                      <div key={cls.id}
                        {...tilt3D}
                        onClick={(e)=>{e.stopPropagation();navigate(`/teachers/profile/${id}`);}}
                        role="button" tabIndex={0}
                        style={{
                          background:"#F5F9FF", borderRadius: isMobile ? 14 : 16, padding: isMobile ? "13px 14px" : "16px 18px",
                          border:"0.5px solid rgba(0,85,255,.1)", cursor:"pointer",
                          ...tilt3DStyle,
                        }}
                      >
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:10 }}>
                          <h4 style={{ fontSize: isMobile ? 13 : 14, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.2px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", minWidth:0 }}>{cls.name}</h4>
                          <span style={{
                            fontSize:9, fontWeight:800, padding:"3px 9px", borderRadius:999, flexShrink:0,
                            background: cls.status === "Active" ? "rgba(0,200,83,.12)" : "rgba(153,170,204,.16)",
                            color: cls.status === "Active" ? GREEN : T4,
                            letterSpacing:"0.10em", textTransform:"uppercase",
                          }}>{cls.status || "Active"}</span>
                        </div>
                        <p style={{ fontSize:10, fontWeight:700, color:T3, margin:0, letterSpacing:"0.08em", textTransform:"uppercase" }}>
                          {cls.grade || "—"}{cls.section ? ` · ${cls.section}` : ""}{cls.subject ? ` · ${cls.subject}` : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  /* ══════════════════════════════════════════════════ */
  /* ── LIST / OVERVIEW VIEW ────────────────────────── */
  return (
    <>
      {globalStyles}
      <div
        style={{
          fontFamily:"'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background:"#EEF4FF", minHeight:"100vh",
          margin: isMobile ? "-12px -12px 0" : "-40px -40px 0",
          padding: isMobile ? "16px 14px 28px" : "24px 32px 40px",
        }}
      >
        {/* ── Page Head ─────────────────────────────── */}
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap: isMobile ? 12 : 20, marginBottom: isMobile ? 16 : 22, flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 14, minWidth:0, flex: isMobile ? "1 1 auto" : undefined }}>
            <div style={{ width: isMobile ? 40 : 48, height: isMobile ? 40 : 48, borderRadius: isMobile ? 12 : 14, background:GRAD_PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 8px 22px rgba(0,85,255,.35)", flexShrink:0 }}>
              <Award size={isMobile ? 20 : 24} color="#fff" strokeWidth={2.2}/>
            </div>
            <div style={{ minWidth:0 }}>
              <h1 style={{ fontSize: isMobile ? 20 : 28, fontWeight:700, color:T1, letterSpacing: isMobile ? "-0.4px" : "-0.6px", margin:0, lineHeight:1.15 }}>
                Teacher Performance
              </h1>
              <p style={{ fontSize: isMobile ? 12 : 14, color:T3, fontWeight:500, margin:"4px 0 0 0", letterSpacing:0 }}>
                Effectiveness metrics &amp; evaluation analytics
              </p>
            </div>
          </div>
          <div style={{ position:"relative", width: isMobile ? "100%" : "auto" }}>
            <select
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value)}
              style={{
                appearance:"none", padding: isMobile ? "10px 36px 10px 14px" : "11px 40px 11px 16px",
                borderRadius: isMobile ? 12 : 14, border:"0.5px solid rgba(0,85,255,.12)",
                background:"#fff", boxShadow:SHADOW_SM,
                fontSize:12, fontWeight:700, color:T3, letterSpacing:"0.04em",
                outline:"none", fontFamily:"inherit", cursor:"pointer",
                width: isMobile ? "100%" : "auto", minWidth: isMobile ? 0 : 160,
              }}
            >
              {branchList.map(b => <option key={b} value={b}>{b === "All" ? "All Branches" : b}</option>)}
            </select>
            <ChevronDown size={14} color={T4} style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}/>
          </div>
        </div>

        {/* ── Dark Hero Banner ───────────────────────── */}
        <div
          {...tilt3D}
          onClick={()=>navigate("/teachers")}
          role="button" tabIndex={0}
          style={{
            background:GRAD_HERO, borderRadius: isMobile ? 18 : 24, padding: isMobile ? "18px 18px" : "24px 28px", color:"#fff",
            marginBottom: isMobile ? 16 : 24, position:"relative", overflow:"hidden",
            boxShadow:"0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)",
            cursor:"pointer",
            ...tilt3DStyle,
          }}
        >
          <div style={{ position:"absolute", top:-60, right:-40, width:280, height:280, background:"radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 65%)", borderRadius:"50%", pointerEvents:"none" }}/>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap: isMobile ? 14 : 24, flexWrap:"wrap", position:"relative", zIndex:1 }}>
            <div style={{ display:"flex", alignItems:"flex-start", gap: isMobile ? 12 : 16, flex:1, minWidth: isMobile ? 0 : 300 }}>
              <div style={{ width: isMobile ? 42 : 52, height: isMobile ? 42 : 52, borderRadius: isMobile ? 12 : 15, background:"rgba(255,255,255,.16)", border:"0.5px solid rgba(255,255,255,.26)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <Award size={isMobile ? 20 : 26} color="#fff" strokeWidth={2.2}/>
              </div>
              <div style={{ minWidth:0 }}>
                <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 10px", borderRadius:999, background:"rgba(255,255,255,.14)", border:"0.5px solid rgba(255,255,255,.22)", fontSize: isMobile ? 9 : 10, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:10 }}>
                  <Sparkles size={11}/> Teacher Intelligence
                </div>
                <h2 style={{ fontSize: isMobile ? 28 : 38, fontWeight:800, letterSpacing: isMobile ? "-0.6px" : "-1px", margin:0, color:"#fff", lineHeight:1 }}>
                  {avgEffectiveness}{typeof avgEffectiveness === "string" && avgEffectiveness !== "—" ? "%" : ""}
                </h2>
                <p style={{ fontSize: isMobile ? 11 : 13, color:"rgba(255,255,255,.72)", fontWeight:500, margin:"8px 0 0 0" }}>
                  Average effectiveness across {totalTeachers} teachers · {branchFilter === "All" ? "all branches" : branchFilter}
                </p>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(3, minmax(120px,1fr))", gap: isMobile ? 8 : 10, width: isMobile ? "100%" : "auto" }}>
              {[
                { label:"Total Teachers",     value:totalTeachers.toString(), route:"/teachers-directory" },
                { label:"Top Performers",     value:topPerformers.toString(), route:"/teacher-leaderboard" },
                { label:"Needs Improvement",  value:needsImprovement.toString(), route:"/teachers-directory" },
              ].map(s=>(
                <div
                  key={s.label}
                  onClick={(e)=>{ e.stopPropagation(); navigate(s.route); }}
                  role="button" tabIndex={0}
                  style={{ background:"rgba(255,255,255,.10)", borderRadius: isMobile ? 12 : 14, padding: isMobile ? "10px 10px" : "12px 14px", border:"0.5px solid rgba(255,255,255,.14)", cursor:"pointer" }}
                >
                  <p style={{ fontSize: isMobile ? 8 : 9, fontWeight:700, color:"rgba(255,255,255,.65)", letterSpacing:"0.10em", textTransform:"uppercase", margin:"0 0 6px 0" }}>{s.label}</p>
                  <p style={{ fontSize: isMobile ? 16 : 20, fontWeight:800, color:"#fff", margin:0, letterSpacing:"-0.4px" }}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Bright Stat Grid ───────────────────────── */}
        <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 16 : 24, perspective:"1200px" }}>
          {[
            { label:"Total Teachers", value:totalTeachers.toString(), sub:`In ${branchFilter === "All" ? "all branches" : branchFilter}`, grad:GRAD_BLUE, icon:Users, route:"/teachers-directory" },
            { label:"Avg Effectiveness", value:`${avgEffectiveness}${typeof avgEffectiveness === "string" && avgEffectiveness !== "—" ? "%" : ""}`, sub:"Across all exams", grad:GRAD_GREEN, icon:Award, route:"/teachers" },
            { label:"Top Performers", value:topPerformers.toString(), sub:`${totalTeachers > 0 ? ((topPerformers/totalTeachers)*100).toFixed(1) : 0}% of staff`, grad:GRAD_VIOLET, icon:Sparkles, route:"/teachers-directory" },
            { label:"Needs Improvement", value:needsImprovement.toString(), sub:`${totalTeachers > 0 ? ((needsImprovement/totalTeachers)*100).toFixed(1) : 0}% of staff`, grad:needsImprovement > 0 ? GRAD_RED : GRAD_GOLD, icon:TrendingUp, route:"/teachers-directory" },
          ].map(s=>{
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                onClick={()=>navigate(s.route)}
                role="button" tabIndex={0}
                {...tilt3D}
                style={{
                  background:s.grad, borderRadius: isMobile ? 16 : 22, padding: isMobile ? "14px 14px" : "20px 22px", color:T1,
                  cursor:"pointer", position:"relative", overflow:"hidden",
                  boxShadow:"0 4px 8px rgba(0,85,255,.12), 0 12px 24px rgba(0,85,255,.16), 0 28px 56px rgba(0,85,255,.18)",
                  ...tilt3DStyle,
                }}
              >
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 10 : 14, position:"relative", zIndex:1 }}>
                  <div style={{ width: isMobile ? 32 : 38, height: isMobile ? 32 : 38, borderRadius: isMobile ? 10 : 12, background:"rgba(255,255,255,.65)", border:"0.5px solid rgba(0,16,64,.08)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <Icon size={isMobile ? 16 : 19} color={T1} strokeWidth={2.4}/>
                  </div>
                </div>
                <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:800, color:T3, letterSpacing:"0.10em", textTransform:"uppercase", margin:"0 0 4px 0", position:"relative", zIndex:1 }}>{s.label}</p>
                <p style={{ fontSize: isMobile ? 22 : 30, fontWeight:800, color:T1, letterSpacing:"-0.6px", margin:0, lineHeight:1.1, position:"relative", zIndex:1 }}>{s.value}</p>
                <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:T3, margin:"6px 0 0 0", position:"relative", zIndex:1 }}>{s.sub}</p>
              </div>
            );
          })}
        </div>

        {/* ── Charts Row (3-col) ────────────────────── */}
        <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 12 : 16, marginBottom: isMobile ? 16 : 24, perspective:"1200px" }}>

          {/* Performance Distribution */}
          <div
            {...tilt3D}
            onClick={()=>navigate("/teachers-directory")}
            role="button" tabIndex={0}
            style={{
              background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px" : "22px 24px",
              boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
              cursor:"pointer",
              ...tilt3DStyle,
            }}
          >
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <div>
                <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Performance Distribution</h3>
                <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>By tier</p>
              </div>
              <div style={{ width:32, height:32, borderRadius:10, background:"rgba(0,85,255,.08)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <BarChart3 size={16} color={B1} strokeWidth={2.3}/>
              </div>
            </div>
            <div style={{ height: isMobile ? 220 : 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={perfDist.length ? perfDist : [{ name:"No Data", value:1, fill:"#e2e8f0" }]}
                    cx="50%" cy="50%"
                    innerRadius={isMobile ? 42 : 55} outerRadius={isMobile ? 68 : 85}
                    paddingAngle={4} dataKey="value"
                    label={({ name, value, midAngle, cx, cy, outerRadius: or }) => {
                      const R = Math.PI / 180;
                      const x = cx + (or + 20) * Math.cos(-midAngle * R);
                      const y = cy + (or + 20) * Math.sin(-midAngle * R);
                      return (
                        <text x={x} y={y} fill={T3} fontSize={10} fontWeight="700"
                          textAnchor={x > cx ? "start" : "end"} dominantBaseline="central">
                          {name} ({value})
                        </text>
                      );
                    }}
                  >
                    {perfDist.map((e, i) => <Cell key={i} fill={e.fill} stroke="none"/>)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Subject Ratings */}
          <div
            {...tilt3D}
            onClick={()=>navigate("/academics")}
            role="button" tabIndex={0}
            style={{
              background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px" : "22px 24px",
              boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
              cursor:"pointer",
              ...tilt3DStyle,
            }}
          >
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <div>
                <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Subject-wise Scores</h3>
                <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Average ratings</p>
              </div>
              <div style={{ width:32, height:32, borderRadius:10, background:"rgba(0,200,83,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <BookOpen size={16} color={GREEN} strokeWidth={2.3}/>
              </div>
            </div>
            <div style={{ height: isMobile ? 220 : 240 }}>
              {subjectRatings.length === 0 ? (
                <div style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:T4 }}>No exam data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={subjectRatings} layout="vertical" margin={{ left:0, right: isMobile ? 36 : 46, top:8, bottom:8 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,85,255,.07)"/>
                    <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill:T3, fontSize:10, fontWeight:600 }}/>
                    <YAxis dataKey="subject" type="category" axisLine={false} tickLine={false} tick={{ fill:T3, fontSize:isMobile ? 10 : 11, fontWeight:700 }} width={isMobile ? 62 : 80}/>
                    <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }} cursor={{ fill:"rgba(0,85,255,.04)" }}/>
                    <Bar dataKey="rating" radius={[0, 6, 6, 0]} barSize={16}
                      label={{ position:"right", fill:T3, fontSize:11, fontWeight:700, formatter: (v: any) => `${v}%` }}>
                      {subjectRatings.map((e, i) => (
                        <Cell key={i} fill={e.rating >= 80 ? GREEN : e.rating >= 60 ? B1 : e.rating >= 40 ? GOLD : RED}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Top Performers */}
          <div
            {...tilt3D}
            onClick={()=>navigate("/teacher-leaderboard")}
            role="button" tabIndex={0}
            style={{
              background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px" : "22px 24px",
              boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
              maxHeight: isMobile ? 380 : 320, overflowY:"auto",
              cursor:"pointer",
              ...tilt3DStyle,
            }}
          >
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, position:"sticky", top:0, background:"#fff", zIndex:2 }}>
              <div>
                <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Top Performers</h3>
                <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Leaderboard</p>
              </div>
              <div style={{ width:32, height:32, borderRadius:10, background:"rgba(255,170,0,.12)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Award size={16} color={GOLD} strokeWidth={2.3}/>
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {filtered
                .filter(t => t.avgScore > 0)
                .sort((a, b) => b.avgScore - a.avgScore)
                .slice(0, 6)
                .map((t, i) => {
                  const tr = tierStyle(t.avgScore);
                  return (
                    <div key={t.id}
                      className="tp-row"
                      style={{
                        display:"flex", alignItems:"center", gap:10,
                        padding:"10px 12px", borderRadius:12, cursor:"pointer",
                      }}
                      onClick={(e)=>{e.stopPropagation();navigate(`/teachers/${t.id}`);}}
                    >
                      <span style={{ fontSize:14, fontWeight:800, color: i===0 ? GOLD : i===1 ? T3 : i===2 ? "#CD7F32" : T4, width:20, flexShrink:0 }}>{i + 1}</span>
                      <div style={{
                        width:34, height:34, borderRadius:10, background:tr.solidGrad,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        color:"#fff", fontSize:10, fontWeight:800, flexShrink:0,
                      }}>
                        {initials(t.name)}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ fontSize:12, fontWeight:700, color:T1, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{t.name}</p>
                        <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"2px 0 0 0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{t.subject || "—"} · {t.branchName}</p>
                      </div>
                      <span style={{ fontSize:12, fontWeight:800, color:tr.color, flexShrink:0 }}>{t.avgScore}%</span>
                    </div>
                  );
                })}
              {filtered.filter(t => t.avgScore > 0).length === 0 && (
                <p style={{ padding:"20px 0", textAlign:"center", fontSize:12, fontWeight:700, color:T4 }}>No exam data yet</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Performance vs Attendance Trend ────────── */}
        <div
          {...tilt3D}
          onClick={()=>navigate("/teachers")}
          role="button" tabIndex={0}
          style={{
            background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px" : "22px 24px",
            boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
            marginBottom: isMobile ? 16 : 24, perspective:"1200px",
            cursor:"pointer",
            ...tilt3DStyle,
          }}
        >
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 12 : 16 }}>
            <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, minWidth:0 }}>
              <div style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius:11, background:GRAD_PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 6px 14px rgba(0,85,255,.28)", flexShrink:0 }}>
                <TrendingUp size={isMobile ? 16 : 18} color="#fff" strokeWidth={2.3}/>
              </div>
              <div style={{ minWidth:0 }}>
                <h3 style={{ fontSize: isMobile ? 13 : 15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>{isMobile ? "Performance vs Attendance" : "Performance vs Attendance Trend"}</h3>
                <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Last 6 months</p>
              </div>
            </div>
          </div>
          <div style={{ height: isMobile ? 220 : 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyAgg} margin={{ top:5, right: isMobile ? 10 : 30, left:-10, bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill:T3, fontSize:11, fontWeight:600 }} dy={8}/>
                <YAxis axisLine={false} tickLine={false} tick={{ fill:T3, fontSize:11, fontWeight:600 }} domain={[0, 100]}/>
                <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }}/>
                <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize:11, fontWeight:700, paddingTop:8 }}/>
                <Line type="monotone" dataKey="performance" name="Avg Performance" stroke={B1} strokeWidth={3}
                  dot={{ r:4, fill:B1, strokeWidth:2, stroke:"#fff" }} activeDot={{ r:6 }}/>
                <Line type="monotone" dataKey="attendance" name="Avg Attendance" stroke={GREEN} strokeWidth={3} strokeDasharray="5 5"
                  dot={{ r:4, fill:GREEN, strokeWidth:2, stroke:"#fff" }} activeDot={{ r:6 }}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Teacher Cards Grid ────────────────────── */}
        <div
          {...tilt3D}
          onClick={()=>navigate("/teachers-directory")}
          role="button" tabIndex={0}
          style={{
            background:"#fff", borderRadius: isMobile ? 16 : 22,
            boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
            overflow:"hidden", marginBottom: isMobile ? 16 : 24, perspective:"1200px",
            cursor:"pointer",
            ...tilt3DStyle,
          }}
        >
          <div style={{ padding: isMobile ? "14px 14px" : "18px 24px", borderBottom:"0.5px solid rgba(0,85,255,.08)", display:"flex", alignItems:"center", gap: isMobile ? 8 : 12, flexWrap:"wrap" }}>
            <div style={{ position:"relative", flex:1, minWidth: isMobile ? 0 : 220, maxWidth: isMobile ? "100%" : 360 }}>
              <Search style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }} size={15} color={T4}/>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
                placeholder="Search teachers by name..."
                style={{
                  width:"100%", padding: isMobile ? "9px 10px 9px 34px" : "10px 12px 10px 36px", borderRadius:12,
                  border:"0.5px solid rgba(0,85,255,.14)", background:"#F5F9FF",
                  fontSize: isMobile ? 12 : 13, fontWeight:500, color:T1, outline:"none", fontFamily:"inherit",
                }}
              />
            </div>
            <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:700, color:T4, letterSpacing:"0.14em", textTransform:"uppercase", margin:0, marginLeft: isMobile ? 0 : "auto" }}>
              {filtered.length} {isMobile ? "found" : "teachers"}
            </p>
          </div>

          <div style={{ padding: isMobile ? 12 : 22, display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)", gap: isMobile ? 10 : 14 }}>
            {filtered.map(t => {
              const tr = tierStyle(t.avgScore);
              return (
                <div
                  key={t.id}
                  {...tilt3D}
                  style={{
                    background:"#F5F9FF", borderRadius: isMobile ? 14 : 18, padding: isMobile ? "14px 14px" : "18px 20px",
                    border:"0.5px solid rgba(0,85,255,.1)", cursor:"pointer",
                    position:"relative", overflow:"hidden",
                    ...tilt3DStyle,
                  }}
                  onClick={(e)=>{e.stopPropagation();navigate(`/teachers/${t.id}`);}}
                >
                  <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, marginBottom: isMobile ? 12 : 14 }}>
                    <div style={{
                      width: isMobile ? 40 : 44, height: isMobile ? 40 : 44, borderRadius: isMobile ? 12 : 13, background:tr.solidGrad,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      color:"#fff", fontSize:12, fontWeight:800,
                      boxShadow:`0 6px 14px ${tr.color}33`, flexShrink:0,
                    }}>
                      {initials(t.name)}
                    </div>
                    <div style={{ minWidth:0, flex:1 }}>
                      <p style={{ fontSize:13, fontWeight:800, color:T1, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", letterSpacing:"-0.2px" }}>{t.name}</p>
                      <p style={{ fontSize:10, fontWeight:700, color:T4, margin:"2px 0 0 0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", letterSpacing:"0.04em" }}>{t.subject || "—"}</p>
                    </div>
                    {isMobile && (
                      <span style={{
                        fontSize:9, fontWeight:800, padding:"3px 9px", borderRadius:999, flexShrink:0,
                        background:tr.bg, color:tr.color,
                        letterSpacing:"0.10em", textTransform:"uppercase",
                      }}>{tr.label}</span>
                    )}
                  </div>
                  {isMobile ? (
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:6, paddingTop:10, borderTop:"0.5px solid rgba(0,85,255,.08)" }}>
                      {[
                        ["Score", t.avgScore > 0 ? `${t.avgScore}%` : "—", tr.color],
                        ["Att.", t.attPct > 0 ? `${t.attPct}%` : "—", T1],
                        ["Classes", t.classCount.toString(), T1],
                        ["Branch", (t.branchName || "—").split(" ")[0], T3],
                      ].map(([k, v, c]) => (
                        <div key={k as string} style={{ minWidth:0 }}>
                          <p style={{ fontSize:8, fontWeight:700, color:T4, letterSpacing:"0.10em", textTransform:"uppercase", margin:0 }}>{k}</p>
                          <p style={{ fontSize:12, fontWeight:800, color: c as string, margin:"2px 0 0 0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{v}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
                        {[
                          ["Branch", t.branchName],
                          ["Avg Score", t.avgScore > 0 ? `${t.avgScore}%` : "—"],
                          ["Attendance", t.attPct > 0 ? `${t.attPct}%` : "—"],
                          ["Classes", t.classCount.toString()],
                        ].map(([k, v]) => (
                          <div key={k} style={{ display:"flex", justifyContent:"space-between", fontSize:10 }}>
                            <span style={{ fontWeight:600, color:T4, letterSpacing:"0.06em" }}>{k}</span>
                            <span style={{ fontWeight:800, color: k==="Avg Score" ? tr.color : T3, maxWidth:110, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{v}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingTop:10, borderTop:"0.5px solid rgba(0,85,255,.08)" }}>
                        <span style={{
                          fontSize:9, fontWeight:800, padding:"3px 9px", borderRadius:999,
                          background:tr.bg, color:tr.color,
                          letterSpacing:"0.12em", textTransform:"uppercase",
                        }}>{tr.label}</span>
                        <ChevronRight size={14} color={T4}/>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ gridColumn:"1 / -1", padding:"60px 0", textAlign:"center", fontSize:12, fontWeight:700, color:T4, letterSpacing:"0.14em", textTransform:"uppercase" }}>
                No teachers found
              </div>
            )}
          </div>
        </div>

        {/* ── AI Intelligence Card ──────────────────── */}
        <div
          {...tilt3D}
          onClick={()=>navigate("/ai-predictor")}
          role="button" tabIndex={0}
          style={{
            background:GRAD_HERO, borderRadius: isMobile ? 16 : 22, padding: isMobile ? "18px 16px" : "24px 26px", color:"#fff",
            position:"relative", overflow:"hidden",
            boxShadow:"0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)",
            cursor:"pointer",
            ...tilt3DStyle,
          }}
        >
          <div style={{ position:"absolute", bottom:-50, left:-40, width:240, height:240, background:"radial-gradient(circle, rgba(123,63,244,.28) 0%, transparent 65%)", borderRadius:"50%", pointerEvents:"none" }}/>
          <div style={{ display:"flex", alignItems:"flex-start", gap: isMobile ? 12 : 14, position:"relative", zIndex:1, marginBottom: isMobile ? 14 : 16 }}>
            <div style={{ width: isMobile ? 38 : 44, height: isMobile ? 38 : 44, borderRadius: isMobile ? 11 : 13, background:"rgba(255,255,255,.16)", border:"0.5px solid rgba(255,255,255,.26)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <Sparkles size={isMobile ? 18 : 22} color="#fff" strokeWidth={2.2}/>
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:999, background:"rgba(255,255,255,.14)", border:"0.5px solid rgba(255,255,255,.22)", fontSize:9, fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:8 }}>
                AI Insights
              </div>
              <h3 style={{ fontSize: isMobile ? 15 : 18, fontWeight:700, color:"#fff", margin:0, letterSpacing:"-0.4px" }}>Teacher Performance Summary</h3>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 10 : 12, position:"relative", zIndex:1 }}>
            {[
              { label:"Effectiveness Insight", value:typeof avgEffectiveness === "string" && avgEffectiveness !== "—" ? `${avgEffectiveness}% team avg` : "Collecting data", sub:topPerformers>0?`${topPerformers} top performers`:"Build evaluation base" },
              { label:"Training Priority",     value:needsImprovement > 0 ? `${needsImprovement} teacher${needsImprovement>1?"s":""}` : "All stable", sub:needsImprovement > 0 ? "Recommend coaching" : "No intervention needed" },
              { label:"Subject Strength",      value:subjectRatings.length > 0 ? subjectRatings[0].subject : "Pending data", sub:subjectRatings.length > 0 ? `${subjectRatings[0].rating}% avg rating` : "Upload exam scores" },
            ].map(c=>(
              <div key={c.label} style={{ background:"rgba(255,255,255,.10)", borderRadius: isMobile ? 12 : 14, padding: isMobile ? "12px 14px" : "14px 16px", border:"0.5px solid rgba(255,255,255,.14)" }}>
                <p style={{ fontSize:9, fontWeight:800, color:"rgba(255,255,255,.65)", letterSpacing:"0.14em", textTransform:"uppercase", margin:"0 0 8px 0" }}>{c.label}</p>
                <p style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:"#fff", margin:0, letterSpacing:"-0.3px" }}>{c.value}</p>
                <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:"rgba(255,255,255,.72)", margin:"6px 0 0 0" }}>{c.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
