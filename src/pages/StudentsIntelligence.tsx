import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, orderBy, where } from "firebase/firestore";
import {
  Users, Search, Plus, Filter, TrendingUp, TrendingDown,
  ChevronLeft, ChevronRight, X, Loader2
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line
} from "recharts";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const GRADE_COLORS = ["#1e3a8a","#2563eb","#3b82f6","#60a5fa","#93c5fd","#bfdbfe"];

/* normalise "6" / "Class 6" / "Grade 6" / "VI" → "Grade 6" */
function normalizeGrade(raw: string): string {
  if (!raw) return "";
  const s = raw.trim();
  const num = s.match(/\d+/);
  if (num) return `Grade ${num[0]}`;
  // roman numerals up to 12
  const roman: Record<string,string> = {
    I:"1",II:"2",III:"3",IV:"4",V:"5",VI:"6",VII:"7",
    VIII:"8",IX:"9",X:"10",XI:"11",XII:"12"
  };
  const up = s.toUpperCase();
  if (roman[up]) return `Grade ${roman[up]}`;
  return s;
}

/* ── risk helpers ─────────────────────────────────── */
function getRisk(score: number): { label: string; color: string; bg: string } {
  if (score >= 75) return { label: "Low",    color: "text-green-600",  bg: "bg-green-50"  };
  if (score >= 50) return { label: "Medium", color: "text-amber-600",  bg: "bg-amber-50"  };
  return              { label: "High",   color: "text-red-600",    bg: "bg-red-50"    };
}

function getInitials(name: string) {
  return (name || "?").split(" ").map(n=>n[0]).join("").toUpperCase().slice(0,2);
}

