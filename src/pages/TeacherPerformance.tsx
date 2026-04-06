import { useState, useEffect, useMemo } from "react";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  Search, Star, X, Users, BookOpen, TrendingUp, Loader2,
  Award, ChevronDown
} from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, Legend, AreaChart, Area
} from "recharts";
import { useParams, useNavigate } from "react-router-dom";

/* ── constants ────────────────────────────────────────── */
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const AVATAR_COLORS = [
  "bg-[#1e3a8a]","bg-emerald-600","bg-orange-500","bg-purple-600",
  "bg-pink-500","bg-teal-600","bg-amber-600","bg-red-600",
];

/* ── helpers ──────────────────────────────────────────── */
function initials(name: string) {
  return (name || "?").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function scoreLabel(s: number): { label: string; color: string; bg: string } {
  if (s >= 80) return { label: "Excellent",    color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-100"  };
  if (s >= 60) return { label: "Good",         color: "text-blue-600",    bg: "bg-blue-50 border-blue-100"        };
  if (s >= 40) return { label: "Average",      color: "text-amber-600",   bg: "bg-amber-50 border-amber-100"      };
  return              { label: "Needs Work",   color: "text-red-600",     bg: "bg-red-50 border-red-100"          };
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

        /* 1. branches subcollection */
        const bMap = new Map<string, string>();
        if (ownerUid) {
          const bSnap = await getDocs(collection(db, "schools", ownerUid, "branches"));
          bSnap.docs.forEach(d => {
            const data = d.data() as any;
            const bid  = data.branchId || d.id;
            const bn   = data.name || data.branchName || "";
            if (bid && bn) bMap.set(bid, bn);
          });
        }
        setBranchMap(bMap);

        /* 2. teachers */
        const tSnap = await getDocs(collection(db, "teachers"));
        const rawTeachers = tSnap.docs.map((d, i) => ({
          _docId: d.id,
          ...d.data() as any,
          _color: AVATAR_COLORS[i % AVATAR_COLORS.length],
        }));
        setTeachers(rawTeachers);

        /* 3. test_scores → teacherId → percentage[] */
        const scSnap = await getDocs(collection(db, "test_scores"));
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

        /* 4. attendance → teacherId → {p,t} */
        const attSnap = await getDocs(collection(db, "attendance"));
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

        /* 5. classes → teacherId → classes[] */
        const clSnap = await getDocs(collection(db, "classes"));
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
        /* a. test_scores for this teacher */
        const scSnap = await getDocs(
          query(collection(db, "test_scores"), where("teacherId", "==", id))
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

        /* b. attendance for this teacher */
        const attSnap = await getDocs(
          query(collection(db, "attendance"), where("teacherId", "==", id))
        );
        const attDocs = attSnap.docs.map(d => d.data() as any);
        const attP = attDocs.filter(d => (d.status || "").toLowerCase() === "present").length;
        const attT = attDocs.length;
        const tAttPct = attT > 0 ? Math.round((attP / attT) * 100) : null;
        setDetailAttPct(tAttPct);

        /* c. classes for this teacher */
        const clSnap = await getDocs(
          query(collection(db, "classes"), where("teacherId", "==", id))
        );
        const tClasses = clSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
        setDetailClasses(tClasses);

        /* d. students taught: enrollments in those classes */
        let studentCount = 0;
        if (tClasses.length > 0) {
          const classIds = tClasses.map(c => c.id).slice(0, 10);
          const enSnap = await getDocs(
            query(collection(db, "enrollments"), where("classId", "in", classIds))
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

  /* ─────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#1e3a8a]" />
      </div>
    );
  }

  /* ══════════════════════════════════════════════════ */
  /* ── DETAIL VIEW ─────────────────────────────────── */
  if (id && selectedTeacher) {
    const sl = scoreLabel(selectedTeacher.avgScore);
    return (
      <div className="space-y-6 animate-in fade-in duration-500 pb-10">

        {/* Header card */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-2xl ${selectedTeacher._color} flex items-center justify-center text-white font-extrabold text-xl shadow-md`}>
                {initials(selectedTeacher.name)}
              </div>
              <div>
                <h2 className="text-2xl font-extrabold text-[#1e294b]">{selectedTeacher.name}</h2>
                <p className="text-sm text-slate-400 font-semibold mt-0.5">
                  {selectedTeacher.subject || "—"} &bull; {selectedTeacher.branchName} &bull; ID: {selectedTeacher.id.slice(0, 10)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-extrabold px-4 py-1.5 rounded-full border ${sl.bg} ${sl.color}`}>
                {sl.label}
              </span>
              <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${selectedTeacher.status === "Active" ? "bg-green-50 text-green-600 border border-green-100" : "bg-slate-100 text-slate-500"}`}>
                {selectedTeacher.status || "—"}
              </span>
              <button
                onClick={() => navigate("/teachers")}
                className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-400 border border-slate-100 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Stat cards */}
        {detailLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-[#1e3a8a]" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  label: "Effectiveness Score",
                  value: selectedTeacher.avgScore > 0 ? `${selectedTeacher.avgScore}%` : "—",
                  note: selectedTeacher.avgScore > 0 ? sl.label : "No exam data",
                  icon: Award,
                  color: "text-emerald-600",
                },
                {
                  label: "Class Attendance",
                  value: detailAttPct !== null ? `${detailAttPct}%` : "—",
                  note: detailAttPct !== null ? (detailAttPct >= 90 ? "Excellent" : detailAttPct >= 75 ? "Good" : "Needs attention") : "No data",
                  icon: Users,
                  color: detailAttPct !== null && detailAttPct >= 90 ? "text-emerald-600" : "text-amber-600",
                },
                {
                  label: "Classes Assigned",
                  value: detailClasses.length.toString(),
                  note: `${detailClasses.filter(c => c.status === "Active").length} active`,
                  icon: BookOpen,
                  color: "text-blue-600",
                },
                {
                  label: "Students Taught",
                  value: detailStudents > 0 ? detailStudents.toString() : selectedTeacher.classCount > 0 ? "—" : "0",
                  note: "Across all classes",
                  icon: TrendingUp,
                  color: "text-purple-600",
                },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</p>
                    <s.icon className={`w-4 h-4 ${s.color}`} />
                  </div>
                  <p className="text-3xl font-extrabold text-[#1e294b] mb-1">{s.value}</p>
                  <p className={`text-xs font-semibold ${s.color}`}>{s.note}</p>
                </div>
              ))}
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Performance Timeline */}
              <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                <h3 className="text-base font-bold text-[#1e294b] mb-4">Performance Timeline</h3>
                {detailTimeline.every(d => d.score === 0) ? (
                  <div className="h-[220px] flex items-center justify-center text-sm text-slate-400 font-semibold">No exam data yet</div>
                ) : (
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={detailTimeline} margin={{ left: -20, right: 10, top: 5 }}>
                        <defs>
                          <linearGradient id="tlGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#1e3a8a" stopOpacity={0.12}/>
                            <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill:"#94a3b8", fontSize:11, fontWeight:600 }} dy={8}/>
                        <YAxis axisLine={false} tickLine={false} tick={{ fill:"#94a3b8", fontSize:11, fontWeight:600 }} domain={[0, 100]}/>
                        <Tooltip contentStyle={{ borderRadius:"12px", border:"none", boxShadow:"0 10px 15px rgba(0,0,0,0.1)" }}/>
                        <Area type="monotone" dataKey="score" name="Avg Score" stroke="#1e3a8a" strokeWidth={3}
                          fill="url(#tlGrad)" dot={{ r:4, fill:"#1e3a8a", strokeWidth:2, stroke:"#fff" }} connectNulls={false}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* vs Branch Average */}
              <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                <h3 className="text-base font-bold text-[#1e294b] mb-4">
                  vs Branch Average
                  <span className="ml-2 text-xs font-semibold text-slate-400">({selectedTeacher.branchName})</span>
                </h3>
                {detailVsBranch.length === 0 ? (
                  <div className="h-[220px] flex items-center justify-center text-sm text-slate-400 font-semibold">No comparison data</div>
                ) : (
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={detailVsBranch} margin={{ left: -20, right: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                        <XAxis dataKey="category" axisLine={false} tickLine={false} tick={{ fill:"#94a3b8", fontSize:11, fontWeight:600 }} dy={8}/>
                        <YAxis axisLine={false} tickLine={false} tick={{ fill:"#94a3b8", fontSize:11, fontWeight:600 }}/>
                        <Tooltip contentStyle={{ borderRadius:"12px", border:"none", boxShadow:"0 10px 15px rgba(0,0,0,0.1)" }} cursor={{ fill:"#f8fafc" }}/>
                        <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize:"11px", fontWeight:700, paddingTop:"8px" }}/>
                        <Bar dataKey="teacher"   name="This Teacher" fill="#1e3a8a" radius={[4,4,0,0]} barSize={22}/>
                        <Bar dataKey="branchAvg" name="Branch Avg"   fill="#94a3b8" radius={[4,4,0,0]} barSize={22} opacity={0.6}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            {/* Current Classes */}
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
              <h3 className="text-base font-bold text-[#1e294b] mb-4">Current Classes</h3>
              {detailClasses.length === 0 ? (
                <p className="text-sm text-slate-400 font-semibold py-8 text-center">No classes assigned yet</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {detailClasses.map((cls, i) => (
                    <div key={cls.id} className="bg-slate-50 rounded-xl p-4 border border-slate-100 hover:bg-white hover:shadow-md transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-bold text-[#1e294b]">{cls.name}</h4>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${cls.status === "Active" ? "bg-green-50 text-green-600 border border-green-100" : "bg-slate-100 text-slate-500"}`}>
                          {cls.status || "Active"}
                        </span>
                      </div>
                      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                        {cls.grade || "—"} {cls.section ? `· ${cls.section}` : ""} {cls.subject ? `· ${cls.subject}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════ */
  /* ── LIST / OVERVIEW VIEW ────────────────────────── */
  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-[#1e294b] tracking-tight">Teacher Performance</h1>
          <p className="text-slate-500 font-medium">Effectiveness metrics &amp; evaluation analytics</p>
        </div>
        {/* Branch filter */}
        <div className="relative self-start">
          <select
            value={branchFilter}
            onChange={e => setBranchFilter(e.target.value)}
            className="appearance-none border border-slate-200 rounded-xl pl-4 pr-10 py-2.5 text-sm font-bold text-slate-600 bg-white outline-none focus:ring-2 focus:ring-[#1e3a8a]/10 shadow-sm"
          >
            {branchList.map(b => (
              <option key={b} value={b}>{b === "All" ? "All Branches" : b}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"/>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: "Total Teachers",             value: totalTeachers.toString(),      note: `In ${branchFilter === "All" ? "all branches" : branchFilter}`, color: "text-blue-600"    },
          { label: "Avg Effectiveness Score",    value: `${avgEffectiveness}%`,        note: "Across all exams",                                            color: "text-emerald-600" },
          { label: "Top Performers",             value: topPerformers.toString(),      note: `${totalTeachers > 0 ? ((topPerformers/totalTeachers)*100).toFixed(1) : 0}% of staff`,    color: "text-emerald-600" },
          { label: "Needs Improvement",          value: needsImprovement.toString(),   note: `${totalTeachers > 0 ? ((needsImprovement/totalTeachers)*100).toFixed(1) : 0}% of staff`, color: "text-amber-600"   },
        ].map(s => (
          <div key={s.label} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
            <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-2">{s.label}</p>
            <h3 className="text-4xl font-extrabold text-[#1e294b] tracking-tight mb-1">{s.value}</h3>
            <p className={`text-[11px] font-bold ${s.color}`}>{s.note}</p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Performance Distribution Pie */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
          <h3 className="text-base font-bold text-[#1e294b] mb-4">Performance Distribution</h3>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={perfDist.length ? perfDist : [{ name:"No Data", value:1, fill:"#e2e8f0" }]}
                  cx="50%" cy="50%"
                  innerRadius={60} outerRadius={90}
                  paddingAngle={4} dataKey="value"
                  label={({ name, value, midAngle, cx, cy, outerRadius: or }) => {
                    const R = Math.PI / 180;
                    const x = cx + (or + 24) * Math.cos(-midAngle * R);
                    const y = cy + (or + 24) * Math.sin(-midAngle * R);
                    return (
                      <text x={x} y={y} fill="#94a3b8" fontSize={10} fontWeight="bold"
                        textAnchor={x > cx ? "start" : "end"} dominantBaseline="central">
                        {name} ({value})
                      </text>
                    );
                  }}
                >
                  {perfDist.map((e, i) => <Cell key={i} fill={e.fill} stroke="none"/>)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius:"12px", border:"none", boxShadow:"0 10px 15px rgba(0,0,0,0.1)" }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Subject-wise Ratings */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
          <h3 className="text-base font-bold text-[#1e294b] mb-4">Subject-wise Avg Score</h3>
          <div className="h-[260px]">
            {subjectRatings.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-400 font-semibold">No exam data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={subjectRatings} layout="vertical" margin={{ left: 0, right: 48, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9"/>
                  <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill:"#94a3b8", fontSize:10, fontWeight:600 }}/>
                  <YAxis dataKey="subject" type="category" axisLine={false} tickLine={false} tick={{ fill:"#64748b", fontSize:11, fontWeight:700 }} width={80}/>
                  <Tooltip contentStyle={{ borderRadius:"12px", border:"none", boxShadow:"0 10px 15px rgba(0,0,0,0.1)" }} cursor={{ fill:"#f8fafc" }}/>
                  <Bar dataKey="rating" fill="#1e3a8a" radius={[0, 5, 5, 0]} barSize={16}
                    label={{ position:"right", fill:"#64748b", fontSize:11, fontWeight:700, formatter: (v: any) => `${v}%` }}/>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Top performers quick list */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm overflow-y-auto max-h-[320px]">
          <h3 className="text-base font-bold text-[#1e294b] mb-4">Top Performers</h3>
          <div className="space-y-3">
            {filtered
              .filter(t => t.avgScore > 0)
              .sort((a, b) => b.avgScore - a.avgScore)
              .slice(0, 6)
              .map((t, i) => {
                const sl2 = scoreLabel(t.avgScore);
                return (
                  <div key={t.id}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 cursor-pointer transition-all group"
                    onClick={() => navigate(`/teachers/${t.id}`)}
                  >
                    <span className="text-xs font-extrabold text-slate-300 w-5 shrink-0">{i + 1}</span>
                    <div className={`w-9 h-9 rounded-xl ${t._color} flex items-center justify-center text-white text-xs font-extrabold shrink-0`}>
                      {initials(t.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[#1e294b] truncate group-hover:text-[#1e3a8a]">{t.name}</p>
                      <p className="text-[10px] text-slate-400 font-semibold truncate">{t.subject || "—"} · {t.branchName}</p>
                    </div>
                    <span className={`text-xs font-extrabold ${sl2.color} shrink-0`}>{t.avgScore}%</span>
                  </div>
                );
              })}
            {filtered.filter(t => t.avgScore > 0).length === 0 && (
              <p className="text-sm text-slate-400 font-semibold text-center py-4">No exam data yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Performance vs Attendance Trend */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
        <h3 className="text-base font-bold text-[#1e294b] mb-4">Performance vs Attendance Trend (Last 6 Months)</h3>
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyAgg} margin={{ top: 5, right: 30, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill:"#94a3b8", fontSize:11, fontWeight:600 }} dy={8}/>
              <YAxis axisLine={false} tickLine={false} tick={{ fill:"#94a3b8", fontSize:11, fontWeight:600 }} domain={[0, 100]}/>
              <Tooltip contentStyle={{ borderRadius:"12px", border:"none", boxShadow:"0 10px 15px rgba(0,0,0,0.1)" }}/>
              <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize:"11px", fontWeight:700, paddingTop:"8px" }}/>
              <Line type="monotone" dataKey="performance" name="Avg Performance" stroke="#1e3a8a" strokeWidth={3}
                dot={{ r:4, fill:"#1e3a8a", strokeWidth:2, stroke:"#fff" }}/>
              <Line type="monotone" dataKey="attendance" name="Avg Attendance" stroke="#22c55e" strokeWidth={3}
                dot={{ r:4, fill:"#22c55e", strokeWidth:2, stroke:"#fff" }}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Teacher Cards Grid */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search teachers..."
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-[#1e3a8a]/10 bg-slate-50"
            />
          </div>
          <p className="text-xs font-semibold text-slate-400 ml-auto">{filtered.length} teachers</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
          {filtered.map(t => {
            const sl2 = scoreLabel(t.avgScore);
            return (
              <div
                key={t.id}
                className="bg-slate-50 border border-slate-100 rounded-2xl p-5 hover:bg-white hover:shadow-lg transition-all cursor-pointer group"
                onClick={() => navigate(`/teachers/${t.id}`)}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-11 h-11 rounded-xl ${t._color} flex items-center justify-center text-white text-sm font-extrabold shrink-0`}>
                    {initials(t.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#1e294b] truncate group-hover:text-[#1e3a8a] transition-colors">{t.name}</p>
                    <p className="text-[10px] text-slate-400 font-semibold truncate">{t.subject || "—"}</p>
                  </div>
                </div>
                <div className="space-y-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-semibold">Branch</span>
                    <span className="font-bold text-slate-600 truncate max-w-[110px]">{t.branchName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-semibold">Avg Score</span>
                    <span className={`font-bold ${sl2.color}`}>{t.avgScore > 0 ? `${t.avgScore}%` : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-semibold">Attendance</span>
                    <span className="font-bold text-slate-600">{t.attPct > 0 ? `${t.attPct}%` : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-semibold">Classes</span>
                    <span className="font-bold text-slate-600">{t.classCount}</span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${sl2.bg} ${sl2.color}`}>
                    {sl2.label}
                  </span>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${t.status === "Active" ? "bg-green-50 text-green-600 border border-green-100" : "bg-slate-100 text-slate-500"}`}>
                    {t.status || "—"}
                  </span>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full py-16 text-center text-sm text-slate-400 font-semibold">
              No teachers found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
