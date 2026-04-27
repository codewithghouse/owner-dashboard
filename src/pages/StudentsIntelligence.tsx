import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  Users, Search, Plus, Filter, TrendingUp,
  X, Loader2,
  GraduationCap, Award, Percent, AlertTriangle, ArrowUpRight, ArrowDownRight,
  BarChart3, Activity, Sparkles, Mail
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line
} from "recharts";
import { useIsMobile } from "@/hooks/use-mobile";
import { tilt3D, tilt3DStyle } from "@/lib/use3DTilt";
import { GRAD_ACCENTS } from "@/lib/dashboardTokens";

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

const PAGE_SIZE = 10;

export default function StudentsIntelligence() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
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
        if (!ownerUid) { setLoading(false); return; }

        const branchMap = new Map<string, string>(); // branchId → branchName
        const branchSnap = await getDocs(
          collection(db, "schools", ownerUid, "branches")
        );
        branchSnap.docs.forEach(d => {
          const data = d.data() as any;
          const bname = data.name || data.branchName || "";
          const bid   = data.branchId || d.id;
          if (bname && bid) branchMap.set(bid, bname);
        });
        // schoolMap: fallback using this owner's own school doc only (no cross-tenant reads)
        const schoolMap = new Map<string, string>(); // schoolId → branchName (fallback)
        setSchools(branchMap); // store branchId→name for dropdown

        /* 2. enrollments — scoped to this school */
        const enrollSnap = await getDocs(
          query(collection(db, "enrollments"), where("schoolId", "==", ownerUid))
        );
        const enrollments = enrollSnap.docs.map(d => ({ _eid: d.id, ...d.data() as any }));

        /* 3. test_scores: studentId → avg score — scoped */
        const scoresSnap = await getDocs(
          query(collection(db, "test_scores"), where("schoolId", "==", ownerUid))
        );
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

        /* 4. attendance records — scoped */
        const attSnap  = await getDocs(
          query(collection(db, "attendance"), where("schoolId", "==", ownerUid))
        );

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

        /* 5. discipline: studentId → count — scoped */
        const discSnap = await getDocs(
          query(collection(db, "discipline"), where("schoolId", "==", ownerUid))
        );
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

  /* New enrollments this term — students with createdAt in last 4 months */
  const newThisTerm = useMemo(() => {
    const cutoff = Date.now() - (120 * 24 * 60 * 60 * 1000);
    return students.filter(s => {
      const d = s.createdAt?.toDate?.();
      return d && d.getTime() >= cutoff;
    }).length;
  }, [students]);

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

  return (
    <>
      <style>{`
        .stu-row {
          transition: transform .3s ease, background .2s ease;
        }
        .stu-row:hover {
          transform: translateX(4px);
          background: rgba(0,85,255,.04) !important;
        }
        .stu-btn {
          transition: transform .2s ease, box-shadow .2s ease, background .2s ease;
        }
        .stu-btn:hover {
          transform: translateY(-1px);
        }
      `}</style>
      <div
        style={{
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: "#EEF4FF",
          minHeight: "100vh",
          margin: isMobile ? "-12px -12px 0" : "-40px -40px 0",
          padding: isMobile ? "16px 14px 28px" : "24px 32px 40px",
        }}
      >
      {/* ── Page Head ───────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap: isMobile ? 12 : 20, marginBottom: isMobile ? 16 : 22, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 14, minWidth:0, flex: isMobile ? "1 1 auto" : undefined }}>
          <div style={{ width: isMobile ? 40 : 48, height: isMobile ? 40 : 48, borderRadius: isMobile ? 12 : 14, background:GRAD_PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 8px 22px rgba(0,85,255,.35)", flexShrink:0 }}>
            <GraduationCap size={isMobile ? 20 : 24} color="#fff" strokeWidth={2.2}/>
          </div>
          <div style={{ minWidth:0 }}>
            <h1 style={{ fontSize: isMobile ? 20 : 28, fontWeight:700, color:T1, letterSpacing: isMobile ? "-0.4px" : "-0.6px", margin:0, lineHeight:1.15 }}>
              Students Intelligence
            </h1>
            <p style={{ fontSize: isMobile ? 12 : 14, color:T3, fontWeight:500, margin:"4px 0 0 0", letterSpacing:0 }}>
              Enrollment, performance &amp; behavior analytics
            </p>
          </div>
        </div>
        <button
          onClick={()=>navigate("/students")}
          className="stu-btn"
          style={{
            display:"inline-flex", alignItems:"center", justifyContent:"center", gap: isMobile ? 6 : 8,
            padding: isMobile ? "9px 14px" : "11px 18px", borderRadius: isMobile ? 12 : 14,
            background:GRAD_PRIMARY, color:"#fff",
            fontSize: isMobile ? 11 : 12, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase",
            border:"none", cursor:"pointer", boxShadow:SHADOW_BTN, fontFamily:"inherit",
            width: isMobile ? "100%" : "auto",
          }}
        >
          <Plus size={isMobile ? 14 : 16} strokeWidth={2.4}/> Add Student
        </button>
      </div>

      {loading ? (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:260 }}>
          <Loader2 className="animate-spin" size={32} color={B1}/>
        </div>
      ) : (
        <>
          {/* ── Dark Hero Banner ───────────────────────── */}
          <div
            {...tilt3D}
            onClick={()=>navigate("/students")}
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
                  <Users size={isMobile ? 20 : 26} color="#fff" strokeWidth={2.2}/>
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 10px", borderRadius:999, background:"rgba(255,255,255,.14)", border:"0.5px solid rgba(255,255,255,.22)", fontSize: isMobile ? 9 : 10, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:10 }}>
                    <Sparkles size={11}/> Academic Intelligence
                  </div>
                  <h2 style={{ fontSize: isMobile ? 28 : 38, fontWeight:800, letterSpacing: isMobile ? "-0.6px" : "-1px", margin:0, color:"#fff", lineHeight:1 }}>
                    {totalEnrollment.toLocaleString()}
                  </h2>
                  <p style={{ fontSize: isMobile ? 11 : 13, color:"rgba(255,255,255,.72)", fontWeight:500, margin:"8px 0 0 0" }}>
                    Total scholars across {branchList.length-1} branches · {newThisTerm > 0 ? `+${newThisTerm} new this term` : "steady enrollment"}
                  </p>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(3, minmax(120px,1fr))", gap: isMobile ? 8 : 10, width: isMobile ? "100%" : "auto" }}>
                {[
                  { label:"Avg Attendance", value:avgAttendance > 0 ? `${avgAttendance}%` : "—", route:"/students" },
                  { label:"At Risk",        value:atRisk.toString(), route:"/risks" },
                  { label:"High Performers",value:highPerformers.toString(), route:"/students" },
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

          {/* ── Bright Stat Grid ─────────────────────── */}
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 16 : 24, perspective:"1200px" }}>
            {[
              { label:"Total Enrollment", value:totalEnrollment.toLocaleString(), sub:newThisTerm > 0 ? `+${newThisTerm} this term` : "Steady", grad:GRAD_BLUE, icon:Users, delta:newThisTerm > 0 ? "up" : null, route:"/students" },
              { label:"Avg Attendance", value:avgAttendance > 0 ? `${avgAttendance}%` : "—", sub:`Across ${totalEnrollment} students`, grad:GRAD_GREEN, icon:Percent, delta:null, route:"/students" },
              { label:"At-Risk Students", value:atRisk.toString(), sub:`${totalEnrollment>0?((atRisk/totalEnrollment)*100).toFixed(1):0}% of total`, grad:atRisk > 0 ? GRAD_RED : GRAD_GOLD, icon:AlertTriangle, delta:atRisk > 0 ? "down" : null, route:"/risks" },
              { label:"High Performers", value:highPerformers.toString(), sub:`${totalEnrollment>0?((highPerformers/totalEnrollment)*100).toFixed(1):0}% of total`, grad:GRAD_VIOLET, icon:Award, delta:"up", route:"/students" },
            ].map(s=>{
              const Icon = s.icon;
              const accent = GRAD_ACCENTS[s.grad] || "#4F46E5";
              return (
                <div
                  key={s.label}
                  onClick={()=>navigate(s.route)}
                  role="button"
                  tabIndex={0}
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
                    <div style={{ position:"absolute", top: isMobile ? 14 : 20, right: isMobile ? 14 : 20, display:"inline-flex", alignItems:"center", gap:3, padding:"4px 8px", borderRadius:8, background: `${accent}1A`, fontSize:10, fontWeight:800, color: accent, zIndex:1 }}>
                      {s.delta === "up" ? <ArrowUpRight size={11}/> : <ArrowDownRight size={11}/>}
                    </div>
                  )}
                  <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:700, color:"#94A3B8", letterSpacing:"0.10em", textTransform:"uppercase", margin:"0 0 6px 0", position:"relative", zIndex:1 }}>{s.label}</p>
                  <p style={{ fontSize: isMobile ? 22 : 30, fontWeight:800, color:"#0F172A", letterSpacing:"-0.6px", margin:0, lineHeight:1.1, position:"relative", zIndex:1 }}>{s.value}</p>
                  <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:"#64748B", margin:"6px 0 0 0", position:"relative", zIndex:1 }}>{s.sub}</p>
                </div>
              );
            })}
          </div>

          {/* ── Charts Row (3-col) ───────────────────── */}
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 12 : 16, marginBottom: isMobile ? 16 : 24, perspective:"1200px" }}>

            {/* Grade Distribution */}
            <div
              {...tilt3D}
              onClick={()=>navigate("/students")}
              role="button" tabIndex={0}
              style={{
                background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px 14px" : "22px 22px 18px",
                boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
                cursor:"pointer",
                ...tilt3DStyle,
              }}
            >
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                <div>
                  <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Grade Distribution</h3>
                  <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Scholars by grade</p>
                </div>
                <div style={{ width:32, height:32, borderRadius:10, background:"rgba(0,85,255,.08)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <BarChart3 size={16} color={B1} strokeWidth={2.3}/>
                </div>
              </div>
              <div style={{ height:220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={gradeDistData.length ? gradeDistData : [{name:"No Data",value:1,fill:"#e2e8f0"}]}
                      cx="50%" cy="50%" outerRadius={isMobile ? 62 : 78} innerRadius={isMobile ? 30 : 38}
                      dataKey="value" stroke="#fff" strokeWidth={2} paddingAngle={3}
                      label={({name,midAngle,cx,cy,outerRadius:or})=>{
                        const R=Math.PI/180;
                        const x=cx+(or+18)*Math.cos(-midAngle*R);
                        const y=cy+(or+18)*Math.sin(-midAngle*R);
                        return <text x={x} y={y} fill={T3} fontSize={10} fontWeight="700" textAnchor={x>cx?"start":"end"} dominantBaseline="central">{name}</text>;
                      }}
                    >
                      {(gradeDistData.length?gradeDistData:[{fill:"#e2e8f0"}]).map((e:any,i:number)=><Cell key={i} fill={e.fill}/>)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Enrollment Trend */}
            <div
              {...tilt3D}
              onClick={()=>navigate("/students")}
              role="button" tabIndex={0}
              style={{
                background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px 14px" : "22px 22px 18px",
                boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
                cursor:"pointer",
                ...tilt3DStyle,
              }}
            >
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                <div>
                  <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Enrollment Trend</h3>
                  <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Last 6 months</p>
                </div>
                <div style={{ width:32, height:32, borderRadius:10, background:"rgba(123,63,244,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <TrendingUp size={16} color={VIOLET} strokeWidth={2.3}/>
                </div>
              </div>
              <div style={{ height:220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={enrollTrend} margin={{top:5,right:10,left:-22,bottom:0}}>
                    <defs>
                      <linearGradient id="enGradOw" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={B1} stopOpacity={0.22}/>
                        <stop offset="95%" stopColor={B1} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill:T3,fontSize:11,fontWeight:600}}/>
                    <YAxis axisLine={false} tickLine={false} tick={{fill:T3,fontSize:11,fontWeight:600}}/>
                    <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }}/>
                    <Area type="monotone" dataKey="value" stroke={B1} strokeWidth={3} fill="url(#enGradOw)"
                      dot={{r:4,fill:B1,strokeWidth:2,stroke:"#fff"}} activeDot={{r:6}}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Performance by Branch */}
            <div
              {...tilt3D}
              onClick={()=>navigate("/branches")}
              role="button" tabIndex={0}
              style={{
                background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px 14px" : "22px 22px 18px",
                boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
                cursor:"pointer",
                ...tilt3DStyle,
              }}
            >
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                <div>
                  <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Performance by Branch</h3>
                  <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Avg scores</p>
                </div>
                <div style={{ width:32, height:32, borderRadius:10, background:"rgba(0,200,83,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Activity size={16} color={GREEN} strokeWidth={2.3}/>
                </div>
              </div>
              <div style={{ height:220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={perfByBranch.length ? perfByBranch : [{branch:"No Data",value:0}]}
                    layout="vertical"
                    margin={{left:0,right:40,top:5,bottom:5}}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,85,255,.07)"/>
                    <XAxis type="number" domain={[0,100]} axisLine={false} tickLine={false}
                      tick={{fill:T3,fontSize:11,fontWeight:600}} ticks={[0,25,50,75,100]}/>
                    <YAxis dataKey="branch" type="category" axisLine={false} tickLine={false}
                      tick={{fill:T3,fontSize:11,fontWeight:700}} width={60}/>
                    <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }} cursor={{fill:"rgba(0,85,255,.04)"}}/>
                    <Bar dataKey="value" radius={[0,6,6,0]} barSize={22}
                      label={{position:"right",fill:T3,fontSize:11,fontWeight:700,formatter:(v:any)=>`${v}%`}}>
                      {perfByBranch.map((e,i)=>(
                        <Cell key={i} fill={e.value>=80?GREEN:e.value>=60?GOLD:RED}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── Attendance Heatmap ───────────────────── */}
          <div
            {...tilt3D}
            onClick={()=>navigate("/students")}
            role="button" tabIndex={0}
            style={{
              background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px" : "22px 24px",
              boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
              marginBottom: isMobile ? 16 : 24, perspective:"1200px",
              cursor:"pointer",
              ...tilt3DStyle,
            }}
          >
            <div style={{ display:"flex", alignItems: isMobile ? "flex-start" : "center", justifyContent:"space-between", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 14 : 20, flexWrap:"wrap" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:36, height:36, borderRadius:11, background:GRAD_PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 6px 14px rgba(0,85,255,.28)" }}>
                  <Percent size={18} color="#fff" strokeWidth={2.3}/>
                </div>
                <div>
                  <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Attendance Heatmap</h3>
                  <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Branch × grade</p>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                <select
                  value={heatBranch}
                  onChange={e=>setHeatBranch(e.target.value)}
                  onClick={e=>e.stopPropagation()}
                  style={{
                    padding:"7px 12px", borderRadius:10, border:"0.5px solid rgba(0,85,255,.18)",
                    background:"#F5F9FF", fontSize:11, fontWeight:700, color:T3,
                    letterSpacing:"0.04em", outline:"none", fontFamily:"inherit",
                  }}
                >
                  {branchList.map(b=><option key={b} value={b}>{b==="All"?"All Branches":b}</option>)}
                </select>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  {[[GREEN,"95%+"],[GOLD,"85-94%"],[RED,"<85%"]].map(([c,l])=>(
                    <div key={l as string} style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:c as string }}/>
                      <span style={{ fontSize:10, fontWeight:700, color:T3 }}>{l}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ overflowX:"auto", paddingBottom:4, WebkitOverflowScrolling:"touch" }}>
              <div style={{ minWidth: isMobile ? 480 : 600 }}>
                <div style={{ display:"grid", gap: isMobile ? 6 : 8, marginBottom: isMobile ? 6 : 8, gridTemplateColumns:`${isMobile ? 100 : 140}px repeat(${Math.max(heatmapGrades.length,1)},${isMobile ? "56px" : "1fr"})` }}>
                  <div style={{ fontSize:9, fontWeight:700, color:T4, letterSpacing:"0.12em", textTransform:"uppercase" }}>Branch</div>
                  {heatmapGrades.map(g=>(
                    <div key={g} style={{ textAlign:"center", fontSize:9, fontWeight:700, color:T4, letterSpacing:"0.12em", textTransform:"uppercase" }}>{g}</div>
                  ))}
                </div>
                {heatmapData.length === 0 ? (
                  <div style={{ textAlign:"center", padding:"30px 0", fontSize:12, color:T4, fontWeight:600 }}>No attendance data yet</div>
                ) : (
                  heatmapData.map(row=>(
                    <div key={row.branch} style={{ display:"grid", gap: isMobile ? 6 : 8, marginBottom: isMobile ? 6 : 8, gridTemplateColumns:`${isMobile ? 100 : 140}px repeat(${Math.max(heatmapGrades.length,1)},${isMobile ? "56px" : "1fr"})` }}>
                      <div style={{ display:"flex", alignItems:"center" }}>
                        <span style={{ fontSize: isMobile ? 10 : 11, fontWeight:700, color:T3, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", paddingRight:6 }}>{row.branch}</span>
                      </div>
                      {row.cells.map((val,i)=>{
                        const bg = val >= 95 ? GREEN : val >= 85 ? GOLD : val > 0 ? RED : "rgba(0,85,255,.06)";
                        return (
                          <div key={i} className="stu-btn"
                            style={{
                              height: isMobile ? 34 : 40, borderRadius: isMobile ? 8 : 10,
                              display:"flex", alignItems:"center", justifyContent:"center",
                              fontWeight:800, fontSize: isMobile ? 10 : 11,
                              color: val>0 ? "#fff" : T4,
                              background: bg,
                              boxShadow: val>0 ? "0 4px 10px rgba(0,0,0,.08)" : "none",
                            }}
                          >
                            {val>0 ? `${val}%` : "—"}
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ── Student Table ─────────────────────────── */}
          <div
            {...tilt3D}
            style={{
              background:"#fff", borderRadius: isMobile ? 16 : 22,
              boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
              overflow:"hidden", marginBottom: isMobile ? 16 : 24, perspective:"1200px",
              ...tilt3DStyle,
            }}
          >
            <div style={{ padding: isMobile ? "14px 14px" : "18px 24px", borderBottom:"0.5px solid rgba(0,85,255,.08)", display:"flex", gap: isMobile ? 8 : 12, alignItems:"center", flexWrap:"wrap" }}>
              <div style={{ position:"relative", flex:"1 1 100%", minWidth: isMobile ? 0 : 220, order: isMobile ? 0 : undefined }}>
                <Search style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }} size={15} color={T4}/>
                <input
                  value={search}
                  onChange={e=>{setSearch(e.target.value);setPage(1);}}
                  placeholder="Search scholars by name..."
                  style={{
                    width:"100%", padding: isMobile ? "9px 10px 9px 34px" : "10px 12px 10px 36px", borderRadius:12,
                    border:"0.5px solid rgba(0,85,255,.14)", background:"#F5F9FF",
                    fontSize: isMobile ? 12 : 13, fontWeight:500, color:T1, outline:"none", fontFamily:"inherit",
                  }}
                />
              </div>
              <select
                value={tableBranch}
                onChange={e=>{setTableBranch(e.target.value);setPage(1);}}
                style={{
                  padding: isMobile ? "9px 10px" : "10px 14px", borderRadius:12, border:"0.5px solid rgba(0,85,255,.14)",
                  background:"#F5F9FF", fontSize:12, fontWeight:700, color:T3,
                  outline:"none", fontFamily:"inherit", minWidth: isMobile ? 0 : 140,
                  flex: isMobile ? 1 : undefined,
                }}
              >
                {branchList.map(b=><option key={b} value={b}>{b==="All"?"All Branches":b}</option>)}
              </select>
              <button
                className="stu-btn"
                style={{
                  display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                  padding: isMobile ? "9px 12px" : "10px 14px", borderRadius:12,
                  background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.14)",
                  fontSize:12, fontWeight:700, color:T3, cursor:"pointer", fontFamily:"inherit",
                }}
              >
                <Filter size={13}/> {isMobile ? "" : "Filters"}
              </button>
            </div>

            {isMobile ? (
              <div style={{ padding: "8px 10px 4px" }}>
                {grouped.map(([letter, rows])=>(
                  <React.Fragment key={letter}>
                    <div style={{ padding:"8px 6px", fontSize:10, fontWeight:800, color:B1, letterSpacing:"0.16em", textTransform:"uppercase" }}>
                      {letter}
                    </div>
                    {rows.map(s=>{
                      const risk = getRisk(s.score);
                      const riskBg = s.score>=75 ? "rgba(0,200,83,.1)" : s.score>=50 ? "rgba(255,170,0,.1)" : "rgba(255,51,85,.1)";
                      const riskColor = s.score>=75 ? GREEN : s.score>=50 ? GOLD : RED;
                      const avatarBg = s.score>=75 ? "linear-gradient(135deg,#10B981 0%,#059669 100%)" : s.score>=50 ? "linear-gradient(135deg,#F59E0B 0%,#D97706 100%)" : "linear-gradient(135deg,#FF3355 0%,#DC2626 100%)";
                      const isSelected = selected?._eid===s._eid;
                      return (
                        <div key={s._eid}
                          onClick={()=>navigate(`/students/${encodeURIComponent(s.id)}`)}
                          role="button" tabIndex={0}
                          style={{
                            borderRadius:14, padding:"12px 12px", marginBottom:8,
                            background: isSelected ? "rgba(0,85,255,.06)" : "#F8FBFF",
                            border:"0.5px solid rgba(0,85,255,.08)",
                            cursor:"pointer",
                            display:"flex", flexDirection:"column", gap:10,
                          }}
                        >
                          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                            <div style={{
                              width:38, height:38, borderRadius:"50%", background:avatarBg,
                              display:"flex", alignItems:"center", justifyContent:"center",
                              color:"#fff", fontSize:12, fontWeight:800, flexShrink:0,
                              boxShadow:"0 4px 10px rgba(0,85,255,.18)",
                            }}>
                              {getInitials(s.name)}
                            </div>
                            <div style={{ minWidth:0, flex:1 }}>
                              <p style={{ fontSize:13, fontWeight:800, color:T1, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.name}</p>
                              <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"2px 0 0 0" }}>{s.grade} · {s.branch}</p>
                            </div>
                            <span style={{
                              fontSize:9, fontWeight:800, letterSpacing:"0.12em", textTransform:"uppercase",
                              padding:"3px 8px", borderRadius:6, background:riskBg, color:riskColor, flexShrink:0,
                            }}>{risk.label}</span>
                          </div>
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:10, alignItems:"center" }}>
                            <div>
                              <p style={{ fontSize:9, fontWeight:700, color:T4, letterSpacing:"0.10em", textTransform:"uppercase", margin:0 }}>Attendance</p>
                              <p style={{ fontSize:13, fontWeight:800, color:T1, margin:"2px 0 0 0" }}>{s.attendance>0?`${s.attendance}%`:"—"}</p>
                            </div>
                            <div>
                              <p style={{ fontSize:9, fontWeight:700, color:T4, letterSpacing:"0.10em", textTransform:"uppercase", margin:0 }}>Score</p>
                              <p style={{ fontSize:13, fontWeight:800, color:T1, margin:"2px 0 0 0" }}>{s.score>0?`${s.score}%`:"—"}</p>
                            </div>
                            <button
                              onClick={(e)=>{e.stopPropagation();setSelected(isSelected ? null : s);}}
                              style={{
                                padding:"7px 14px", borderRadius:10,
                                background:isSelected?GRAD_PRIMARY:"rgba(0,85,255,.08)",
                                color:isSelected?"#fff":B1,
                                fontSize:10, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                                border:"none", cursor:"pointer", fontFamily:"inherit",
                                boxShadow:isSelected?SHADOW_BTN:"none",
                              }}
                            >
                              {isSelected ? "Close" : "View"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
                {filtered.length===0 && (
                  <div style={{ padding:"40px 0", textAlign:"center", fontSize:11, fontWeight:700, color:T4, letterSpacing:"0.14em", textTransform:"uppercase" }}>No scholars found</div>
                )}
              </div>
            ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", minWidth:720, borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:"rgba(0,85,255,.03)", borderBottom:"0.5px solid rgba(0,85,255,.08)" }}>
                    {["Student","Grade","Branch","Attendance","Score","Actions"].map((h,i)=>(
                      <th key={h} style={{
                        padding:"12px 18px", textAlign:"left", fontSize:10, fontWeight:800,
                        color:T4, letterSpacing:"0.14em", textTransform:"uppercase",
                        display:i===1||i===2?"table-cell":undefined,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(([letter, rows])=>(
                    <React.Fragment key={letter}>
                      <tr style={{ background:"rgba(0,85,255,.04)" }}>
                        <td colSpan={6} style={{ padding:"8px 22px", fontSize:10, fontWeight:800, color:B1, letterSpacing:"0.16em", textTransform:"uppercase" }}>
                          {letter}
                        </td>
                      </tr>
                      {rows.map(s=>{
                        const risk = getRisk(s.score);
                        const riskBg = s.score>=75 ? "rgba(0,200,83,.1)" : s.score>=50 ? "rgba(255,170,0,.1)" : "rgba(255,51,85,.1)";
                        const riskColor = s.score>=75 ? GREEN : s.score>=50 ? GOLD : RED;
                        const avatarBg = s.score>=75 ? "linear-gradient(135deg,#10B981 0%,#059669 100%)" : s.score>=50 ? "linear-gradient(135deg,#F59E0B 0%,#D97706 100%)" : "linear-gradient(135deg,#FF3355 0%,#DC2626 100%)";
                        const isSelected = selected?._eid===s._eid;
                        return (
                          <tr key={s._eid}
                            className="stu-row"
                            onClick={()=>navigate(`/students/${encodeURIComponent(s.id)}`)}
                            style={{
                              borderBottom:"0.5px solid rgba(0,85,255,.04)",
                              background: isSelected ? "rgba(0,85,255,.06)" : "transparent",
                              cursor:"pointer",
                            }}
                          >
                            <td style={{ padding:"12px 18px" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                                <div style={{
                                  width:36, height:36, borderRadius:"50%", background:avatarBg,
                                  display:"flex", alignItems:"center", justifyContent:"center",
                                  color:"#fff", fontSize:11, fontWeight:800,
                                  boxShadow:"0 4px 10px rgba(0,85,255,.18)", flexShrink:0,
                                }}>
                                  {getInitials(s.name)}
                                </div>
                                <div style={{ minWidth:0 }}>
                                  <p style={{ fontSize:13, fontWeight:700, color:T1, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.name}</p>
                                  <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"2px 0 0 0", letterSpacing:"0.04em" }}>ID: {s.id.length>10?s.id.slice(0,10):s.id}</p>
                                </div>
                              </div>
                            </td>
                            <td style={{ padding:"12px 18px", fontSize:12, fontWeight:700, color:T3 }}>{s.grade}</td>
                            <td style={{ padding:"12px 18px", fontSize:12, fontWeight:700, color:T3 }}>{s.branch}</td>
                            <td style={{ padding:"12px 18px", fontSize:13, fontWeight:800, color:T1 }}>{s.attendance>0?`${s.attendance}%`:"—"}</td>
                            <td style={{ padding:"12px 18px" }}>
                              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                                <span style={{ fontSize:13, fontWeight:800, color:T1 }}>{s.score>0?`${s.score}%`:"—"}</span>
                                <span style={{
                                  fontSize:9, fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase",
                                  padding:"2px 7px", borderRadius:6, background:riskBg, color:riskColor,
                                  alignSelf:"flex-start",
                                }}>{risk.label}</span>
                              </div>
                            </td>
                            <td style={{ padding:"12px 18px" }}>
                              <button
                                onClick={(e)=>{e.stopPropagation();setSelected(isSelected ? null : s);}}
                                className="stu-btn"
                                style={{
                                  padding:"7px 14px", borderRadius:10,
                                  background:isSelected?GRAD_PRIMARY:"rgba(0,85,255,.08)",
                                  color:isSelected?"#fff":B1,
                                  fontSize:11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                                  border:"none", cursor:"pointer", fontFamily:"inherit",
                                  boxShadow:isSelected?SHADOW_BTN:"none",
                                }}
                              >
                                {isSelected ? "Close" : "View"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                  {filtered.length===0 && (
                    <tr><td colSpan={6} style={{ padding:"60px 0", textAlign:"center", fontSize:12, fontWeight:700, color:T4, letterSpacing:"0.14em", textTransform:"uppercase" }}>No scholars found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            )}

            <div style={{ padding: isMobile ? "12px 14px" : "14px 24px", borderTop:"0.5px solid rgba(0,85,255,.08)", display:"flex", alignItems:"center", justifyContent:"space-between", gap: isMobile ? 10 : 16, flexWrap:"wrap" }}>
              <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:700, color:T4, letterSpacing:"0.14em", textTransform:"uppercase", margin:0, width: isMobile ? "100%" : "auto", textAlign: isMobile ? "center" : "left" }}>
                Showing {Math.min((page-1)*PAGE_SIZE+1, filtered.length)}–{Math.min(page*PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div style={{ display:"flex", gap:6, margin: isMobile ? "0 auto" : 0, flexWrap:"wrap", justifyContent:"center" }}>
                <button
                  disabled={page===1}
                  onClick={()=>setPage(p=>p-1)}
                  className="stu-btn"
                  style={{
                    padding:"7px 14px", borderRadius:10,
                    background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                    fontSize:11, fontWeight:800, color:T3, cursor:page===1?"not-allowed":"pointer",
                    opacity:page===1?0.4:1, fontFamily:"inherit",
                  }}
                >Prev</button>
                {Array.from({length:Math.min(totalPages,5)},(_,i)=>i+1).map(n=>(
                  <button key={n} onClick={()=>setPage(n)}
                    className="stu-btn"
                    style={{
                      width:32, height:32, borderRadius:10,
                      background:page===n?GRAD_PRIMARY:"#F5F9FF",
                      color:page===n?"#fff":T3,
                      border: page===n ? "none" : "0.5px solid rgba(0,85,255,.12)",
                      fontSize:11, fontWeight:800, cursor:"pointer",
                      boxShadow:page===n?SHADOW_BTN:"none", fontFamily:"inherit",
                    }}
                  >{n}</button>
                ))}
                <button
                  disabled={page===totalPages}
                  onClick={()=>setPage(p=>p+1)}
                  className="stu-btn"
                  style={{
                    padding:"7px 14px", borderRadius:10,
                    background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                    fontSize:11, fontWeight:800, color:T3, cursor:page===totalPages?"not-allowed":"pointer",
                    opacity:page===totalPages?0.4:1, fontFamily:"inherit",
                  }}
                >Next</button>
              </div>
            </div>
          </div>

          {/* ── Student Detail Panel ─────────────────── */}
          {selected && (()=>{
            const risk = getRisk(selected.score);
            const isCritical = selected.score > 0 && selected.score < 50;
            const headerGrad = selected.score>=75 ? "linear-gradient(135deg,#10B981 0%,#059669 100%)" : selected.score>=50 ? "linear-gradient(135deg,#F59E0B 0%,#D97706 100%)" : "linear-gradient(135deg,#FF3355 0%,#DC2626 100%)";
            return (
              <div
                {...tilt3D}
                onClick={()=>navigate(`/students/${encodeURIComponent(selected.id)}`)}
                role="button" tabIndex={0}
                style={{
                  background:"#fff", borderRadius: isMobile ? 16 : 22,
                  boxShadow:SHADOW_LG, border:"0.5px solid rgba(0,85,255,.10)",
                  overflow:"hidden", marginBottom: isMobile ? 16 : 24,
                  animation:"slide-in-from-bottom .3s ease", perspective:"1200px",
                  cursor:"pointer",
                  ...tilt3DStyle,
                }}
              >
                <div style={{ padding: isMobile ? "16px 14px" : "22px 26px", borderBottom:"0.5px solid rgba(0,85,255,.08)", display:"flex", justifyContent:"space-between", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 10 : 16, flexWrap:"wrap" }}>
                  <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 14, minWidth:0, flex: isMobile ? "1 1 100%" : undefined }}>
                    <div style={{
                      width: isMobile ? 44 : 54, height: isMobile ? 44 : 54, borderRadius: isMobile ? 13 : 16, background:headerGrad,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      color:"#fff", fontSize: isMobile ? 14 : 16, fontWeight:800, flexShrink:0,
                      boxShadow:"0 8px 20px rgba(0,85,255,.22)",
                    }}>
                      {getInitials(selected.name)}
                    </div>
                    <div style={{ minWidth:0 }}>
                      <h2 style={{ fontSize: isMobile ? 17 : 22, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.5px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{selected.name}</h2>
                      <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:700, color:T4, margin:"4px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>
                        {selected.grade} · {selected.branch}
                      </p>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 6 : 8, flexWrap:"wrap", width: isMobile ? "100%" : "auto" }}>
                    <span style={{
                      fontSize: isMobile ? 9 : 10, fontWeight:800, padding:"6px 12px", borderRadius:10,
                      background:headerGrad, color:"#fff", letterSpacing:"0.12em", textTransform:"uppercase",
                      boxShadow:"0 4px 10px rgba(0,85,255,.18)",
                    }}>{risk.label} Risk</span>
                    <button
                      onClick={(e)=>e.stopPropagation()}
                      className="stu-btn"
                      style={{
                        display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                        padding: isMobile ? "8px 12px" : "9px 16px", borderRadius:11,
                        background:GRAD_PRIMARY, color:"#fff",
                        fontSize: isMobile ? 9 : 10, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
                        border:"none", cursor:"pointer", boxShadow:SHADOW_BTN, fontFamily:"inherit",
                        flex: isMobile ? 1 : undefined,
                      }}
                    >
                      <Mail size={13}/> Contact Parent
                    </button>
                    <button onClick={(e)=>{e.stopPropagation();setSelected(null);}}
                      className="stu-btn"
                      style={{
                        width: isMobile ? 34 : 36, height: isMobile ? 34 : 36, borderRadius:11, border:"0.5px solid rgba(0,85,255,.12)",
                        background:"#F5F9FF", display:"flex", alignItems:"center", justifyContent:"center",
                        cursor:"pointer", flexShrink:0,
                      }}
                    >
                      <X size={15} color={T3}/>
                    </button>
                  </div>
                </div>

                <div style={{ padding: isMobile ? "16px 14px" : 24 }}>
                  {(() => {
                    const attDisplay  = att30 !== null ? `${att30}%` : (selected.attendance > 0 ? `${selected.attendance}%` : "—");
                    const attSubText  = attDelta !== null
                      ? `${attDelta >= 0 ? "↑" : "↓"} ${Math.abs(attDelta)}% vs last month`
                      : "No comparison data";
                    const attColor = attDelta === null ? T4 : attDelta >= 0 ? GREEN : RED;
                    const scoreDisplay = selected.score > 0 ? `${selected.score}/100` : "—";
                    const scoreSubText = scoreDelta !== null
                      ? `${scoreDelta >= 0 ? "↑" : "↓"} ${Math.abs(scoreDelta)} pts from last exam`
                      : "No previous exam";
                    const scoreColor = scoreDelta === null ? T4 : scoreDelta >= 0 ? GREEN : RED;

                    return (
                      <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 10 : 14, marginBottom: isMobile ? 16 : 22 }}>
                        {[
                          { label:"Attendance (30d)", value:attDisplay, sub:attSubText, subColor:attColor, icon:Percent, grad:"linear-gradient(135deg,#10B981 0%,#059669 100%)", route:`/students/${encodeURIComponent(selected.id)}` },
                          { label:"Academic Score", value:scoreDisplay, sub:scoreSubText, subColor:scoreColor, icon:Award, grad:"linear-gradient(135deg,#0055FF 0%,#1166FF 100%)", route:`/students/${encodeURIComponent(selected.id)}` },
                          { label:"Behavior Incidents", value:selected.incidents.toString(), sub:"This term", subColor:T4, icon:AlertTriangle, grad: selected.incidents>0 ? "linear-gradient(135deg,#FF3355 0%,#DC2626 100%)" : "linear-gradient(135deg,#7B3FF4 0%,#9333EA 100%)", route: selected.incidents>0 ? "/risks" : `/students/${encodeURIComponent(selected.id)}` },
                        ].map(c=>{
                          const Icon = c.icon;
                          return (
                            <div key={c.label} {...tilt3D}
                              onClick={(e)=>{e.stopPropagation();navigate(c.route);}}
                              role="button" tabIndex={0}
                              style={{
                                background:"#F5F9FF", borderRadius: isMobile ? 14 : 16, padding: isMobile ? "14px 14px" : "16px 18px",
                                border:"0.5px solid rgba(0,85,255,.1)",
                                cursor:"pointer",
                                ...tilt3DStyle,
                              }}
                            >
                              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                                <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:800, color:T4, letterSpacing:"0.12em", textTransform:"uppercase", margin:0 }}>{c.label}</p>
                                <div style={{ width: isMobile ? 28 : 30, height: isMobile ? 28 : 30, borderRadius:10, background:c.grad, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 10px rgba(0,85,255,.2)" }}>
                                  <Icon size={14} color="#fff" strokeWidth={2.4}/>
                                </div>
                              </div>
                              <p style={{ fontSize: isMobile ? 22 : 26, fontWeight:800, color:isCritical?RED:T1, margin:0, letterSpacing:"-0.4px", lineHeight:1 }}>{c.value}</p>
                              <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:700, color:c.subColor, margin:"6px 0 0 0" }}>{c.sub}</p>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  <div>
                    <h3 style={{ fontSize:14, fontWeight:700, color:T1, margin:"0 0 14px 0", letterSpacing:"-0.3px" }}>Performance Trend</h3>
                    {detailLoading ? (
                      <div style={{ height:200, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <Loader2 className="animate-spin" size={24} color={B1}/>
                      </div>
                    ) : detailTrend.every(d => d.score === 0 && d.attendance === 0) ? (
                      <div style={{ height:200, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:T4 }}>
                        No trend data available for this student
                      </div>
                    ) : (
                      <div style={{ height:220 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={detailTrend} margin={{top:5,right:20,left:-22,bottom:5}}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill:T3,fontSize:11,fontWeight:600}}/>
                            <YAxis axisLine={false} tickLine={false} tick={{fill:T3,fontSize:11,fontWeight:600}} domain={[0,100]}/>
                            <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }}/>
                            <Line type="monotone" dataKey="score" name="Score" stroke={isCritical?RED:B1} strokeWidth={3}
                              dot={{r:4,fill:isCritical?RED:B1,strokeWidth:2,stroke:"#fff"}} activeDot={{r:6}} connectNulls={false}/>
                            <Line type="monotone" dataKey="attendance" name="Attendance" stroke={GREEN} strokeWidth={3} strokeDasharray="5 5"
                              dot={{r:4,fill:GREEN,strokeWidth:2,stroke:"#fff"}} activeDot={{r:6}} connectNulls={false}/>
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── AI Intelligence Card ─────────────────── */}
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
                <h3 style={{ fontSize: isMobile ? 15 : 18, fontWeight:700, color:"#fff", margin:0, letterSpacing:"-0.4px" }}>Student Intelligence Summary</h3>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 10 : 12, position:"relative", zIndex:1 }}>
              {[
                { label:"Performance Insight", value:highPerformers>0?`${((highPerformers/Math.max(totalEnrollment,1))*100).toFixed(0)}% high performers`:"Track top scorers", sub:atRisk>0?`${atRisk} need attention`:"All stable" },
                { label:"Attendance Pulse", value:avgAttendance > 0 ? `${avgAttendance}% campus avg` : "Collecting data", sub:avgAttendance>=90?"Excellent":avgAttendance>=75?"Healthy":"Monitor closely" },
                { label:"Enrollment Momentum", value:newThisTerm > 0 ? `+${newThisTerm} new this term` : "Steady state", sub:`${totalEnrollment} total scholars` },
              ].map(c=>(
                <div key={c.label} style={{ background:"rgba(255,255,255,.10)", borderRadius: isMobile ? 12 : 14, padding: isMobile ? "12px 14px" : "14px 16px", border:"0.5px solid rgba(255,255,255,.14)" }}>
                  <p style={{ fontSize:9, fontWeight:800, color:"rgba(255,255,255,.65)", letterSpacing:"0.14em", textTransform:"uppercase", margin:"0 0 8px 0" }}>{c.label}</p>
                  <p style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:"#fff", margin:0, letterSpacing:"-0.3px" }}>{c.value}</p>
                  <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:"rgba(255,255,255,.72)", margin:"6px 0 0 0" }}>{c.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      </div>
    </>
  );

}
