import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import {
  ArrowLeft, Loader2, AlertCircle,
  Award, Users, BookOpen, TrendingUp,
  Mail, Phone, Calendar, MapPin
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, Legend
} from "recharts";

// ── Constants ─────────────────────────────────────────────────────────────────
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const AVATAR_COLORS = [
  "bg-[#1e3a8a]","bg-emerald-600","bg-orange-500","bg-purple-600",
  "bg-pink-500","bg-teal-600","bg-amber-600","bg-red-600",
];

function last6Months() {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return MONTH_NAMES[d.getMonth()];
  });
}

function initials(name: string) {
  return (name || "?").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function scoreLabel(s: number) {
  if (s >= 80) return { label: "Excellent",  color: "bg-emerald-500" };
  if (s >= 60) return { label: "Good",        color: "bg-blue-500"   };
  if (s >= 40) return { label: "Average",     color: "bg-amber-500"  };
  return              { label: "Needs Work",  color: "bg-red-500"    };
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TeacherProfile() {
  const { id }    = useParams<{ id: string }>();
  const navigate  = useNavigate();

  const [loading,   setLoading]   = useState(true);
  const [teacher,   setTeacher]   = useState<any>(null);
  const [timeline,  setTimeline]  = useState<{ month: string; score: number; passRate: number }[]>([]);
  const [classes,   setClasses]   = useState<any[]>([]);
  const [students,  setStudents]  = useState(0);
  const [attPct,    setAttPct]    = useState<number | null>(null);
  const [avgScore,  setAvgScore]  = useState(0);
  const [passRate,  setPassRate]  = useState(0);
  const [vsBranch,  setVsBranch]  = useState<{ category: string; teacher: number; branchAvg: number }[]>([]);

  useEffect(() => {
    if (!id) { setLoading(false); return; }

    const load = async () => {
      try {
        // ── 1. Teacher document ──────────────────────────────────────────────
        const tDoc = await getDoc(doc(db, "teachers", id));
        if (!tDoc.exists()) { setLoading(false); return; }
        const tData = { id: tDoc.id, ...tDoc.data() as any };
        setTeacher(tData);

        // ── 2. Test scores for this teacher ──────────────────────────────────
        const scSnap = await getDocs(
          query(collection(db, "test_scores"), where("teacherId", "==", id))
        );
        const scores = scSnap.docs.map(d => d.data() as any);

        // Overall avg score
        const pcts = scores
          .map(d => parseFloat(d.percentage ?? d.score ?? ""))
          .filter(v => !isNaN(v));
        const avg = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
        setAvgScore(avg);

        const pass = pcts.length
          ? Math.round(pcts.filter(v => v >= 60).length / pcts.length * 100)
          : 0;
        setPassRate(pass);

        // Monthly timeline (score + pass rate)
        const byMonth = new Map<string, number[]>();
        scores.forEach(d => {
          const ts  = d.timestamp?.toDate?.();
          const pct = parseFloat(d.percentage ?? d.score ?? "");
          if (ts && !isNaN(pct)) {
            const mk = MONTH_NAMES[ts.getMonth()];
            if (!byMonth.has(mk)) byMonth.set(mk, []);
            byMonth.get(mk)!.push(pct);
          }
        });
        const tl = last6Months().map(m => {
          const sc = byMonth.get(m);
          if (!sc || sc.length === 0) return { month: m, score: 0, passRate: 0 };
          const monthAvg  = Math.round(sc.reduce((a, b) => a + b, 0) / sc.length);
          const monthPass = Math.round(sc.filter(v => v >= 60).length / sc.length * 100);
          return { month: m, score: monthAvg, passRate: monthPass };
        });
        setTimeline(tl);

        // ── 3. Attendance for this teacher ───────────────────────────────────
        const attSnap = await getDocs(
          query(collection(db, "attendance"), where("teacherId", "==", id))
        );
        const attDocs = attSnap.docs.map(d => d.data() as any);
        const attP = attDocs.filter(d => (d.status || "").toLowerCase() === "present").length;
        setAttPct(attDocs.length > 0 ? Math.round((attP / attDocs.length) * 100) : null);

        // ── 4. Classes for this teacher ──────────────────────────────────────
        const clSnap = await getDocs(
          query(collection(db, "classes"), where("teacherId", "==", id))
        );
        const tClasses = clSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
        setClasses(tClasses);

        // ── 5. Students taught via enrollments ───────────────────────────────
        if (tClasses.length > 0) {
          const classIds = tClasses.map(c => c.id).slice(0, 10);
          const enSnap = await getDocs(
            query(collection(db, "enrollments"), where("classId", "in", classIds))
          );
          setStudents(enSnap.size);
        }

        // ── 6. vs Branch avg (from all teachers in same branch) ──────────────
        if (tData.branchId || tData.branch) {
          const allTeachersSnap = await getDocs(collection(db, "teachers"));
          const branchTeacherIds = allTeachersSnap.docs
            .filter(d => {
              const bd = d.data() as any;
              return d.id !== id && (bd.branchId === tData.branchId || bd.branch === tData.branch);
            })
            .map(d => d.id);

          // Get all scores for branch teachers
          const allScoreSnap = await getDocs(collection(db, "test_scores"));
          const branchScores: number[] = [];
          allScoreSnap.docs.forEach(d => {
            const data = d.data() as any;
            if (branchTeacherIds.includes(data.teacherId || "")) {
              const pct = parseFloat(data.percentage ?? data.score ?? "");
              if (!isNaN(pct)) branchScores.push(pct);
            }
          });

          const branchAvgScore = branchScores.length
            ? Math.round(branchScores.reduce((a, b) => a + b, 0) / branchScores.length)
            : avg;
          const branchPassRate = branchScores.length
            ? Math.round(branchScores.filter(v => v >= 60).length / branchScores.length * 100)
            : pass;

          setVsBranch([
            { category: "Avg Score",  teacher: avg,        branchAvg: branchAvgScore },
            { category: "Pass Rate",  teacher: pass,       branchAvg: branchPassRate },
            { category: "Attendance", teacher: attDocs.length > 0 ? Math.round((attP / attDocs.length) * 100) : 0, branchAvg: 80 },
            { category: "Classes",   teacher: tClasses.length, branchAvg: Math.max(1, Math.round(branchTeacherIds.length > 0 ? branchTeacherIds.length / 2 : tClasses.length)) },
          ]);
        }

      } catch (e) {
        console.error("TeacherProfile load error:", e);
      }
      setLoading(false);
    };

    load();
  }, [id]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#1e3a8a]" />
      </div>
    );
  }

  // ── Not found ────────────────────────────────────────────────────────────────
  if (!teacher) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle className="w-12 h-12 text-slate-300" />
        <p className="text-slate-400 font-bold text-sm">Teacher not found</p>
        <button
          onClick={() => navigate("/teachers")}
          className="text-[#1e3a8a] text-xs font-black uppercase tracking-widest hover:underline"
        >
          ← Back to Teachers
        </button>
      </div>
    );
  }

  const sl       = scoreLabel(avgScore);
  const avatarBg = AVATAR_COLORS[id ? id.charCodeAt(0) % AVATAR_COLORS.length : 0];
  const hasTimeline = timeline.some(t => t.score > 0);

  return (
    <div className="space-y-8 max-w-[1200px] mx-auto animate-in fade-in duration-500 pb-10">

      {/* Back button */}
      <button
        onClick={() => navigate(`/teachers/${id}`)}
        className="inline-flex items-center gap-2 text-[10px] font-black text-[#1e3a8a] uppercase tracking-widest hover:gap-3 transition-all"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Performance
      </button>

      {/* ── Header card ── */}
      <div className="bg-white rounded-[40px] border border-slate-100 shadow-xl p-8 lg:p-12">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="flex flex-col sm:flex-row items-center gap-6 text-center sm:text-left">
            {/* Avatar */}
            <div className={`w-20 h-20 lg:w-24 lg:h-24 rounded-[32px] ${avatarBg} text-white flex items-center justify-center text-2xl font-black shadow-2xl ring-4 ring-slate-50 ring-offset-4 shrink-0`}>
              {initials(teacher.name)}
            </div>
            <div>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mb-2">
                <h1 className="text-2xl lg:text-3xl font-black text-[#1e293b] tracking-tight">{teacher.name}</h1>
                <span className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-lg ${sl.color}`}>
                  {sl.label}
                </span>
                {teacher.status && (
                  <span className="px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest bg-green-50 text-green-600 border border-green-100">
                    {teacher.status}
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-[0.15em]">
                {teacher.subject || teacher.designation || "Teacher"}
                {teacher.branch || teacher.branchName ? ` • ${teacher.branch || teacher.branchName}` : ""}
                {teacher.employeeId || teacher.id ? ` • ID: ${teacher.employeeId || teacher.id.substring(0, 8)}` : ""}
              </p>
              {/* Contact info */}
              <div className="flex flex-wrap items-center gap-4 mt-3">
                {teacher.email && (
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
                    <Mail className="w-3 h-3" /> {teacher.email}
                  </span>
                )}
                {teacher.phone && (
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
                    <Phone className="w-3 h-3" /> {teacher.phone}
                  </span>
                )}
                {(teacher.experience || teacher.joiningDate) && (
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
                    <Calendar className="w-3 h-3" />
                    {teacher.experience
                      ? `${teacher.experience} experience`
                      : `Joined ${teacher.joiningDate}`}
                  </span>
                )}
                {teacher.address && (
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
                    <MapPin className="w-3 h-3" /> {teacher.address}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        {[
          {
            label: "Effectiveness Score",
            val:   avgScore > 0 ? `${avgScore}%` : "—",
            sub:   avgScore > 0 ? sl.label : "No exam data",
            icon:  Award,
            color: "text-emerald-600",
          },
          {
            label: "Pass Rate",
            val:   passRate > 0 ? `${passRate}%` : "—",
            sub:   passRate > 0 ? `${passRate >= 80 ? "Strong" : passRate >= 60 ? "Good" : "Needs focus"}` : "No data",
            icon:  TrendingUp,
            color: passRate >= 80 ? "text-emerald-600" : "text-amber-600",
          },
          {
            label: "Attendance Rate",
            val:   attPct !== null ? `${attPct}%` : "—",
            sub:   attPct !== null ? (attPct >= 90 ? "Excellent" : attPct >= 75 ? "Good" : "Needs attention") : "No attendance data",
            icon:  Calendar,
            color: attPct !== null && attPct >= 90 ? "text-emerald-600" : "text-amber-600",
          },
          {
            label: "Students Taught",
            val:   students > 0 ? students.toString() : classes.length > 0 ? `${classes.length} class${classes.length > 1 ? "es" : ""}` : "—",
            sub:   `Across ${classes.length} class${classes.length !== 1 ? "es" : ""}`,
            icon:  Users,
            color: "text-blue-600",
          },
        ].map((card, i) => (
          <div key={i} className="bg-white p-6 lg:p-8 rounded-[28px] border border-slate-100 shadow-sm hover:shadow-lg transition-all text-center group">
            <div className="flex items-center justify-center mb-4">
              <card.icon className={`w-5 h-5 ${card.color}`} />
            </div>
            <p className="text-slate-400 text-[9px] font-black uppercase tracking-[0.2em] mb-3 group-hover:text-[#1e3a8a] transition-colors">
              {card.label}
            </p>
            <div className="text-3xl lg:text-4xl font-black text-[#1e293b] tracking-tighter mb-2">{card.val}</div>
            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Performance Timeline */}
        <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
          <h3 className="text-sm font-black text-[#1e293b] uppercase tracking-[0.15em] mb-6">Performance Timeline</h3>
          {!hasTimeline ? (
            <div className="h-[240px] flex items-center justify-center text-sm text-slate-300 font-semibold">
              No exam data recorded yet
            </div>
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeline} margin={{ left: -20, right: 10, top: 5 }}>
                  <defs>
                    <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#1e3a8a" stopOpacity={0.15}/>
                      <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" stroke="#cbd5e1" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} hide />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", fontSize: 12 }}
                    formatter={(val: any) => [`${val}%`]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700 }} />
                  <Area
                    type="monotone" dataKey="score" name="Avg Score"
                    stroke="#1e3a8a" strokeWidth={3} fill="url(#scoreGrad)"
                    dot={{ r: 4, fill: "#1e3a8a", strokeWidth: 2, stroke: "#fff" }}
                  />
                  <Area
                    type="monotone" dataKey="passRate" name="Pass Rate %"
                    stroke="#10b981" strokeWidth={2} fill="none" strokeDasharray="5 5"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* vs Branch Avg */}
        <div className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
          <h3 className="text-sm font-black text-[#1e293b] uppercase tracking-[0.15em] mb-6">vs Branch Average</h3>
          {vsBranch.length === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-sm text-slate-300 font-semibold">
              Comparison data not available
            </div>
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={vsBranch} margin={{ left: -20, right: 10, top: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="category" stroke="#cbd5e1" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700 }} />
                  <Bar dataKey="teacher"   name="This Teacher" fill="#1e3a8a" radius={[6,6,0,0]} />
                  <Bar dataKey="branchAvg" name="Branch Avg"   fill="#e2e8f0" radius={[6,6,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── Assigned Classes ── */}
      <div>
        <h3 className="text-sm font-black text-[#1e293b] uppercase tracking-[0.15em] mb-5">
          Assigned Classes
          <span className="ml-2 px-2.5 py-1 text-[10px] bg-slate-100 text-slate-500 rounded-full font-black">{classes.length}</span>
        </h3>

        {classes.length === 0 ? (
          <div className="bg-white rounded-[28px] border border-slate-100 p-10 text-center">
            <BookOpen className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold text-sm">No classes assigned yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {classes.map((c, i) => (
              <div key={c.id || i} className="bg-white border border-slate-100 rounded-[28px] p-7 hover:shadow-lg hover:-translate-y-1 transition-all group">
                <div className="flex items-center justify-between mb-5">
                  <h4 className="text-base font-black text-[#1e293b] group-hover:text-[#1e3a8a] transition-colors">
                    {c.name || c.className || `Class ${i + 1}`}
                  </h4>
                  <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${
                    c.status === "Active" || !c.status
                      ? "bg-green-50 text-green-600 border-green-100"
                      : "bg-slate-50 text-slate-500 border-slate-100"
                  }`}>
                    {c.status || "Active"}
                  </span>
                </div>
                <div className="space-y-2">
                  {c.grade && (
                    <p className="text-[11px] text-slate-400 font-semibold flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#1e3a8a] shrink-0" />
                      Grade: {c.grade}
                    </p>
                  )}
                  {c.section && (
                    <p className="text-[11px] text-slate-400 font-semibold flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                      Section: {c.section}
                    </p>
                  )}
                  {c.subject && (
                    <p className="text-[11px] text-slate-400 font-semibold flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      Subject: {c.subject}
                    </p>
                  )}
                  {(c.totalStudents || c.studentCount) && (
                    <p className="text-[11px] text-slate-400 font-semibold flex items-center gap-2">
                      <Users className="w-3 h-3" />
                      {c.totalStudents || c.studentCount} Students
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
