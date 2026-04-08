import { useState, useEffect } from "react";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where, orderBy, limit, onSnapshot } from "firebase/firestore";
import {
  Activity, Users, Percent, Bell, Download, Mail, Calendar, Settings,
  AlertCircle, Loader2, TrendingUp
} from "lucide-react";
import {
  PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { useNavigate } from "react-router-dom";

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
  const [revenueTrend, setRevenueTrend] = useState<any[]>([]);
  const [alerts,       setAlerts]       = useState<any[]>([]);
  const [selectedAlertBranch, setSelectedAlertBranch] = useState<string>("all");
  const [loading,      setLoading]      = useState(true);

  /* ── data fetch ─────────────────────────────────── */
  useEffect(() => {
    let alertsUnsub = () => {};

    const fetchAll = async () => {
      try {
        /* 1. All schools (branches) for current owner */
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        
        // Fetch branches from the actual branches subcollection
        const schoolsSnap = await getDocs(collection(db, "schools", uid, "branches"));
        const schoolDocs  = schoolsSnap.docs.map(d => ({ 
          id: d.data().branchId || d.data().schoolId || d.id, 
          ...d.data() as any 
        }));

        /* 2. Per-branch stats */
        const branchData = await Promise.all(
          schoolDocs.map(async (school) => {
            const sid = school.id;

            /* student count — use branchId for owner's branches */
            const enrollSnap  = await getDocs(query(collection(db, "enrollments"), where("branchId","==",sid)));
            const studentCount = enrollSnap.size;

            /* avg marks */
            const scoresSnap  = await getDocs(query(collection(db, "test_scores"), where("branchId","==",sid)));
            const allPct      = scoresSnap.docs
              .map(d => parseFloat(d.data().percentage ?? d.data().score ?? ""))
              .filter(n => !isNaN(n));
            const avgMarks    = allPct.length
              ? Math.round(allPct.reduce((a,b)=>a+b,0) / allPct.length)
              : 0;

            /* avg attendance */
            const attSnap     = await getDocs(query(collection(db, "attendance"), where("branchId","==",sid)));
            const presentCnt  = attSnap.docs.filter(d => (d.data().status||"").toLowerCase()==="present").length;
            const avgAtt      = attSnap.size ? Math.round((presentCnt / attSnap.size) * 100) : 0;

            /* AHI = 60% marks + 40% attendance */
            const schoolAHI   = avgMarks > 0 || avgAtt > 0
              ? Math.round(avgMarks * 0.6 + avgAtt * 0.4)
              : 0;

            return {
              id:       sid,
              name:     school.name || school.schoolName || "School",
              students: studentCount,
              ahi:      schoolAHI,
              avgMarks,
              avgAttendance: avgAtt,
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

      } catch(e) {
        console.error("Dashboard fetch error:", e);
      }
      setLoading(false);
    };

    fetchAll();

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

    return () => alertsUnsub();
  }, []);

  /* ── derived values for center of donut ────────────── */
  const lowPct = riskData.find(r=>r.name==="Low Risk")?.value ?? 0;

  const displayAlertsCount = activeAlerts;

  const filteredAlerts = alerts.filter(alert => {
    if (selectedAlertBranch === "all") return true;
    return alert.branchId === selectedAlertBranch || alert.schoolId === selectedAlertBranch;
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-10">

      {/* ── Header ───────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl md:text-3xl font-extrabold text-[#1e294b] tracking-tight">Executive Dashboard</h1>
        <p className="text-slate-500 text-xs md:text-sm font-medium">Real-time overview of all school operations</p>
      </div>

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
            {/* Center label */}
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
        </div>

        {/* Revenue Trend */}
        <div className="lg:col-span-4 bg-white rounded-3xl border border-slate-100 p-6 md:p-8 shadow-sm">
          <h3 className="text-base md:text-lg font-bold text-[#1e294b] mb-6">Revenue Trend</h3>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={revenueTrend}
                margin={{ top:10, right:10, left:-20, bottom:0 }}
              >
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#1e3a8a" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="month" axisLine={false} tickLine={false}
                  tick={{ fill:"#94a3b8", fontSize:12, fontWeight:500 }} dy={10}
                />
                <YAxis
                  axisLine={false} tickLine={false}
                  tick={{ fill:"#94a3b8", fontSize:12, fontWeight:500 }}
                />
                <Tooltip
                  formatter={(v:any) => [`${v}K`, "Revenue"]}
                  contentStyle={{ borderRadius:"16px", border:"none", boxShadow:"0 10px 15px rgba(0,0,0,0.1)" }}
                  itemStyle={{ fontWeight:"bold", fontSize:"12px" }}
                />
                <Area
                  type="monotone" dataKey="revenue"
                  stroke="#1e3a8a" strokeWidth={3}
                  fillOpacity={1} fill="url(#revGrad)"
                  dot={{ r:4, fill:"#1e3a8a", strokeWidth:2, stroke:"#fff" }}
                  activeDot={{ r:6, strokeWidth:0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
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
    </div>
  );
}
