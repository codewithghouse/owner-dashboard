import { useState, useEffect } from "react";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  TrendingUp, Search, AlertTriangle, Loader2,
  CheckCircle, Clock, XCircle, IndianRupee, ShieldAlert, TrendingDown, BarChart3,
  Brain, MessageCircle,
} from "lucide-react";
import { fetchFeePredictions, FeePrediction } from "@/lib/feePredictor";
import { sendFeeReminderWA } from "@/lib/whatsappService";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, Legend
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Risk of future default scoring ─────────────────────────────────────────
// Inputs: daysOverdue, previousLateCount, totalDue amount
// Score 0-100 → Low/Medium/High risk
function calcDefaultRisk(daysOverdue: number, prevLateCount: number, totalDue: number): {
  score: number; level: "Low" | "Medium" | "High"; color: string; bg: string;
} {
  let score = 0;
  // Days overdue weight: 0-30d=20pts, 31-60d=40pts, 61-90d=60pts, >90d=80pts
  if (daysOverdue > 90)     score += 80;
  else if (daysOverdue > 60) score += 60;
  else if (daysOverdue > 30) score += 40;
  else if (daysOverdue > 0)  score += 20;
  // Repeat late behaviour: each previous late adds 5pts (max 15)
  score += Math.min(prevLateCount * 5, 15);
  // High amount outstanding adds 5pts
  if (totalDue > 10000) score += 5;
  score = Math.min(score, 100);
  if (score >= 60) return { score, level: "High",   color: "text-red-600",   bg: "bg-red-50" };
  if (score >= 30) return { score, level: "Medium",  color: "text-amber-600", bg: "bg-amber-50" };
  return             { score, level: "Low",    color: "text-green-600", bg: "bg-green-50" };
}

