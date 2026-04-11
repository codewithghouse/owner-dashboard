import { useState, useEffect, useRef } from "react";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where, orderBy, limit, onSnapshot, doc, getDoc, setDoc } from "firebase/firestore";
import { calculateAHI, invalidateCache } from "@/lib/analyticsService";
import {
  Activity, Users, Percent, Bell, Download, Mail, Calendar, Settings,
  AlertCircle, Loader2, TrendingUp, ArrowUpRight, ArrowDownRight, Minus,
  GraduationCap
} from "lucide-react";
import {
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { useNavigate } from "react-router-dom";
import BenchmarkCard from "@/components/BenchmarkCard";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ── helpers ─────────────────────────────────────────── */
function timeAgo(ts: any): string {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 3600)  return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} hours ago`;
  return `${Math.round(diff / 86400)} days ago`;
}

export default function Dashboard() {
  const navigate = useNavigate();

  /* ── stat state ─────────────────────────────────── */
  const [ahi,           setAhi]           = useState<number>(0);
  const [totalStudents, setTotalStudents] = useState<number>(0);
  const [feeRate,       setFeeRate]       = useState<number>(0);
  const [activeAlerts,  setActiveAlerts]  = useState<number>(0);

  /* ── section state ──────────────────────────────── */
  const [branches,     setBranches]     = useState<any[]>([]);
  const [riskData,     setRiskData]     = useState([
    { name: "Low Risk", value: 0, color: "#22c55e" },
    { name: "Moderate", value: 0, color: "#f59e0b" },
    { name: "Critical", value: 0, color: "#ef4444" },
  ]);
  const [revenueTrend,       setRevenueTrend]       = useState<any[]>([]);
  const [improvementTimeline, setImprovementTimeline] = useState<any[]>([]);
  const [alerts,              setAlerts]              = useState<any[]>([]);
  const [selectedAlertBranch, setSelectedAlertBranch] = useState<string>("all");
  const [loading,             setLoading]             = useState(true);
  const [lastRefreshed,       setLastRefreshed]       = useState<Date | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── data fetch ─────────────────────────────────── */
  useEffect(() => {
    let alertsUnsub = () => {};
    let branchesUnsub = () => {};

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    // ── Save monthly historical snapshot (once per month) ─────────────────
    const saveMonthlySnapshot = async (ahi: number, attendance: number, passRate: number, feeRate: number) => {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      try {
        const snapRef = doc(db, "schools", uid, "snapshots", monthKey);
        const existing = await getDoc(snapRef);
        if (!existing.exists()) {
          await setDoc(snapRef, { ahi, attendance, passRate, feeRate, savedAt: new Date().toISOString() });
        }
      } catch { /* snapshot saving must never crash the dashboard */ }
    };

    const fetchAll = async (branchDocs: any[]) => {
      try {
        const schoolDocs = branchDocs;

        /* 2. Per-branch stats */
        const branchData = await Promise.all(
          schoolDocs.map(async (school) => {
            const sid = school.id;

            /* student count — use branchId for owner's branches */
            const enrollSnap  = await getDocs(query(collection(db, "enrollments"), where("branchId","==",sid)));
            const studentCount = enrollSnap.size;

            /* scores → passRate */
            const scoresSnap  = await getDocs(query(collection(db, "test_scores"), where("branchId","==",sid)));
            const allPct      = scoresSnap.docs
              .map(d => parseFloat(d.data().percentage ?? d.data().score ?? ""))
              .filter(n => !isNaN(n));
            const avgMarks    = allPct.length
              ? Math.round(allPct.reduce((a,b)=>a+b,0) / allPct.length)
              : 0;
            const passRate    = allPct.length
              ? Math.round(allPct.filter(p => p >= 40).length / allPct.length * 100)
              : 0;

            /* attendance */
            const attSnap     = await getDocs(query(collection(db, "attendance"), where("branchId","==",sid)));
            const presentCnt  = attSnap.docs.filter(d => (d.data().status||"").toLowerCase()==="present").length;
            const avgAtt      = attSnap.size ? Math.round((presentCnt / attSnap.size) * 100) : 0;

            /* fee collection rate per branch */
            const branchFeesSnap = await getDocs(query(collection(db, "fees"), where("branchId","==",sid)));
            const branchPaid     = branchFeesSnap.docs.filter(d => (d.data().status||"").toLowerCase()==="paid").length;
            const feeRate        = branchFeesSnap.size ? Math.round((branchPaid / branchFeesSnap.size) * 100) : 0;

            /* AHI — standard formula: 40% attendance + 40% passRate + 20% feeCollection */
            const schoolAHI = calculateAHI(avgAtt, passRate, feeRate);

            return {
              id:       sid,
              name:     school.name || school.schoolName || "School",
              students: studentCount,
              ahi:      schoolAHI,
              avgMarks,
              avgAttendance: avgAtt,
              passRate,
              feeRate,
            };
          })
        );

        const activeBranches = branchData.filter(b => b.name !== "School");
        setBranches(activeBranches);

        /* 3. Overall stats */
        const totalStuds = activeBranches.reduce((s,b)=>s+b.students, 0);
        setTotalStudents(totalStuds);

        const overallAHI = activeBranches.length > 0
          ? Math.round(activeBranches.reduce((s,b)=>s+b.ahi,0) / activeBranches.length)
          : 0;
        setAhi(overallAHI);

        /* 4. Risk distribution for this owner */
        const allScoresSnap = await getDocs(query(collection(db, "test_scores"), where("schoolId", "==", uid)));
        const studentMap    = new Map<string, number[]>();
        allScoresSnap.docs.forEach(d => {
          const data = d.data();
          const key  = data.studentId || data.studentEmail || d.id;
          const pct  = parseFloat(data.percentage ?? data.score ?? "");
          if (!isNaN(pct)) {
            if (!studentMap.has(key)) studentMap.set(key, []);
            studentMap.get(key)!.push(pct);
          }
        });
        let low=0, mid=0, crit=0;
        studentMap.forEach(vals => {
          const avg = vals.reduce((a,b)=>a+b,0) / vals.length;
          if      (avg >= 75) low++;
          else if (avg >= 50) mid++;
          else                crit++;
        });
        const total = low + mid + crit || 1;
        setRiskData([
          { name: "Low Risk", value: Math.round((low  / total)*100), color: "#22c55e" },
          { name: "Moderate", value: Math.round((mid  / total)*100), color: "#f59e0b" },
          { name: "Critical", value: Math.round((crit / total)*100), color: "#ef4444" },
        ]);

        /* 5. Fee collection rate for this owner */
        const feesSnap = await getDocs(query(collection(db, "fees"), where("schoolId", "==", uid)));
        const totalFee = feesSnap.size;
        const paidFee  = feesSnap.docs.filter(d => (d.data().status||"").toLowerCase()==="paid").length;
        setFeeRate(totalFee > 0 ? Math.round((paidFee / totalFee)*1000)/10 : 0);

        /* 6. Revenue trend (last 6 months) */
        const monthMap: Record<string,number> = {};
        feesSnap.docs
          .filter(d => (d.data().status||"").toLowerCase()==="paid")
          .forEach(d => {
            const data  = d.data();
            const date  = data.paidAt?.toDate?.() || data.createdAt?.toDate?.() || null;
            if (date) {
              const key = MONTH_NAMES[date.getMonth()];
              monthMap[key] = (monthMap[key]||0) + (parseFloat(data.amount ?? data.totalAmount ?? "0")||0);
            }
          });
        const now  = new Date();
        const last6 = Array.from({length:6},(_,i)=>{
          const d = new Date(now.getFullYear(), now.getMonth()-5+i, 1);
          return MONTH_NAMES[d.getMonth()];
        });
        setRevenueTrend(last6.map(m => ({
          month:   m,
          revenue: Math.round((monthMap[m]||0) / 1000), // K units
        })));

        /* 7. Improvement Timeline — AHI + Attendance + Fee rate per month (last 6) */
        const allAttSnap    = await getDocs(query(collection(db, "attendance"),  where("schoolId","==",uid)));
        const allScoresSnap2 = await getDocs(query(collection(db, "test_scores"), where("schoolId","==",uid)));

        const now2 = new Date();
        const timelineMonths = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now2.getFullYear(), now2.getMonth() - 5 + i, 1);
          return { month: MONTH_NAMES[d.getMonth()], year: d.getFullYear(), num: d.getMonth() };
        });

        const timeline = timelineMonths.map(({ month, year, num }) => {
          // Attendance for month
          const attRecs = allAttSnap.docs
            .map(d => d.data())
            .filter(d => {
              const date = d.date ? new Date(d.date) : null;
              return date && date.getMonth() === num && date.getFullYear() === year;
            });
          const attPct = attRecs.length
            ? Math.round((attRecs.filter(r => r.status === "present").length / attRecs.length) * 100)
            : null;

          // Test scores for month
          const scoreRecs = allScoresSnap2.docs
            .map(d => d.data())
            .filter(d => {
              const ts = d.createdAt?.toDate?.() || d.timestamp?.toDate?.() || null;
              return ts && ts.getMonth() === num && ts.getFullYear() === year;
            });
          const avgScore = scoreRecs.length
            ? Math.round(scoreRecs.reduce((s, d) => s + parseFloat(d.percentage ?? d.score ?? "0"), 0) / scoreRecs.length)
            : null;

          // AHI for that month
          const ahi = avgScore != null && attPct != null
            ? Math.round(avgScore * 0.6 + attPct * 0.4)
            : avgScore ?? attPct ?? null;

          // Fee collection for month
          const feeRecs = feesSnap.docs
            .map(d => d.data())
            .filter(d => {
              const ts = d.paidAt?.toDate?.() || d.createdAt?.toDate?.() || null;
              return ts && ts.getMonth() === num && ts.getFullYear() === year;
            });
          const feePaid  = feeRecs.filter(d => (d.status || "").toLowerCase() === "paid").length;
          const feeTotal = feesSnap.docs
            .map(d => d.data())
            .filter(d => {
              const ts = d.createdAt?.toDate?.() || null;
              return ts && ts.getMonth() === num && ts.getFullYear() === year;
            }).length;
          const feeRate2 = feeTotal > 0 ? Math.round((feePaid / feeTotal) * 100) : null;

          return { month, ahi, attendance: attPct, fee: feeRate2 };
        });
        setImprovementTimeline(timeline.filter(t => t.ahi !== null || t.attendance !== null));

        // ── Save this month's snapshot for historical trend ───────────────
        const overallAtt  = activeBranches.length > 0
          ? Math.round(activeBranches.reduce((s, b) => s + b.avgAttendance, 0) / activeBranches.length) : 0;
        const overallPass = activeBranches.length > 0
          ? Math.round(activeBranches.reduce((s, b) => s + b.passRate, 0) / activeBranches.length) : 0;
        const overallFee  = activeBranches.length > 0
          ? Math.round(activeBranches.reduce((s, b) => s + b.feeRate, 0) / activeBranches.length) : 0;
        saveMonthlySnapshot(overallAHI, overallAtt, overallPass, overallFee);

      } catch(e) {
        console.error("Dashboard fetch error:", e);
      }
      setLoading(false);
      setLastRefreshed(new Date());
    };

    // ── Real-time onSnapshot for branches ─────────────────────────────────
    branchesUnsub = onSnapshot(
      collection(db, "schools", uid, "branches"),
      (snap) => {
        const docs = snap.docs.map(d => ({
          id: d.data().branchId || d.data().schoolId || d.id,
          ...d.data() as any
        }));
        invalidateCache(`core:${uid}`);
        fetchAll(docs);
      },
      () => {
        // Fallback on permission error
        getDocs(collection(db, "schools", uid, "branches")).then(s => {
          fetchAll(s.docs.map(d => ({ id: d.data().branchId || d.id, ...d.data() as any })));
        });
      }
    );

    // ── Auto-refresh analytics data every 5 minutes ───────────────────────
    refreshTimerRef.current = setInterval(() => {
      getDocs(collection(db, "schools", uid, "branches")).then(s => {
        invalidateCache(`core:${uid}`);
        fetchAll(s.docs.map(d => ({ id: d.data().branchId || d.id, ...d.data() as any })));
      });
    }, 5 * 60 * 1000);

    /* 7. Live alerts — try `risks`, fallback to `discipline` */
    try {
      alertsUnsub = onSnapshot(
        query(collection(db, "risks"), orderBy("createdAt","desc"), limit(5)),
        snap => {
          setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() as any })));
          setActiveAlerts(snap.size);
        }
      );
    } catch {
      alertsUnsub = onSnapshot(
        query(collection(db, "discipline"), orderBy("createdAt","desc"), limit(5)),
        snap => {
          setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() as any })));
          setActiveAlerts(snap.size);
        }
      );
    }

    return () => {
      alertsUnsub();
      branchesUnsub();
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, []);

  /* ── derived values for center of donut ────────────── */
  const lowPct = riskData.find(r=>r.name==="Low Risk")?.value ?? 0;

  const displayAlertsCount = activeAlerts;

  const filteredAlerts = alerts.filter(alert => {
    if (selectedAlertBranch === "all") return true;
    return alert.branchId === selectedAlertBranch || alert.schoolId === selectedAlertBranch;
  });

  // Fresh school detection (no branches and no loading)
  const isFreshSchool = !loading && branches.length === 0 && totalStudents === 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-10">

      {/* ── Header ───────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl md:text-3xl font-extrabold text-[#1e294b] tracking-tight">Executive Dashboard</h1>
        <p className="text-slate-500 text-xs md:text-sm font-medium">Real-time overview of all school operations</p>
      </div>

      {/* ── Fresh School Onboarding Banner ───────────────── */}
      {isFreshSchool && (
        <div className="bg-gradient-to-r from-[#1e3a8a] to-[#3b82f6] rounded-3xl p-8 text-white shadow-xl shadow-blue-900/20 animate-in slide-in-from-top-2 duration-500">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-start gap-5">
              <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
                <GraduationCap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-black tracking-tight">Welcome to EduIntellect!</h2>
                <p className="text-blue-100 text-sm font-medium mt-1 leading-relaxed">
                  Your dashboard is ready. Set up your school branches, invite principals, and start adding data to see live analytics here.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap shrink-0">
              <button
                onClick={() => navigate("/branches")}
                className="px-5 py-2.5 rounded-xl bg-white text-[#1e3a8a] text-xs font-black hover:bg-blue-50 transition-all"
              >
                Add First Branch
              </button>
              <button
                onClick={() => navigate("/principals")}
                className="px-5 py-2.5 rounded-xl bg-white/15 text-white text-xs font-black hover:bg-white/25 transition-all"
              >
                Invite Principal
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            {[
              { step: "1", label: "Add Branches",     done: false },
              { step: "2", label: "Invite Principals", done: false },
              { step: "3", label: "Enroll Students",   done: false },
              { step: "4", label: "Start Analytics",   done: false },
            ].map(s => (
              <div key={s.step} className="flex items-center gap-3 bg-white/10 rounded-2xl px-4 py-3">
                <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-black text-white shrink-0">
                  {s.step}
                </div>
                <span className="text-xs font-bold text-blue-100">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Stat Cards ───────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          {
            title:  "Academic Health Index",
            value:  loading ? "—" : ahi.toString(),
            badge:  "+2.3%",
            label:  "vs last month",
            icon:   Activity,
            color:  "text-green-500",
            bg:     "bg-green-50",
            up:     true,
          },
          {
            title:  "Total Students",
            value:  loading ? "—" : totalStudents.toLocaleString(),
            badge:  "+124",
            label:  "new this term",
            icon:   Users,
            color:  "text-blue-500",
            bg:     "bg-blue-50",
            up:     true,
          },
          {
            title:  "Fee Collection Rate",
            value:  loading ? "—" : `${feeRate}%`,
            badge:  "+1.8%",
            label:  "vs last term",
            icon:   Percent,
            color:  "text-emerald-500",
            bg:     "bg-emerald-50",
            up:     true,
          },
          {
            title:  "Active Alerts",
            value:  loading ? "—" : displayAlertsCount.toString(),
            badge:  "+3",
            label:  "since yesterday",
            icon:   Bell,
            color:  "text-red-500",
            bg:     "bg-red-50",
            up:     false,
          },
        ].map((s) => (
          <div key={s.title} className="bg-white p-5 md:p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-start justify-between mb-4">
              <span className="text-slate-500 text-sm font-semibold tracking-tight">{s.title}</span>
              <div className={`p-2 rounded-lg ${s.bg}`}>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
            </div>
            {loading ? (
              <Loader2 className="w-6 h-6 animate-spin text-slate-300 mt-2" />
            ) : (
              <div>
                <span className="text-4xl font-bold text-[#1e294b] tracking-tight">{s.value}</span>
                <div className="flex items-center gap-1 mt-2">
                  <TrendingUp className={`w-3 h-3 ${s.up ? "text-green-500" : "text-red-500"}`} />
                  <span className={`text-xs font-bold ${s.up ? "text-green-500" : "text-red-500"}`}>{s.badge}</span>
                  <span className="text-slate-400 text-xs font-medium">{s.label}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Middle Row ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Branch Overview */}
        <div className="lg:col-span-4 bg-white rounded-3xl border border-slate-100 p-6 md:p-8 shadow-sm">
          <h3 className="text-base md:text-lg font-bold text-[#1e294b] mb-6 md:mb-8">Branch Overview</h3>
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
            </div>
          ) : branches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <p className="text-sm font-semibold text-slate-400">No branches found</p>
              <p className="text-xs text-slate-300 mt-1">Schools will appear here once registered</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {branches.map((branch) => (
                <div
                  key={branch.id}
                  onClick={() => navigate("/branches")}
                  className="flex items-center justify-between group cursor-pointer"
                >
                  <div>
                    <h4 className="text-[15px] font-bold text-[#1e294b] group-hover:text-blue-600 transition-colors">
                      {branch.name}
                    </h4>
                    <p className="text-slate-400 text-xs font-medium">
                      {branch.students.toLocaleString()} students
                    </p>
                  </div>
                  <div className={`px-4 py-1.5 rounded-lg text-xs font-bold text-white ${
                    branch.ahi >= 90 ? "bg-green-500" :
                    branch.ahi >= 80 ? "bg-emerald-500" : "bg-orange-500"
                  }`}>
                    {branch.ahi > 0 ? `${branch.ahi}%` : "N/A"} AHI
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Risk Distribution */}
        <div className="lg:col-span-4 bg-white rounded-3xl border border-slate-100 p-6 md:p-8 shadow-sm">
          <h3 className="text-base md:text-lg font-bold text-[#1e294b] mb-6">Risk Distribution</h3>
          {riskData.every(r => r.value === 0) ? (
            <div className="h-[220px] flex flex-col items-center justify-center gap-3 border border-dashed border-slate-200 rounded-2xl">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-emerald-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-slate-400">No risk data yet</p>
                <p className="text-xs text-slate-300 mt-1">Risk distribution appears once student data is added</p>
              </div>
            </div>
          ) : (
            <>
              <div className="h-[220px] relative flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={riskData}
                      cx="50%" cy="50%"
                      innerRadius={70} outerRadius={100}
                      paddingAngle={6} cornerRadius={10}
                      dataKey="value"
                      stroke="none"
                      startAngle={90} endAngle={-270}
                    >
                      {riskData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: any) => [`${v}%`, ""]}
                      contentStyle={{ borderRadius:"16px", border:"none", boxShadow:"0 10px 25px rgba(0,0,0,0.1)", padding:"10px 16px" }}
                      itemStyle={{ fontWeight:"bold", fontSize:"12px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mt-4">
                  <span className="text-3xl font-bold text-[#1e294b]">{lowPct}%</span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Safe</span>
                </div>
              </div>
              <div className="flex items-center justify-center gap-6 mt-4">
                {riskData.map(r => (
                  <div key={r.name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />
                    <span className="text-[11px] font-bold text-slate-500">{r.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Revenue Trend */}
        <div className="lg:col-span-4 bg-white rounded-3xl border border-slate-100 p-6 md:p-8 shadow-sm">
          <h3 className="text-base md:text-lg font-bold text-[#1e294b] mb-6">Revenue Trend</h3>
          {revenueTrend.every(r => r.revenue === 0) ? (
            <div className="h-[220px] flex flex-col items-center justify-center gap-3 border border-dashed border-slate-200 rounded-2xl">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
                <Download className="w-6 h-6 text-blue-300" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-slate-400">No revenue data yet</p>
                <p className="text-xs text-slate-300 mt-1">Appears once fee payments are recorded</p>
              </div>
            </div>
          ) : (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueTrend} margin={{ top:10, right:10, left:-20, bottom:0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#1e3a8a" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false}
                    tick={{ fill:"#94a3b8", fontSize:12, fontWeight:500 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false}
                    tick={{ fill:"#94a3b8", fontSize:12, fontWeight:500 }} />
                  <Tooltip
                    formatter={(v:any) => [`${v}K`, "Revenue"]}
                    contentStyle={{ borderRadius:"16px", border:"none", boxShadow:"0 10px 15px rgba(0,0,0,0.1)" }}
                    itemStyle={{ fontWeight:"bold", fontSize:"12px" }}
                  />
                  <Area type="monotone" dataKey="revenue"
                    stroke="#1e3a8a" strokeWidth={3}
                    fillOpacity={1} fill="url(#revGrad)"
                    dot={{ r:4, fill:"#1e3a8a", strokeWidth:2, stroke:"#fff" }}
                    activeDot={{ r:6, strokeWidth:0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Row ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Critical Alerts */}
        <div className="bg-white rounded-3xl border border-slate-100 p-6 md:p-8 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <h3 className="text-base md:text-lg font-bold text-[#1e294b]">Critical Alerts</h3>
            <div className="flex items-center justify-between gap-3">
              <select
                value={selectedAlertBranch}
                onChange={(e) => setSelectedAlertBranch(e.target.value)}
                className="text-xs font-bold text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 outline-none focus:border-blue-500 transition-colors"
                style={{ cursor: 'pointer' }}
              >
                <option value="all">All Branches</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <button
                onClick={() => navigate("/risks")}
                className="text-xs font-bold text-[#1e3a8a] hover:underline flex items-center gap-1"
              >
                View All
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {filteredAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center mb-2">
                  <AlertCircle className="w-5 h-5 text-slate-300" />
                </div>
                <p className="text-sm font-semibold text-slate-400">No critical alerts for this branch</p>
                <p className="text-xs text-slate-300 mt-0.5">Everything looks good!</p>
              </div>
            ) : (
              filteredAlerts.slice(0,5).map((alert) => {
                const isCritical = (alert.severity||"warning") === "critical";
                return (
                  <div
                    key={alert.id}
                    onClick={() => navigate("/risks")}
                    className={`relative flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4 rounded-2xl cursor-pointer hover:scale-[1.01] transition-all overflow-hidden ${
                      isCritical ? "bg-red-50" : "bg-amber-50/70"
                    }`}
                  >
                    {/* Rounded pill left accent */}
                    <div className={`absolute left-0 top-3 bottom-3 w-[5px] rounded-r-full ${
                      isCritical ? "bg-red-500" : "bg-amber-400"
                    }`} />

                    <div className={`w-9 h-9 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0 ${
                      isCritical ? "border border-red-100" : "border border-amber-100"
                    }`}>
                      <AlertCircle className={`w-4 h-4 ${isCritical ? "text-red-500" : "text-amber-500"}`} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[#1e294b] leading-snug">
                        {alert.message || alert.description || alert.title || "Alert"}
                      </p>
                      <p className="text-[11px] text-slate-400 font-semibold mt-0.5">
                        {alert._fallback
                          ? (alert.id === "f1" ? "2 hours ago" : alert.id === "f2" ? "5 hours ago" : "1 day ago")
                          : timeAgo(alert.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-3xl border border-slate-100 p-6 md:p-8 shadow-sm">
          <h3 className="text-base md:text-lg font-bold text-[#1e294b] mb-6">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => navigate("/reports")}
              className="flex items-center gap-4 bg-[#1e3a8a] text-white p-5 rounded-2xl shadow-lg shadow-blue-900/20 hover:bg-[#1e4fc0] transition-all group"
            >
              <div className="p-2.5 rounded-xl bg-white/15 group-hover:scale-110 transition-transform">
                <Download className="w-5 h-5" />
              </div>
              <span className="text-sm font-bold">Export Report</span>
            </button>
            <button
              onClick={() => navigate("/branches")}
              className="flex items-center gap-4 bg-white border border-slate-100 text-[#1e294b] p-5 rounded-2xl shadow-sm hover:bg-slate-50 transition-all group"
            >
              <div className="p-2.5 rounded-xl bg-slate-50 group-hover:scale-110 transition-transform">
                <Mail className="w-5 h-5 text-slate-400" />
              </div>
              <span className="text-sm font-bold">Message Branches</span>
            </button>
            <button
              onClick={() => navigate("/principals")}
              className="flex items-center gap-4 bg-white border border-slate-100 text-[#1e294b] p-5 rounded-2xl shadow-sm hover:bg-slate-50 transition-all group"
            >
              <div className="p-2.5 rounded-xl bg-slate-50 group-hover:scale-110 transition-transform">
                <Calendar className="w-5 h-5 text-slate-400" />
              </div>
              <span className="text-sm font-bold">Schedule Meeting</span>
            </button>
            <button
              onClick={() => navigate("/settings")}
              className="flex items-center gap-4 bg-white border border-slate-100 text-[#1e294b] p-5 rounded-2xl shadow-sm hover:bg-slate-50 transition-all group"
            >
              <div className="p-2.5 rounded-xl bg-slate-50 group-hover:scale-110 transition-transform">
                <Settings className="w-5 h-5 text-slate-400" />
              </div>
              <span className="text-sm font-bold">System Settings</span>
            </button>
          </div>
        </div>

      </div>

      {/* ── Improvement Timeline ─────────────────────────── */}
      <div className="bg-white rounded-3xl border border-slate-100 p-6 md:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h3 className="text-base md:text-lg font-bold text-[#1e294b]">School Improvement Timeline</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">AHI · Attendance · Fee Collection — last 6 months</p>
          </div>
          {improvementTimeline.length >= 2 && (() => {
            const first = improvementTimeline[0];
            const last  = improvementTimeline[improvementTimeline.length - 1];
            const delta = (last.ahi ?? 0) - (first.ahi ?? 0);
            const isUp  = delta > 0;
            const isFlat = delta === 0;
            return (
              <div className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black ${
                isUp ? "bg-green-50 text-green-600" : isFlat ? "bg-slate-50 text-slate-500" : "bg-red-50 text-red-500"
              }`}>
                {isFlat ? <Minus className="w-3.5 h-3.5" /> : isUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                <span>AHI {isUp ? "+" : ""}{delta} pts over 6 months</span>
              </div>
            );
          })()}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-52">
            <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
          </div>
        ) : improvementTimeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-52 text-center">
            <TrendingUp className="w-8 h-8 text-slate-200 mb-2" />
            <p className="text-sm font-semibold text-slate-400">No historical data yet</p>
            <p className="text-xs text-slate-300 mt-1">Timeline will appear as months of data accumulate</p>
          </div>
        ) : (
          <>
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={improvementTimeline} margin={{ top:10, right:10, left:-20, bottom:0 }}>
                  <defs>
                    <linearGradient id="ahiGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#1e3a8a" stopOpacity={0.1} />
                      <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false}
                    tick={{ fill:"#94a3b8", fontSize:11, fontWeight:600 }} dy={8} />
                  <YAxis domain={[40,100]} axisLine={false} tickLine={false}
                    tick={{ fill:"#94a3b8", fontSize:11, fontWeight:600 }} />
                  <Tooltip
                    contentStyle={{ borderRadius:"16px", border:"none", boxShadow:"0 10px 25px rgba(0,0,0,0.1)", padding:"10px 16px" }}
                    itemStyle={{ fontWeight:"bold", fontSize:"12px" }}
                    formatter={(v: any, name: string) => [`${v}%`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize:11, fontWeight:700, paddingTop:12 }} />
                  <Line type="monotone" dataKey="ahi" name="AHI" stroke="#1e3a8a" strokeWidth={3}
                    dot={{ r:4, fill:"#1e3a8a", stroke:"#fff", strokeWidth:2 }}
                    activeDot={{ r:6, strokeWidth:0 }} connectNulls />
                  <Line type="monotone" dataKey="attendance" name="Attendance" stroke="#22c55e" strokeWidth={2.5}
                    strokeDasharray="5 3"
                    dot={{ r:3, fill:"#22c55e", stroke:"#fff", strokeWidth:2 }}
                    activeDot={{ r:5, strokeWidth:0 }} connectNulls />
                  <Line type="monotone" dataKey="fee" name="Fee Collection" stroke="#f59e0b" strokeWidth={2.5}
                    strokeDasharray="8 4"
                    dot={{ r:3, fill:"#f59e0b", stroke:"#fff", strokeWidth:2 }}
                    activeDot={{ r:5, strokeWidth:0 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Month-over-month delta chips */}
            {improvementTimeline.length >= 2 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {improvementTimeline.slice(1).map((m, i) => {
                  const prev  = improvementTimeline[i];
                  const delta = (m.ahi ?? 0) - (prev.ahi ?? 0);
                  const isUp  = delta > 0;
                  return (
                    <div key={m.month} className={`flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black ${
                      isUp ? "bg-green-50 text-green-600" : delta < 0 ? "bg-red-50 text-red-500" : "bg-slate-50 text-slate-400"
                    }`}>
                      {isUp ? <ArrowUpRight className="w-3 h-3" /> : delta < 0 ? <ArrowDownRight className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                      {prev.month}→{m.month}: {isUp ? "+" : ""}{delta}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Benchmarking ─────────────────────────────────── */}
      <BenchmarkCard />

    </div>
  );
}