function getAvatarColor(score: number) {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

function getHeatColor(v: number) {
  if (v >= 95) return "bg-green-600 text-white";
  if (v >= 85) return "bg-amber-500 text-white";
  return "bg-red-500 text-white";
}

const PAGE_SIZE = 10;

export default function StudentsIntelligence() {
  const navigate = useNavigate();
  /* ── raw data ───────────────────────────────────── */
  const [students,   setStudents]   = useState<any[]>([]);
  const [schools,    setSchools]    = useState<Map<string,string>>(new Map());
  // heatRaw: branchName → grade → {p, t}
  const [heatRaw,    setHeatRaw]    = useState<Map<string, Map<string,{p:number;t:number}>>>(new Map());
  const [loading,    setLoading]    = useState(true);

  /* ── UI state ───────────────────────────────────── */
  const [search,      setSearch]      = useState("");
  const [page,        setPage]        = useState(1);
  const [selected,    setSelected]    = useState<any | null>(null);
  const [heatBranch,  setHeatBranch]  = useState("All");
  const [tableBranch, setTableBranch] = useState("All");

  /* ── per-student detail data ─────────────────────── */
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTrend,   setDetailTrend]   = useState<{ month: string; score: number; attendance: number }[]>([]);
  const [attDelta,      setAttDelta]      = useState<number | null>(null);   // % diff last30 vs prev30
  const [scoreDelta,    setScoreDelta]    = useState<number | null>(null);   // pts diff last 2 exams
  const [att30,         setAtt30]         = useState<number | null>(null);   // last-30-day att %

  /* ── fetch everything ───────────────────────────── */
  useEffect(() => {
    const go = async () => {
      try {
        /* 1. branches subcollection: schools/{ownerUid}/branches */
        const ownerUid = auth.currentUser?.uid;
        const branchMap = new Map<string, string>(); // branchId → branchName
        if (ownerUid) {
          const branchSnap = await getDocs(
            collection(db, "schools", ownerUid, "branches")
          );
          branchSnap.docs.forEach(d => {
            const data = d.data() as any;
            const bname = data.name || data.branchName || "";
            const bid   = data.branchId || d.id;
            if (bname && bid) branchMap.set(bid, bname);
          });
        }
        // also build schoolId→branchName for fallback (top-level schools docs)
        const schoolMap = new Map<string, string>(); // schoolId → branchName (fallback)
        const schoolsSnap = await getDocs(collection(db, "schools"));
        schoolsSnap.docs.forEach(d => {
          const data = d.data() as any;
          const sname = data.name || data.schoolName || "";
          if (sname) schoolMap.set(d.id, sname);
        });
        setSchools(branchMap); // store branchId→name for dropdown

        /* 2. all enrollments */
        const enrollSnap = await getDocs(collection(db, "enrollments"));
        const enrollments = enrollSnap.docs.map(d => ({ _eid: d.id, ...d.data() as any }));

        /* 3. test_scores: studentId → avg score */
        const scoresSnap = await getDocs(collection(db, "test_scores"));
        const scoreMap   = new Map<string, number[]>();
        scoresSnap.docs.forEach(d => {
          const data = d.data() as any;
          const key  = data.studentId || data.studentEmail || "";
          const pct  = parseFloat(data.percentage ?? data.score ?? "");
          if (key && !isNaN(pct)) {
            if (!scoreMap.has(key)) scoreMap.set(key, []);
            scoreMap.get(key)!.push(pct);
          }
        });

        /* 4. attendance records */
        const attSnap  = await getDocs(collection(db, "attendance"));

        /* build student→grade and student→schoolId lookup from enrollments */
        const stuGradeMap  = new Map<string,string>();
        const stuSchoolMap = new Map<string,string>();
        enrollments.forEach(e => {
          const sid = e.studentId || e.studentEmail || e._eid;
          const g   = normalizeGrade(e.grade || e.class || e.className || "");
          if (g)           stuGradeMap.set(sid, g);
          // store branchId for heatmap grouping
          if (e.branchId)  stuSchoolMap.set(sid, e.branchId);
          else if (e.schoolId) stuSchoolMap.set(sid, e.schoolId);
        });

        /* studentId → { present, total } for per-student attendance % */
        const attMap   = new Map<string,{p:number;t:number}>();
        /* branchName → grade → { present, total } for heatmap */
        const heatMap  = new Map<string, Map<string,{p:number;t:number}>>();

        attSnap.docs.forEach(d => {
          const data    = d.data() as any;
          const sid     = data.studentId || data.studentEmail || "";
          if (!sid) return;

          /* per-student map */
          if (!attMap.has(sid)) attMap.set(sid, {p:0,t:0});
          const cur = attMap.get(sid)!;
          cur.t++;
          const isPresent = (data.status||"").toLowerCase() === "present";
          if (isPresent) cur.p++;

          /* heatmap map — resolve branchId → branchName */
          const bid    = data.branchId || stuSchoolMap.get(sid) || "";
          const branch = branchMap.get(bid) || schoolMap.get(bid) || schoolMap.get(data.schoolId || "") || data.schoolName || "";
          const grade  = normalizeGrade(data.grade || data.class || stuGradeMap.get(sid) || "");
          if (!branch || !grade) return;

          if (!heatMap.has(branch)) heatMap.set(branch, new Map());
          const gm = heatMap.get(branch)!;
          if (!gm.has(grade)) gm.set(grade, {p:0,t:0});
          const hc = gm.get(grade)!;
          hc.t++;
          if (isPresent) hc.p++;
        });

        setHeatRaw(heatMap);

        /* 5. discipline: studentId → count */
        const discSnap = await getDocs(collection(db, "discipline"));
        const discMap  = new Map<string,number>();
        discSnap.docs.forEach(d => {
          const key = (d.data() as any).studentId || (d.data() as any).studentEmail || "";
          if (key) discMap.set(key, (discMap.get(key)||0)+1);
        });

        /* 6. enrich enrollment rows */
        const enriched = enrollments.map(e => {
          const sid    = e.studentId || e.studentEmail || e._eid;
          const scores = scoreMap.get(sid) || [];
          const avgScore = scores.length
            ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length)
            : 0;
          const att    = attMap.get(sid);
          const attPct = att && att.t > 0 ? Math.round((att.p/att.t)*100) : 0;
          const incidents = discMap.get(sid) || 0;

          return {
            id:          sid,
            _eid:        e._eid,
            name:        e.studentName || e.name || "Unknown",
            grade:       normalizeGrade(e.grade || e.class || e.className || "") || "—",
            schoolId:    e.schoolId || "",
            branch:      branchMap.get(e.branchId) || branchMap.get(e.schoolId) || schoolMap.get(e.schoolId) || e.schoolName || "—",
            score:       avgScore,
            attendance:  attPct,
            incidents,
            createdAt:   e.createdAt,
          };
        });

        enriched.sort((a,b)=>(a.name||"").localeCompare(b.name||""));
        setStudents(enriched);
      } catch(e) {
        console.error(e);
      }
      setLoading(false);
    };
    go();
  }, []);

  /* ── derived stats ──────────────────────────────── */
  const totalEnrollment = students.length;

  const avgAttendance = useMemo(() => {
    const list = students.filter(s=>s.attendance>0);
    return list.length ? Math.round(list.reduce((s,x)=>s+x.attendance,0)/list.length*10)/10 : 0;
  }, [students]);

  const atRisk = useMemo(() => students.filter(s=>s.score>0 && s.score<50).length, [students]);

  const highPerformers = useMemo(() => students.filter(s=>s.score>=85).length, [students]);

  /* ── grade distribution for pie ─────────────────── */
  const gradeDistData = useMemo(() => {
    const map: Record<string,number> = {};
    students.forEach(s => { map[s.grade] = (map[s.grade]||0)+1; });
    return Object.entries(map)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,6)
      .map(([name,value],i)=>({ name, value, fill: GRADE_COLORS[i]||"#94a3b8" }));
  }, [students]);

  /* ── enrollment trend (last 6 months) ───────────── */
  const enrollTrend = useMemo(() => {
    const monthMap: Record<string,number> = {};
    students.forEach(s => {
      const d = s.createdAt?.toDate?.();
      if (d) { const k = MONTH_NAMES[d.getMonth()]; monthMap[k]=(monthMap[k]||0)+1; }
    });
    const now  = new Date();
    return Array.from({length:6},(_,i)=>{
      const d = new Date(now.getFullYear(), now.getMonth()-5+i, 1);
      const m = MONTH_NAMES[d.getMonth()];
      return { month:m, value: monthMap[m]||0 };
    });
  }, [students]);

  /* ── performance by branch ──────────────────────── */
  const perfByBranch = useMemo(() => {
    const map: Record<string,number[]> = {};
    students.forEach(s => {
      if (!s.branch || s.branch==="—" || !s.score) return;
      if (!map[s.branch]) map[s.branch]=[];
      map[s.branch].push(s.score);
    });
    return Object.entries(map).map(([branch,scores])=>({
      branch: branch.length > 8 ? branch.split(" ")[0] : branch,
      value: Math.round(scores.reduce((a,b)=>a+b,0)/scores.length),
    }));
  }, [students]);

  /* ── branch list for dropdowns — from branches subcollection ── */
  const branchList = useMemo(() =>
    ["All", ...[...schools.values()].filter(Boolean).sort()],
  [schools]); // schools state now holds branchId→branchName from subcollection

  /* ── attendance heatmap — built from raw attendance records ── */
  const heatmapGrades = useMemo(() => {
    const gradeSet = new Set<string>();
    if (heatBranch !== "All") {
      heatRaw.get(heatBranch)?.forEach((_, g) => gradeSet.add(g));
    } else {
      heatRaw.forEach(gm => gm.forEach((_, g) => gradeSet.add(g)));
    }
    return [...gradeSet].sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || "0");
      const nb = parseInt(b.match(/\d+/)?.[0] || "0");
      return na - nb;
    });
  }, [heatRaw, heatBranch]);

  const heatmapData = useMemo(() => {
    const rows: { branch: string; cells: number[] }[] = [];
    const source: [string, Map<string, { p: number; t: number }>][] =
      heatBranch !== "All"
        ? heatRaw.has(heatBranch) ? [[heatBranch, heatRaw.get(heatBranch)!]] : []
        : [...heatRaw.entries()];
    source.forEach(([branch, gradeMap]) => {
      rows.push({
        branch,
        cells: heatmapGrades.map(grade => {
          const entry = gradeMap.get(grade);
          return entry && entry.t > 0 ? Math.round((entry.p / entry.t) * 100) : 0;
        }),
      });
    });
    return rows;
  }, [heatRaw, heatmapGrades, heatBranch]);

  /* ── filtered & paginated ───────────────────────── */
  const filtered = useMemo(() =>
    students.filter(s =>
      (s.name || "").toLowerCase().includes(search.toLowerCase()) &&
      (tableBranch === "All" || s.branch === tableBranch)
    ),
  [students, search, tableBranch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageStudents = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);

  /* group by first letter */
  const grouped = useMemo(() => {
    const map: Record<string,any[]> = {};
    pageStudents.forEach(s => {
      const key = (s.name||"?")[0].toUpperCase();
      if (!map[key]) map[key]=[];
      map[key].push(s);
    });
    return Object.entries(map).sort(([a],[b])=>a.localeCompare(b));
  }, [pageStudents]);

  /* ── fetch real per-student detail when selection changes ── */
  useEffect(() => {
    if (!selected) return;
    setDetailLoading(true);
    setDetailTrend([]);
    setAttDelta(null);
    setScoreDelta(null);
    setAtt30(null);

    const sid = selected.id; // studentId or studentEmail

    const fetchDetail = async () => {
      try {
        const now      = new Date();
        const ms30     = 30 * 24 * 60 * 60 * 1000;
        const cut30    = new Date(now.getTime() - ms30);
        const cut60    = new Date(now.getTime() - ms30 * 2);

        /* ── 1. test_scores for this student ── */
        const [byId, byEmail] = await Promise.all([
          getDocs(query(collection(db, "test_scores"),
            where("studentId", "==", sid))),
          getDocs(query(collection(db, "test_scores"),
            where("studentEmail", "==", sid))),
        ]);
        // deduplicate by doc id
        const seenScore = new Set<string>();
        const scoreDocs: any[] = [];
        [...byId.docs, ...byEmail.docs].forEach(d => {
          if (!seenScore.has(d.id)) { seenScore.add(d.id); scoreDocs.push({ _id: d.id, ...d.data() as any }); }
        });
        // sort ascending by timestamp (field name is "timestamp" in test_scores)
        scoreDocs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

        /* last-2-exam delta */
        const pcts = scoreDocs
          .map(d => parseFloat(d.percentage ?? d.score ?? ""))
          .filter(n => !isNaN(n));
        if (pcts.length >= 2) {
          setScoreDelta(Math.round(pcts[pcts.length - 1] - pcts[pcts.length - 2]));
        } else {
          setScoreDelta(null);
        }

        /* month-wise average score — last 6 months */
        const scoreByMonth = new Map<string, number[]>();
        scoreDocs.forEach(d => {
          // date field is "timestamp" (Firestore Timestamp)
          const date = d.timestamp?.toDate?.();
          if (!date) return;
          const key = MONTH_NAMES[date.getMonth()];
          const pct = parseFloat(d.percentage ?? d.score ?? "");
          if (!isNaN(pct)) {
            if (!scoreByMonth.has(key)) scoreByMonth.set(key, []);
            scoreByMonth.get(key)!.push(pct);
          }
        });

        /* ── 2. attendance for this student ── */
        const [attById, attByEmail] = await Promise.all([
          getDocs(query(collection(db, "attendance"),
            where("studentId", "==", sid))),
          getDocs(query(collection(db, "attendance"),
            where("studentEmail", "==", sid))),
        ]);
        // deduplicate
        const seenAtt = new Set<string>();
        const attDocs: any[] = [];
        [...attById.docs, ...attByEmail.docs].forEach(d => {
          if (!seenAtt.has(d.id)) { seenAtt.add(d.id); attDocs.push(d.data() as any); }
        });

        /* last-30-day vs prev-30-day attendance % */
        let l30p = 0, l30t = 0, p30p = 0, p30t = 0;
        const attByMonth = new Map<string, { p: number; t: number }>();

        attDocs.forEach(d => {
          // "date" is stored as "YYYY-MM-DD" string; "timestamp" is Firestore Timestamp
          let date: Date | null = null;
          if (d.timestamp?.toDate) {
            date = d.timestamp.toDate();
          } else if (typeof d.date === "string" && d.date) {
            date = new Date(d.date + "T00:00:00");
          }
          const isPresent = (d.status || "").toLowerCase() === "present";

          if (date && !isNaN(date.getTime())) {
            if (date >= cut30)       { l30t++; if (isPresent) l30p++; }
            else if (date >= cut60)  { p30t++; if (isPresent) p30p++; }

            const key = MONTH_NAMES[date.getMonth()];
            if (!attByMonth.has(key)) attByMonth.set(key, { p: 0, t: 0 });
            const m = attByMonth.get(key)!;
            m.t++;
            if (isPresent) m.p++;
          }
        });

        const last30Pct  = l30t > 0 ? Math.round((l30p / l30t) * 100) : null;
        const prev30Pct  = p30t > 0 ? Math.round((p30p / p30t) * 100) : null;
        setAtt30(last30Pct);
        setAttDelta(last30Pct !== null && prev30Pct !== null
          ? last30Pct - prev30Pct : null);

        /* ── 3. build trend: last 6 months ── */
        const trend = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
          const m = MONTH_NAMES[d.getMonth()];
          const sc = scoreByMonth.get(m);
          const at = attByMonth.get(m);
          return {
            month:      m,
            score:      sc ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : 0,
            attendance: at && at.t > 0 ? Math.round((at.p / at.t) * 100) : 0,
          };
        });
        setDetailTrend(trend);
      } catch (e) {
        console.error(e);
      }
      setDetailLoading(false);
    };

    fetchDetail();
  }, [selected?.id]);

  /* ─────────────────────────────────────────────────── */
  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">

      {/* ── Header ──────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#1e294b] tracking-tight">Students Intelligence</h1>
          <p className="text-slate-500 text-xs md:text-sm font-medium">Enrollment, performance &amp; behavior analytics</p>
        </div>
        <button className="flex items-center justify-center gap-2 bg-[#1e3a8a] text-white font-bold h-10 md:h-11 rounded-xl px-6 shadow-lg shadow-blue-900/15 hover:bg-[#1e4fc0] transition-all text-xs md:text-sm">
          <Plus className="w-4 h-4" /> Add Student
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-[#1e3a8a]" />
        </div>
      ) : (
        <>
          {/* ── Stat Cards ────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {[
              { label:"Total Enrollment",   value: totalEnrollment.toLocaleString(), sub:`+124 this term`,        color:"text-green-600", route: "/students" },
              { label:"Average Attendance", value:`${avgAttendance}%`,               sub:"+0.5% vs last month",   color:"text-green-600", route: "/students" },
              { label:"At-Risk Students",   value: atRisk.toString(),                sub:`${totalEnrollment>0?((atRisk/totalEnrollment)*100).toFixed(1):0}% of total`, color:"text-red-500", route: "/risks" },
              { label:"High Performers",    value: highPerformers.toString(),         sub:`${totalEnrollment>0?((highPerformers/totalEnrollment)*100).toFixed(1):0}% of total`, color:"text-green-600", route: "/students" },
            ].map(s=>(
              <div
                key={s.label}
                onClick={() => navigate(s.route)}
                role="button"
                tabIndex={0}
                className="clickable-card bg-white p-5 md:p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all"
              >
                <p className="text-slate-400 text-[10px] md:text-[11px] font-bold uppercase tracking-widest mb-1 md:mb-2">{s.label}</p>
                <h3 className="text-3xl md:text-4xl font-extrabold text-[#1e294b] tracking-tight mb-1">{s.value}</h3>
                <p className={`text-[10px] md:text-[11px] font-bold ${s.color}`}>{s.sub}</p>
              </div>
            ))}
          </div>

          {/* ── Charts Row ────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Grade Distribution */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-sm">
              <h3 className="text-sm md:text-base font-bold text-[#1e294b] mb-4">Grade Distribution</h3>
              <div className="h-[220px] md:h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={gradeDistData.length ? gradeDistData : [{name:"No Data",value:1,fill:"#e2e8f0"}]}
                      cx="50%" cy="50%"
                      outerRadius={95}
                      dataKey="value"
                      stroke="#fff" strokeWidth={2}
                      label={({name,midAngle,cx,cy,outerRadius:or})=>{
                        const R=Math.PI/180;
                        const x=cx+(or+22)*Math.cos(-midAngle*R);
                        const y=cy+(or+22)*Math.sin(-midAngle*R);
                        return <text x={x} y={y} fill="#94a3b8" fontSize={10} fontWeight="bold" textAnchor={x>cx?"start":"end"} dominantBaseline="central">{name}</text>;
                      }}
                    >
                      {gradeDistData.map((e,i)=><Cell key={i} fill={e.fill}/>)}
                    </Pie>
                    <Tooltip contentStyle={{borderRadius:"12px",border:"none",boxShadow:"0 10px 15px rgba(0,0,0,0.1)"}}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Enrollment Trend */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-sm">
              <h3 className="text-sm md:text-base font-bold text-[#1e294b] mb-4">Enrollment Trend</h3>
              <div className="h-[220px] md:h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={enrollTrend} margin={{top:10,right:10,left:-20,bottom:0}}>
                    <defs>
                      <linearGradient id="enGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#1e3a8a" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill:"#94a3b8",fontSize:11,fontWeight:600}}/>
                    <YAxis axisLine={false} tickLine={false} tick={{fill:"#94a3b8",fontSize:11,fontWeight:600}}/>
                    <Tooltip contentStyle={{borderRadius:"12px",border:"none",boxShadow:"0 10px 15px rgba(0,0,0,0.1)"}}/>
                    <Area type="monotone" dataKey="value" stroke="#1e3a8a" strokeWidth={3} fill="url(#enGrad)"
                      dot={{r:4,fill:"#1e3a8a",strokeWidth:2,stroke:"#fff"}}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Performance by Branch */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-sm">
              <h3 className="text-sm md:text-base font-bold text-[#1e294b] mb-4">Performance by Branch</h3>
              <div className="h-[220px] md:h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={perfByBranch.length ? perfByBranch : [{branch:"No Data",value:0}]}
                    layout="vertical"
                    margin={{left:0,right:40,top:10,bottom:10}}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9"/>
                    <XAxis type="number" domain={[0,100]} axisLine={false} tickLine={false}
                      tick={{fill:"#94a3b8",fontSize:11}} ticks={[0,20,40,60,80,100]}/>
                    <YAxis dataKey="branch" type="category" axisLine={false} tickLine={false}
                      tick={{fill:"#64748b",fontSize:12,fontWeight:700}} width={55}/>
                    <Tooltip contentStyle={{borderRadius:"12px",border:"none",boxShadow:"0 10px 15px rgba(0,0,0,0.1)"}}/>
                    <Bar dataKey="value" radius={[0,6,6,0]} barSize={26}
                      label={{position:"right",fill:"#64748b",fontSize:12,fontWeight:700,formatter:(v:any)=>`${v}%`}}>
                      {perfByBranch.map((e,i)=>(
                        <Cell key={i} fill={e.value>=80?"#16a34a":e.value>=60?"#f59e0b":"#ef4444"}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── Attendance Heatmap ────────────────────── */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <h3 className="text-sm md:text-base font-bold text-[#1e294b]">Attendance Heatmap</h3>
              <div className="flex flex-wrap items-center gap-3 sm:gap-6">
                {/* Branch selector */}
                <select
                  value={heatBranch}
                  onChange={e => setHeatBranch(e.target.value)}
                  className="border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-600 bg-slate-50 outline-none w-full sm:w-auto"
                >
                  {branchList.map(b => <option key={b} value={b}>{b === "All" ? "All Branches" : b}</option>)}
                </select>
                {/* Legend */}
                <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                  {[["bg-green-600","95%+"],["bg-amber-500","85-94%"],["bg-red-500","<85%"]].map(([c,l])=>(
                    <div key={l} className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${c}`}/>
                      <span className="text-[10px] font-bold text-slate-600">{l}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto pb-4">
              <div className="min-w-[600px]">
                {/* Grade headers */}
                <div className="grid gap-2 mb-2" style={{gridTemplateColumns:`140px repeat(${Math.max(heatmapGrades.length,1)},1fr)`}}>
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Branch</div>
                  {heatmapGrades.map(g=>(
                    <div key={g} className="text-center text-[9px] font-bold text-slate-400 uppercase tracking-wide">{g}</div>
                  ))}
                </div>
                {/* Rows */}
                {heatmapData.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-400 font-semibold">No attendance data yet</div>
                ) : (
                  heatmapData.map(row=>(
                    <div key={row.branch} className="grid gap-2 mb-2" style={{gridTemplateColumns:`140px repeat(${Math.max(heatmapGrades.length,1)},1fr)`}}>
                      <div className="flex items-center">
                        <span className="text-[10px] font-bold text-slate-500 tracking-tight truncate pr-2">{row.branch}</span>
                      </div>
                      {row.cells.map((val,i)=>(
                        <div key={i} className={`h-10 rounded-lg flex items-center justify-center font-bold text-xs transition-transform hover:scale-105 ${
                          val>0 ? getHeatColor(val) : "bg-slate-100 text-slate-400"
                        }`}>
                          {val>0 ? `${val}%` : "—"}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ── Student Table ─────────────────────────── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            {/* Table header + search */}
            <div className="p-4 md:px-6 md:py-4 border-b border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/>
                <input
                  value={search}
                  onChange={e=>{setSearch(e.target.value);setPage(1);}}
                  placeholder="Search students..."
                  className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-[#1e3a8a]/10 bg-slate-50"
                />
              </div>
              {/* Branch filter dropdown */}
              <div className="flex items-center gap-2">
                <select
                  value={tableBranch}
                  onChange={e=>{setTableBranch(e.target.value);setPage(1);}}
                  className="flex-1 sm:w-40 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-600 bg-slate-50 outline-none"
                >
                  {branchList.map(b=><option key={b} value={b}>{b === "All" ? "All Branches" : b}</option>)}
                </select>
                <button className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50">
                  <Filter className="w-3.5 h-3.5"/> Filters
                </button>
              </div>
            </div>

            {/* Columns */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/30">
                    <th className="px-5 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">Student</th>
                    <th className="hidden sm:table-cell px-5 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">Grade</th>
                    <th className="hidden md:table-cell px-5 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">Branch</th>
                    <th className="px-5 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">Attendance</th>
                    <th className="px-5 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">Score</th>
                    <th className="px-5 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(([letter, rows])=>(
                    <>
                      {/* Alphabet group header */}
                      <tr key={`hdr-${letter}`} className="bg-slate-50/60">
                        <td colSpan={7} className="px-6 py-2 text-xs font-extrabold text-slate-400 uppercase tracking-widest">{letter}</td>
                      </tr>
                      {rows.map(s=>{
                        const risk = getRisk(s.score);
                        return (
                          <tr key={s._eid}
                            className={`border-b border-slate-50 hover:bg-slate-50/50 transition-all ${selected?._eid===s._eid?"bg-blue-50/30":""}`}
                          >
                            <td className="px-5 py-3">
                               <div className="flex items-center gap-3">
                                 <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-[10px] font-black shrink-0 ${getAvatarColor(s.score)}`}>
                                   {getInitials(s.name)}
                                 </div>
                                 <div className="min-w-0">
                                   <p className="text-xs font-bold text-[#1e294b] truncate">{s.name}</p>
                                   <p className="text-[10px] text-slate-400 font-bold truncate">ID: {s.id.length>8?s.id.slice(0,8):s.id}</p>
                                 </div>
                               </div>
                            </td>
                            <td className="hidden sm:table-cell px-5 py-3 text-xs font-bold text-slate-500">{s.grade}</td>
                            <td className="hidden md:table-cell px-5 py-3 text-xs font-bold text-slate-500">{s.branch}</td>
                            <td className="px-5 py-3 text-xs font-extrabold text-[#1e294b]">
                              {s.attendance>0?`${s.attendance}%`:"—"}
                            </td>
                            <td className="px-5 py-3">
                               <div className="flex flex-col">
                                 <span className="text-xs font-extrabold text-[#1e294b]">{s.score>0?`${s.score}%`:"—"}</span>
                                 <span className={`text-[9px] font-black uppercase ${risk.color}`}>{risk.label}</span>
                               </div>
                            </td>
                            <td className="px-5 py-3">
                              <button
                                onClick={()=>setSelected(selected?._eid===s._eid ? null : s)}
                                className="text-xs font-black text-[#1e3a8a] bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
                              >
                                {selected?._eid===s._eid ? "Close" : "View"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  ))}
                  {filtered.length===0 && (
                    <tr><td colSpan={6} className="py-16 text-center text-xs text-slate-400 font-bold uppercase tracking-widest">No scholars found</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="p-4 md:px-6 md:py-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Showing {Math.min((page-1)*PAGE_SIZE+1, filtered.length)}–{Math.min(page*PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-1.5 md:gap-2">
                <button
                  disabled={page===1}
                  onClick={()=>setPage(p=>p-1)}
                  className="px-2 md:px-3 py-1.5 border border-slate-200 rounded-lg text-[10px] font-black text-slate-400 hover:bg-slate-50 disabled:opacity-30"
                >Prev</button>
                {Array.from({length:Math.min(totalPages,3)},(_,i)=>i+1).map(n=>(
                  <button key={n} onClick={()=>setPage(n)}
                    className={`w-7 h-7 md:w-8 md:h-8 rounded-lg text-[10px] font-black transition-all ${page===n?"bg-[#1e3a8a] text-white shadow-md":"border border-slate-200 text-slate-400 hover:bg-slate-50"}`}>
                    {n}
                  </button>
                ))}
                <button
                  disabled={page===totalPages}
                  onClick={()=>setPage(p=>p+1)}
                  className="px-2 md:px-3 py-1.5 border border-slate-200 rounded-lg text-[10px] font-black text-slate-400 hover:bg-slate-50 disabled:opacity-30"
                >Next</button>
              </div>
            </div>
          </div>

          {/* ── Student Detail Panel ─────────────────── */}
          {selected && (()=>{
            const risk = getRisk(selected.score);
            const isCritical = selected.score < 50;
            return (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
                {/* Detail header */}
                <div className="p-5 md:px-6 md:py-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-5">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center text-white font-black text-base md:text-lg shrink-0 ${getAvatarColor(selected.score)}`}>
                      {getInitials(selected.name)}
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base md:text-lg font-black text-[#1e294b] truncate">{selected.name}</h2>
                      <p className="text-[10px] md:text-xs text-slate-400 font-bold uppercase tracking-tight truncate">
                        {selected.grade} &bull; {selected.branch}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between md:justify-end gap-3 w-full md:w-auto">
                    <span className={`text-[10px] font-black px-3 py-1.5 rounded-lg text-white ${getAvatarColor(selected.score)} uppercase tracking-widest`}>
                      {risk.label} Risk
                    </span>
                    <button className="flex-1 md:flex-none bg-[#1e3a8a] text-white text-[10px] font-black px-4 py-2 rounded-xl shadow-md">
                      Contact Parent
                    </button>
                    <button onClick={()=>setSelected(null)} className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-400">
                      <X className="w-4 h-4"/>
                    </button>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  {/* 3 stat cards */}
                  {(() => {
                    const attDisplay  = att30 !== null ? `${att30}%` : (selected.attendance > 0 ? `${selected.attendance}%` : "—");
                    const attSubText  = attDelta !== null
                      ? `${attDelta >= 0 ? "↑" : "↓"} ${Math.abs(attDelta)}% vs last month`
                      : "No comparison data";
                    const attSubColor = attDelta === null ? "text-slate-400"
                      : attDelta >= 0 ? "text-green-500" : "text-red-400";

                    const scoreDisplay = selected.score > 0 ? `${selected.score}/100` : "—";
                    const scoreSubText = scoreDelta !== null
                      ? `${scoreDelta >= 0 ? "↑" : "↓"} ${Math.abs(scoreDelta)} pts from last exam`
                      : "No previous exam";
                    const scoreSubColor = scoreDelta === null ? "text-slate-400"
                      : scoreDelta >= 0 ? "text-green-500" : "text-red-400";

                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-5">
                          <p className="text-xs font-semibold text-slate-500 mb-2">Attendance (Last 30 Days)</p>
                          <p className={`text-3xl font-extrabold ${isCritical ? "text-red-500" : "text-[#1e294b]"}`}>{attDisplay}</p>
                          <p className={`text-xs font-semibold mt-1 ${attSubColor}`}>{attSubText}</p>
                        </div>
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-5">
                          <p className="text-xs font-semibold text-slate-500 mb-2">Academic Score</p>
                          <p className={`text-3xl font-extrabold ${isCritical ? "text-red-500" : "text-[#1e294b]"}`}>{scoreDisplay}</p>
                          <p className={`text-xs font-semibold mt-1 ${scoreSubColor}`}>{scoreSubText}</p>
                        </div>
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-5">
                          <p className="text-xs font-semibold text-slate-500 mb-2">Behavior Incidents</p>
                          <p className="text-3xl font-extrabold text-[#1e294b]">{selected.incidents}</p>
                          <p className="text-xs font-semibold mt-1 text-slate-400">This term</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Performance trend */}
                  <div>
                    <h3 className="text-sm font-bold text-[#1e294b] mb-4">Performance Trend</h3>
                    {detailLoading ? (
                      <div className="h-[200px] flex items-center justify-center">
                        <Loader2 className="w-6 h-6 animate-spin text-[#1e3a8a]" />
                      </div>
                    ) : detailTrend.every(d => d.score === 0 && d.attendance === 0) ? (
                      <div className="h-[200px] flex items-center justify-center text-sm text-slate-400 font-semibold">
                        No trend data available for this student
                      </div>
                    ) : (
                      <div className="h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={detailTrend} margin={{top:5,right:20,left:-20,bottom:5}}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill:"#94a3b8",fontSize:11}}/>
                            <YAxis axisLine={false} tickLine={false} tick={{fill:"#94a3b8",fontSize:11}} domain={[0,100]}/>
                            <Tooltip contentStyle={{borderRadius:"12px",border:"none",boxShadow:"0 10px 15px rgba(0,0,0,0.1)"}}/>
                            <Line type="monotone" dataKey="score" name="Score" stroke={isCritical?"#ef4444":"#1e3a8a"} strokeWidth={2.5}
                              dot={{r:4,fill:isCritical?"#ef4444":"#1e3a8a",strokeWidth:2,stroke:"#fff"}}
                              connectNulls={false}/>
                            <Line type="monotone" dataKey="attendance" name="Attendance" stroke="#f59e0b" strokeWidth={2.5} strokeDasharray="5 5"
                              dot={{r:4,fill:"#f59e0b",strokeWidth:2,stroke:"#fff"}}
                              connectNulls={false}/>
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