export default function FinanceFees() {
  const [activeTab, setActiveTab] = useState<"Defaulters" | "History" | "Risk Analysis" | "Predictive Recovery">("Defaulters");
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");

  // Live data
  const [defaulters,    setDefaulters]    = useState<any[]>([]);
  const [historyData,   setHistoryData]   = useState<any[]>([]);
  const [stats,         setStats]         = useState({ total: 0, critical: 0, pending: 0, collected: 0, collectedAmt: 0, outstanding: 0 });
  const [branchRevenue, setBranchRevenue] = useState<any[]>([]);
  // Predictive recovery
  const [feePredictions, setFeePredictions] = useState<FeePrediction[]>([]);
  const [predStats, setPredStats]           = useState({ totalAtRisk: 0, expectedOutstanding: 0 });
  const [predLoading, setPredLoading]       = useState(false);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setLoading(true);

    const fetchFees = async () => {
      try {
        const feesSnap = await getDocs(query(collection(db, "fees"), where("schoolId", "==", uid)));
        const fees = feesSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));

        const today = new Date();

        // ── Build defaulters list ──────────────────────────────────────────
        // Per-student fee map
        const studentFeeMap = new Map<string, any[]>();
        fees.forEach(f => {
          const sid = f.studentId || f.studentEmail || f.id;
          if (!studentFeeMap.has(sid)) studentFeeMap.set(sid, []);
          studentFeeMap.get(sid)!.push(f);
        });

        const defaulterList: any[] = [];
        let totalOutstanding = 0;
        let criticalCount = 0;
        let pendingCount  = 0;
        let collectedAmt  = 0;

        studentFeeMap.forEach((studentFees, sid) => {
          const pending = studentFees.filter(f => (f.status || "").toLowerCase() !== "paid");
          const paid    = studentFees.filter(f => (f.status || "").toLowerCase() === "paid");

          if (pending.length === 0) return; // no pending = not a defaulter

          // Calculate days overdue from dueDate
          let maxDaysOverdue = 0;
          let totalDue = 0;
          pending.forEach(f => {
            const due = f.dueDate ? new Date(f.dueDate) : null;
            if (due && due < today) {
              const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
              if (days > maxDaysOverdue) maxDaysOverdue = days;
            }
            totalDue += parseFloat(f.amount ?? f.totalAmount ?? "0") || 0;
          });

          paid.forEach(f => {
            collectedAmt += parseFloat(f.amount ?? f.totalAmount ?? "0") || 0;
          });

          totalOutstanding += totalDue;
          const prevLateCount = paid.filter(f => {
            const paidDate = f.paidAt?.toDate?.() || (f.paidAt ? new Date(f.paidAt) : null);
            const dueDate  = f.dueDate ? new Date(f.dueDate) : null;
            return paidDate && dueDate && paidDate > dueDate;
          }).length;

          const risk = calcDefaultRisk(maxDaysOverdue, prevLateCount, totalDue);

          if (maxDaysOverdue > 60) criticalCount++;
          pendingCount++;

          const sample = studentFees[0];
          defaulterList.push({
            sid,
            name:       sample.studentName  || "Unknown",
            grade:      sample.className    || sample.grade || "—",
            branch:     sample.branchName   || sample.branchId || "—",
            dueAmt:     totalDue,
            daysOverdue: maxDaysOverdue,
            prevLateCount,
            risk,
            feePlan:    sample.feePlan || sample.type || "Standard",
          });
        });

        defaulterList.sort((a, b) => b.risk.score - a.risk.score);

        setDefaulters(defaulterList);
        setStats({
          total:        defaulterList.length,
          critical:     criticalCount,
          pending:      pendingCount,
          collected:    fees.filter(f => (f.status||"").toLowerCase()==="paid").length,
          collectedAmt: Math.round(collectedAmt),
          outstanding:  Math.round(totalOutstanding),
        });

        // ── History: monthly fee collection ─────────────────────────────
        const now = new Date();
        const months = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
          return { label: MONTH_NAMES[d.getMonth()], month: d.getMonth(), year: d.getFullYear() };
        });
        const history = months.map(({ label, month, year }) => {
          const monthFees = fees.filter(f => {
            const ts = f.paidAt?.toDate?.() || f.createdAt?.toDate?.() || null;
            return ts && ts.getMonth() === month && ts.getFullYear() === year;
          });
          const collected = monthFees.filter(f => (f.status||"").toLowerCase()==="paid")
            .reduce((s,f) => s + (parseFloat(f.amount ?? f.totalAmount ?? "0") || 0), 0);
          const pending   = monthFees.filter(f => (f.status||"").toLowerCase()!=="paid")
            .reduce((s,f) => s + (parseFloat(f.amount ?? f.totalAmount ?? "0") || 0), 0);
          return { month: label, collected: Math.round(collected / 1000), pending: Math.round(pending / 1000) };
        });
        setHistoryData(history);

        // ── Branch revenue ──────────────────────────────────────────────
        const branchMap: Record<string, number> = {};
        fees.filter(f => (f.status||"").toLowerCase()==="paid").forEach(f => {
          const b = f.branchName || f.branchId || "Unknown";
          branchMap[b] = (branchMap[b] || 0) + (parseFloat(f.amount ?? f.totalAmount ?? "0") || 0);
        });
        setBranchRevenue(Object.entries(branchMap).map(([name, value]) => ({ name, value: Math.round(value / 1000) })));

      } catch (e) {
        console.error("FinanceFees fetch error:", e);
      }
      setLoading(false);
    };
    fetchFees();
  }, []);

  // Load fee predictions when that tab is selected
  useEffect(() => {
    if (activeTab !== "Predictive Recovery" || feePredictions.length > 0) return;
    setPredLoading(true);
    fetchFeePredictions().then(({ predictions, totalAtRisk, expectedOutstanding }) => {
      setFeePredictions(predictions);
      setPredStats({ totalAtRisk, expectedOutstanding });
      setPredLoading(false);
    });
  }, [activeTab]);

  const filtered = defaulters.filter(d =>
    !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.grade.toLowerCase().includes(search.toLowerCase())
  );

  const highRisk   = defaulters.filter(d => d.risk.level === "High");
  const medRisk    = defaulters.filter(d => d.risk.level === "Medium");
  const lowRisk    = defaulters.filter(d => d.risk.level === "Low");
  const riskPie = [
    { name: "High Risk",   value: highRisk.length,  color: "#ef4444" },
    { name: "Medium Risk", value: medRisk.length,   color: "#f59e0b" },
    { name: "Low Risk",    value: lowRisk.length,   color: "#22c55e" },
  ].filter(r => r.value > 0);

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">

      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl md:text-3xl font-extrabold text-[#1e294b] tracking-tight">Finance & Fees</h1>
        <p className="text-slate-400 text-xs md:text-sm font-medium">Live fee collection · Defaulter tracking · Default risk prediction</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        {(["Defaulters", "History", "Risk Analysis", "Predictive Recovery"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm flex items-center gap-1.5 ${
              activeTab === tab ? "bg-[#1e3a8a] text-white" : "bg-white text-slate-500 hover:bg-slate-50 border border-slate-100"
            }`}>
            {tab === "Predictive Recovery" && <Brain className="w-3 h-3" />}
            {tab}
          </button>
        ))}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Defaulters",  value: loading ? "—" : stats.total.toString(),              icon: XCircle,     color: "text-red-500",   bg: "bg-red-50"    },
          { label: "Critical (>60d)",   value: loading ? "—" : stats.critical.toString(),           icon: ShieldAlert, color: "text-orange-500", bg: "bg-orange-50" },
          { label: "Fee Collected (₹)", value: loading ? "—" : `₹${(stats.collectedAmt/1000).toFixed(1)}K`, icon: IndianRupee, color: "text-green-500",bg: "bg-green-50"},
          { label: "Outstanding (₹)",   value: loading ? "—" : `₹${(stats.outstanding/1000).toFixed(1)}K`,  icon: TrendingDown,color:"text-amber-500",bg:"bg-amber-50"},
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-slate-500 font-semibold">{s.label}</span>
              <div className={`p-2 rounded-lg ${s.bg}`}><s.icon className={`w-4 h-4 ${s.color}`} /></div>
            </div>
            {loading ? <Loader2 className="w-5 h-5 animate-spin text-slate-300" /> :
              <div className="text-2xl font-bold text-[#1e294b]">{s.value}</div>}
          </div>
        ))}
      </div>

      {/* ── DEFAULTERS TAB ─────────────────────────────────────────────────── */}
      {activeTab === "Defaulters" && (
        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or grade..."
                className="pl-10 h-10 bg-white border-slate-100 rounded-xl text-xs font-semibold" />
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <CheckCircle className="w-8 h-8 text-green-300 mb-2" />
                <p className="text-sm font-semibold text-slate-400">No defaulters found</p>
                <p className="text-xs text-slate-300 mt-1">All fee records are up to date</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[720px]">
                  <thead>
                    <tr className="bg-slate-50/50">
                      {["Student", "Grade", "Branch", "Due Amount", "Days Overdue", "Prev. Late", "Default Risk", "Action"].map(h => (
                        <th key={h} className="py-4 px-5 text-[9px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filtered.map((d) => (
                      <tr key={d.sid} className="hover:bg-slate-50/40 transition-colors">
                        <td className="py-4 px-5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-[11px] font-black text-slate-500">
                              {d.name.substring(0, 2).toUpperCase()}
                            </div>
                            <span className="text-xs font-bold text-[#1e294b]">{d.name}</span>
                          </div>
                        </td>
                        <td className="py-4 px-5 text-xs text-slate-500 font-medium">{d.grade}</td>
                        <td className="py-4 px-5 text-xs text-slate-500 font-medium">{d.branch}</td>
                        <td className="py-4 px-5 text-xs font-bold text-[#1e294b]">₹{d.dueAmt.toLocaleString()}</td>
                        <td className="py-4 px-5">
                          <span className={`text-xs font-bold ${d.daysOverdue > 60 ? "text-red-500" : d.daysOverdue > 30 ? "text-amber-500" : "text-slate-500"}`}>
                            {d.daysOverdue > 0 ? `${d.daysOverdue}d` : "Not yet due"}
                          </span>
                        </td>
                        <td className="py-4 px-5 text-xs font-bold text-slate-500">{d.prevLateCount}×</td>
                        <td className="py-4 px-5">
                          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black ${d.risk.bg} ${d.risk.color}`}>
                            <div className="w-1.5 h-1.5 rounded-full bg-current" />
                            {d.risk.level} ({d.risk.score})
                          </div>
                        </td>
                        <td className="py-4 px-5">
                          <button className="text-[10px] font-black text-[#1e3a8a] hover:underline">Send Reminder</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── HISTORY TAB ─────────────────────────────────────────────────────── */}
      {activeTab === "History" && (
        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
              <h3 className="text-sm font-bold text-[#1e294b] mb-1">Monthly Collection vs Pending</h3>
              <p className="text-xs text-slate-400 font-medium mb-5">₹ in thousands (K) — last 6 months</p>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={historyData} margin={{ top:5, right:5, left:-20, bottom:0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill:"#94a3b8", fontSize:11, fontWeight:600 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill:"#94a3b8", fontSize:11, fontWeight:600 }} />
                    <Tooltip contentStyle={{ borderRadius:"12px", border:"none", boxShadow:"0 4px 20px rgba(0,0,0,0.1)" }}
                      formatter={(v: any, name: string) => [`₹${v}K`, name]} />
                    <Legend wrapperStyle={{ fontSize:11, fontWeight:700, paddingTop:8 }} />
                    <Bar dataKey="collected" name="Collected" fill="#22c55e" radius={[6,6,0,0]} />
                    <Bar dataKey="pending"   name="Pending"   fill="#fca5a5" radius={[6,6,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
              <h3 className="text-sm font-bold text-[#1e294b] mb-1">Branch-wise Revenue</h3>
              <p className="text-xs text-slate-400 font-medium mb-5">Total collected per branch (₹K)</p>
              <div className="h-[240px]">
                {branchRevenue.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-xs text-slate-300 font-medium">No branch data available</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={branchRevenue} layout="vertical" margin={{ top:5, right:20, left:60, bottom:0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill:"#94a3b8", fontSize:11 }} />
                      <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill:"#64748b", fontSize:11, fontWeight:600 }} />
                      <Tooltip formatter={(v:any) => [`₹${v}K`, "Revenue"]}
                        contentStyle={{ borderRadius:"12px", border:"none", boxShadow:"0 4px 20px rgba(0,0,0,0.1)" }} />
                      <Bar dataKey="value" fill="#1e3a8a" radius={[0,6,6,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RISK ANALYSIS TAB ───────────────────────────────────────────────── */}
      {activeTab === "Risk Analysis" && (
        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">

          {/* Risk explanation banner */}
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex items-start gap-4">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-800 mb-1">How Default Risk is Calculated</h4>
              <p className="text-xs text-amber-700 leading-relaxed">
                Each student receives a risk score (0–100) based on: <strong>days overdue</strong> (up to 80 pts),
                <strong> previous late payment history</strong> (up to 15 pts), and <strong>outstanding amount</strong> (5 pts).
                High risk (≥60) = intervention required. Medium (30–59) = send reminder. Low (&lt;30) = monitor only.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* Risk pie */}
            <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
              <h3 className="text-sm font-bold text-[#1e294b] mb-5">Risk Distribution</h3>
              {loading ? (
                <div className="flex items-center justify-center h-52"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>
              ) : riskPie.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-52">
                  <CheckCircle className="w-8 h-8 text-green-200 mb-2" />
                  <p className="text-xs text-slate-400 font-medium">No fee defaulters found</p>
                </div>
              ) : (
                <>
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={riskPie} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                          paddingAngle={4} cornerRadius={6} dataKey="value" stroke="none">
                          {riskPie.map((e) => <Cell key={e.name} fill={e.color} />)}
                        </Pie>
                        <Tooltip formatter={(v:any, name:string) => [v, name]}
                          contentStyle={{ borderRadius:"12px", border:"none", boxShadow:"0 4px 20px rgba(0,0,0,0.1)" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-2 mt-2">
                    {riskPie.map(r => (
                      <div key={r.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />
                          <span className="text-xs font-semibold text-slate-600">{r.name}</span>
                        </div>
                        <span className="text-xs font-bold text-[#1e294b]">{r.value} students</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* High risk list */}
            <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold text-[#1e294b]">High Risk Students</h3>
                <span className="text-[10px] font-black text-red-500 bg-red-50 px-2.5 py-1 rounded-full">{highRisk.length} students</span>
              </div>
              {loading ? (
                <div className="flex items-center justify-center h-40"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>
              ) : highRisk.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40">
                  <CheckCircle className="w-7 h-7 text-green-200 mb-2" />
                  <p className="text-xs text-slate-400 font-medium">No high risk defaulters</p>
                </div>
              ) : (
                <div className="space-y-3 overflow-y-auto max-h-[320px] pr-1">
                  {highRisk.map(d => (
                    <div key={d.sid} className="flex items-center gap-3 p-3 bg-red-50/60 rounded-xl border border-red-100">
                      <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-[11px] font-black text-red-600 shrink-0">
                        {d.name.substring(0,2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#1e294b] truncate">{d.name}</span>
                          <span className="text-[9px] font-black text-red-600 bg-red-100 px-2 py-0.5 rounded-full shrink-0">Score: {d.risk.score}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                          {d.grade} · ₹{d.dueAmt.toLocaleString()} due · {d.daysOverdue}d overdue · {d.prevLateCount} prev. late
                        </div>
                      </div>
                      <button className="text-[10px] font-black text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors shrink-0">
                        Alert
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Predictive Recovery Tab ───────────────────────────────────────── */}
      {activeTab === "Predictive Recovery" && (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3 bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-100 rounded-2xl p-4">
            <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center shrink-0">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-black text-[#1e294b]">AI-Powered Fee Default Prediction</p>
              <p className="text-xs text-slate-500 font-medium">
                Students likely to default next month — based on payment history, attendance &amp; balance.
              </p>
            </div>
            {!predLoading && feePredictions.length > 0 && (
              <div className="text-right shrink-0">
                <p className="text-xl font-black text-violet-600">{predStats.totalAtRisk}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase">At Risk</p>
              </div>
            )}
          </div>

          {/* Stats */}
          {!predLoading && feePredictions.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 text-center">
                <p className="text-2xl font-black text-red-600">{predStats.totalAtRisk}</p>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Students at risk</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Medium + High risk combined</p>
              </div>
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 text-center">
                <p className="text-2xl font-black text-amber-600">
                  ₹{predStats.expectedOutstanding.toLocaleString("en-IN")}
                </p>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Outstanding amount</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Recoverable with proactive reminders</p>
              </div>
            </div>
          )}

          {/* Student list */}
          {predLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="text-center space-y-2">
                <Brain className="w-8 h-8 text-violet-400 mx-auto animate-pulse" />
                <p className="text-xs font-bold text-slate-400">Analysing payment patterns…</p>
              </div>
            </div>
          ) : feePredictions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 bg-white rounded-2xl border border-slate-100">
              <CheckCircle className="w-8 h-8 text-emerald-300" />
              <p className="text-sm font-bold text-slate-400">No fee default risks detected.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[680px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      {["Student", "Branch", "Outstanding", "Late Payments", "Attendance", "Risk", "Action"].map(h => (
                        <th key={h} className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {feePredictions.map(p => (
                      <tr key={p.studentId} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black text-white shrink-0 ${
                              p.riskLevel === "High" ? "bg-red-500" : p.riskLevel === "Medium" ? "bg-amber-500" : "bg-emerald-400"
                            }`}>
                              {p.studentName.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-xs font-bold text-[#1e294b]">{p.studentName}</p>
                              <p className="text-[10px] text-slate-400">{p.grade}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">{p.branch}</td>
                        <td className="px-4 py-3 text-xs font-black text-slate-700">
                          {p.outstandingAmt > 0 ? `₹${p.outstandingAmt.toLocaleString("en-IN")}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-slate-600">{p.latePayments}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-black ${p.attendancePct < 75 ? "text-red-600" : "text-slate-600"}`}>
                            {p.attendancePct}%
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${
                            p.riskLevel === "High"   ? "bg-red-50 text-red-600" :
                            p.riskLevel === "Medium" ? "bg-amber-50 text-amber-600" :
                            "bg-emerald-50 text-emerald-600"
                          }`}>
                            {p.riskLevel} · {p.defaultProbability}%
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {p.riskLevel !== "Low" && (
                            <button
                              onClick={() => {
                                const phone = prompt(`Send WhatsApp reminder to parent of ${p.studentName}?\nEnter phone number (with country code, e.g. +919876543210):`);
                                if (!phone) return;
                                sendFeeReminderWA(phone, {
                                  parentName:  "Parent",
                                  studentName: p.studentName,
                                  amount:      p.outstandingAmt,
                                  schoolName:  p.branch,
                                }).then(r => {
                                  if (r.success) toast.success("WhatsApp reminder sent!");
                                  else toast.error("Failed: " + (r.error || "Unknown error"));
                                });
                              }}
                              className="flex items-center gap-1 text-[10px] font-black text-white bg-green-500 hover:bg-green-600 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              <MessageCircle className="w-3 h-3" />
                              WA Remind
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
