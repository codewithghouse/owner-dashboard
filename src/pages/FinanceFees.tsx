import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  Search, Loader2, CheckCircle, XCircle, IndianRupee, ShieldAlert,
  TrendingDown, Brain, MessageCircle, Building2, ChevronDown, Filter,
  Wallet, AlertTriangle,
} from "lucide-react";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD, VIOLET,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, GRAD_RED,
  SHADOW_SM, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";
import { fetchFeePredictions, FeePrediction } from "@/lib/feePredictor";
import { sendFeeReminderWA } from "@/lib/whatsappService";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
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

/* ── types ──────────────────────────────────────────────── */
interface StudentFeeRow {
  className: string; rollNo: string; studentName: string;
  amounts: Record<string, number>; discount: number; paid: number; pending: number;
  parentPhone?: string; parentName?: string;
}
interface FeeStructureDoc {
  id: string; schoolId: string; branchId: string; branchName?: string;
  mode?: "class" | "student"; termTypes: string[];
  rows: { className: string; amounts: Record<string, number> }[];
  studentRows?: StudentFeeRow[];
  academicYear?: string; isActive: boolean;
}

type Defaulter = {
  sid: string;
  name: string;
  grade: string;
  branch: string;
  branchId: string;
  dueAmt: number;
  paidAmt: number;
  daysOverdue: number;
  prevLateCount: number;
  risk: ReturnType<typeof calcDefaultRisk>;
  feePlan: string;
  source: "fees" | "fee_structure";
  parentPhone?: string;
  parentName?: string;
};

export default function FinanceFees() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const pageShellStyle = usePageShellStyle();
  const [activeTab, setActiveTab] = useState<"Defaulters" | "History" | "Risk Analysis" | "Predictive Recovery">("Defaulters");
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("All");

  // Raw data
  const [allDefaulters, setAllDefaulters] = useState<Defaulter[]>([]);
  const [allFees,       setAllFees]       = useState<any[]>([]);
  const [branchNames,   setBranchNames]   = useState<string[]>([]);

  // Predictive recovery
  const [feePredictions, setFeePredictions] = useState<FeePrediction[]>([]);
  const [predStats, setPredStats]           = useState({ totalAtRisk: 0, expectedOutstanding: 0 });
  const [predLoading, setPredLoading]       = useState(false);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setLoading(true);

    const fetchAll = async () => {
      try {
        /* 1. Branches (scoped under this owner) */
        const bMap = new Map<string, string>();
        const bSnap = await getDocs(collection(db, "schools", uid, "branches"));
        bSnap.docs.forEach(d => {
          const data = d.data() as any;
          const bid  = data.branchId || d.id;
          const bn   = data.name || data.branchName || "";
          if (bid && bn) bMap.set(bid, bn);
        });
        setBranchNames([...bMap.values()].sort());

        /* 2. Fees collection (individual payment records) + fee_structure (uploaded plans) */
        const [feesSnap, fsSnap] = await Promise.all([
          getDocs(query(collection(db, "fees"),          where("schoolId", "==", uid))),
          getDocs(query(collection(db, "fee_structure"), where("schoolId", "==", uid), where("isActive", "==", true))),
        ]);

        const fees = feesSnap.docs.map(d => {
          const data = d.data() as any;
          return {
            id: d.id,
            ...data,
            branchName: data.branchName || bMap.get(data.branchId) || "Unknown",
          };
        });
        setAllFees(fees);

        const structures: FeeStructureDoc[] = fsSnap.docs.map(d => {
          const data = d.data() as any;
          return {
            id: d.id,
            ...data,
            branchName: data.branchName || bMap.get(data.branchId) || "Unknown",
          };
        });

        const today = new Date();
        const defaulterList: Defaulter[] = [];

        /* 3. Build defaulters from individual `fees` */
        const studentFeeMap = new Map<string, any[]>();
        fees.forEach(f => {
          const sid = f.studentId || f.studentEmail || f.id;
          if (!studentFeeMap.has(sid)) studentFeeMap.set(sid, []);
          studentFeeMap.get(sid)!.push(f);
        });
        studentFeeMap.forEach((studentFees, sid) => {
          const pending = studentFees.filter(f => (f.status || "").toLowerCase() !== "paid");
          const paid    = studentFees.filter(f => (f.status || "").toLowerCase() === "paid");
          if (pending.length === 0) return;

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
          const paidAmt = paid.reduce((a, f) => a + (parseFloat(f.amount ?? f.totalAmount ?? "0") || 0), 0);
          const prevLateCount = paid.filter(f => {
            const paidDate = f.paidAt?.toDate?.() || (f.paidAt ? new Date(f.paidAt) : null);
            const dueDate  = f.dueDate ? new Date(f.dueDate) : null;
            return paidDate && dueDate && paidDate > dueDate;
          }).length;
          const risk = calcDefaultRisk(maxDaysOverdue, prevLateCount, totalDue);
          const sample = studentFees[0];

          defaulterList.push({
            sid,
            name:     sample.studentName || "Unknown",
            grade:    sample.className   || sample.grade || "—",
            branch:   sample.branchName  || "Unknown",
            branchId: sample.branchId    || "",
            dueAmt:   totalDue,
            paidAmt,
            daysOverdue: maxDaysOverdue,
            prevLateCount,
            risk,
            feePlan:  sample.feePlan || sample.type || "Standard",
            source:   "fees",
            parentPhone: sample.parentPhone || sample.phone || sample.guardianPhone,
            parentName:  sample.parentName  || sample.guardianName,
          });
        });

        /* 4. Build defaulters from `fee_structure.studentRows` (new upload flow) */
        structures.forEach(s => {
          if (!s.studentRows || s.studentRows.length === 0) return;
          s.studentRows.forEach(st => {
            if (st.pending <= 0) return;
            const risk = calcDefaultRisk(0 /* no explicit overdue days yet */, 0, st.pending);
            defaulterList.push({
              sid:      `fs:${s.id}:${st.rollNo || st.studentName}`,
              name:     st.studentName,
              grade:    st.className,
              branch:   s.branchName || "Unknown",
              branchId: s.branchId,
              dueAmt:   st.pending,
              paidAmt:  st.paid,
              daysOverdue: 0,
              prevLateCount: 0,
              risk,
              feePlan:  "Structure",
              source:   "fee_structure",
              parentPhone: st.parentPhone || "",
              parentName:  st.parentName  || "",
            });
          });
        });

        defaulterList.sort((a, b) => b.risk.score - a.risk.score || b.dueAmt - a.dueAmt);
        setAllDefaulters(defaulterList);
      } catch (e) {
        console.error("FinanceFees fetch error:", e);
      }
      setLoading(false);
    };
    fetchAll();
  }, []);

  /* ── WhatsApp reminder handler ───────────────────────── */
  const [sendingSid, setSendingSid] = useState<string | null>(null);
  const handleSendReminder = async (d: Defaulter) => {
    let phone = d.parentPhone;
    if (!phone) {
      phone = prompt(
        `No phone on file for ${d.name}.\nEnter parent's WhatsApp number (with country code, e.g., +919876543210):`
      ) || "";
      if (!phone.trim()) return;
    }
    setSendingSid(d.sid);
    try {
      const result = await sendFeeReminderWA(phone, {
        parentName:  d.parentName || "Parent",
        studentName: d.name,
        amount:      d.dueAmt,
        schoolName:  d.branch,
      });
      if (result.success) toast.success(`Reminder sent to ${d.parentName || "parent"} of ${d.name}`);
      else                toast.error("Send failed: " + (result.error || "Unknown error"));
    } catch (e: any) {
      toast.error("Send failed: " + (e?.message || "Unknown"));
    }
    setSendingSid(null);
  };

  /* ── apply branch filter ──────────────────────────────── */
  const defaulters = useMemo(
    () => branchFilter === "All" ? allDefaulters : allDefaulters.filter(d => d.branch === branchFilter),
    [allDefaulters, branchFilter],
  );
  const feesFiltered = useMemo(
    () => branchFilter === "All" ? allFees : allFees.filter(f => f.branchName === branchFilter),
    [allFees, branchFilter],
  );

  /* ── stats (derived from filtered data) ───────────────── */
  const stats = useMemo(() => {
    const paidFees = feesFiltered.filter(f => (f.status || "").toLowerCase() === "paid");
    const collectedAmt = paidFees.reduce((a, f) => a + (parseFloat(f.amount ?? f.totalAmount ?? "0") || 0), 0);
    /* Also include paid from fee_structure defaulters' own paid amounts */
    const structurePaid = defaulters
      .filter(d => d.source === "fee_structure")
      .reduce((a, d) => a + d.paidAmt, 0);
    const outstanding = defaulters.reduce((a, d) => a + d.dueAmt, 0);
    const critical = defaulters.filter(d => d.daysOverdue > 60).length;
    return {
      total:       defaulters.length,
      critical,
      pending:     defaulters.length,
      collected:   paidFees.length,
      collectedAmt: Math.round(collectedAmt + structurePaid),
      outstanding:  Math.round(outstanding),
    };
  }, [defaulters, feesFiltered]);

  /* ── history (6-month collection vs pending) ──────────── */
  const historyData = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      return { label: MONTH_NAMES[d.getMonth()], month: d.getMonth(), year: d.getFullYear() };
    });
    return months.map(({ label, month, year }) => {
      const monthFees = feesFiltered.filter(f => {
        const ts = f.paidAt?.toDate?.() || f.createdAt?.toDate?.() || null;
        return ts && ts.getMonth() === month && ts.getFullYear() === year;
      });
      const collected = monthFees.filter(f => (f.status||"").toLowerCase()==="paid")
        .reduce((s,f) => s + (parseFloat(f.amount ?? f.totalAmount ?? "0") || 0), 0);
      const pending   = monthFees.filter(f => (f.status||"").toLowerCase()!=="paid")
        .reduce((s,f) => s + (parseFloat(f.amount ?? f.totalAmount ?? "0") || 0), 0);
      return { month: label, collected: Math.round(collected / 1000), pending: Math.round(pending / 1000) };
    });
  }, [feesFiltered]);

  /* ── branch revenue (always all branches, regardless of filter) ── */
  const branchRevenue = useMemo(() => {
    const map = new Map<string, { collected: number; pending: number }>();
    allFees.filter(f => (f.status || "").toLowerCase() === "paid").forEach(f => {
      const b = f.branchName || "Unknown";
      if (!map.has(b)) map.set(b, { collected: 0, pending: 0 });
      map.get(b)!.collected += parseFloat(f.amount ?? f.totalAmount ?? "0") || 0;
    });
    allDefaulters.forEach(d => {
      if (!map.has(d.branch)) map.set(d.branch, { collected: 0, pending: 0 });
      const m = map.get(d.branch)!;
      m.pending += d.dueAmt;
      if (d.source === "fee_structure") m.collected += d.paidAmt;
    });
    return [...map.entries()].map(([name, v]) => ({
      name,
      collected: Math.round(v.collected / 1000),
      pending:   Math.round(v.pending / 1000),
      total:     Math.round((v.collected + v.pending) / 1000),
    })).sort((a, b) => b.total - a.total);
  }, [allFees, allDefaulters]);

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
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 16 : 24 }}>

      <PageHead
        icon={Wallet}
        title="Finance & Fees"
        subtitle="Live fee collection · defaulter tracking · risk prediction"
        right={
          <div style={{ display:"flex", alignItems:"center", gap:8, width: isMobile ? "100%" : "auto" }}>
            {!isMobile && (
              <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:10, fontWeight:800, color:T4, letterSpacing:"0.12em", textTransform:"uppercase" }}>
                <Filter size={12}/> Branch
              </div>
            )}
            <div style={{ position:"relative", width: isMobile ? "100%" : "auto" }}>
              <Building2 size={13} color={T4} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}/>
              <select
                value={branchFilter}
                onChange={e => setBranchFilter(e.target.value)}
                style={{
                  appearance:"none", padding: isMobile ? "10px 34px 10px 34px" : "10px 34px 10px 34px",
                  borderRadius:12, border:"0.5px solid rgba(0,85,255,.12)",
                  background:"#fff", boxShadow:SHADOW_SM,
                  fontSize:12, fontWeight:700, color:T3,
                  outline:"none", fontFamily:"inherit", cursor:"pointer",
                  width: isMobile ? "100%" : "auto",
                  minWidth: isMobile ? 0 : 160,
                }}
              >
                <option value="All">All Branches</option>
                {branchNames.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <ChevronDown size={13} color={T4} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}/>
            </div>
          </div>
        }
      />

      {!loading && (
        <DarkHero
          icon={IndianRupee}
          eyebrow="Fee Intelligence"
          title={`₹${(stats.collectedAmt/1000).toFixed(1)}K`}
          subtitle={`Collected across ${branchNames.length} branches · ${stats.total} defaulter${stats.total!==1?"s":""} pending`}
          stats={[
            { label:"Outstanding", value:`₹${(stats.outstanding/1000).toFixed(1)}K` },
            { label:"Critical", value:stats.critical.toString() },
            { label:"Defaulters", value:stats.total.toString() },
          ]}
        />
      )}

      {/* Tabs */}
      <div style={{ display:"flex", gap: isMobile ? 6 : 8, overflowX:"auto", paddingBottom:2, WebkitOverflowScrolling:"touch" }}>
        {(["Defaulters", "History", "Risk Analysis", "Predictive Recovery"] as const).map(tab => {
          const active = activeTab === tab;
          return (
            <button key={tab}
              onClick={() => setActiveTab(tab)}
              className="dash-btn"
              style={{
                display:"inline-flex", alignItems:"center", gap: isMobile ? 5 : 6,
                padding: isMobile ? "8px 13px" : "10px 18px", borderRadius: isMobile ? 12 : 14,
                background: active ? GRAD_PRIMARY : "#fff",
                color: active ? "#fff" : T3,
                fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
                border: active ? "none" : "0.5px solid rgba(0,85,255,.12)",
                boxShadow: active ? SHADOW_BTN : SHADOW_SM,
                cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0,
              }}
            >
              {tab === "Predictive Recovery" && <Brain size={isMobile ? 12 : 13}/>}
              {isMobile && tab === "Predictive Recovery" ? "Predict" : isMobile && tab === "Risk Analysis" ? "Risk" : tab}
            </button>
          );
        })}
      </div>

      {/* Bright Stat Grid */}
      <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16 }}>
        <StatTile label="Total Defaulters" value={loading ? "—" : stats.total.toString()} sub="Pending fees" grad={stats.total > 0 ? GRAD_RED : GRAD_GOLD} icon={XCircle} onClick={() => navigate("/fee-structure")} />
        <StatTile label="Critical (>60d)"  value={loading ? "—" : stats.critical.toString()} sub="Urgent attention" grad={stats.critical > 0 ? GRAD_RED : GRAD_GOLD} icon={ShieldAlert} onClick={() => navigate("/fee-structure")} />
        <StatTile label="Fee Collected"    value={loading ? "—" : `₹${(stats.collectedAmt/1000).toFixed(1)}K`} sub="Healthy inflow" grad={GRAD_GREEN} icon={IndianRupee} onClick={() => navigate("/fee-structure")} />
        <StatTile label="Outstanding"      value={loading ? "—" : `₹${(stats.outstanding/1000).toFixed(1)}K`} sub="To be recovered" grad={GRAD_GOLD} icon={TrendingDown} onClick={() => navigate("/fee-structure")} />
      </div>

      {/* ── Charts row: Branch-wise Revenue + Monthly Collection Trend ── */}
      {!loading && (branchRevenue.length > 0 || historyData.some(h => h.collected > 0)) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
          {/* Branch-wise Revenue (horizontal bars) */}
          <div className="bg-white rounded-2xl md:rounded-3xl border border-slate-100 p-4 md:p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-[#1e294b]">Branch-wise Revenue</h3>
                <p className="text-[11px] text-slate-400 font-medium">Total collected per branch (₹ in thousands)</p>
              </div>
              <Building2 className="w-4 h-4 text-slate-400" />
            </div>
            {branchRevenue.length === 0 ? (
              <div className="h-[240px] flex items-center justify-center text-xs text-slate-400 font-semibold">
                No branch revenue yet
              </div>
            ) : (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={branchRevenue}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                    <XAxis
                      type="number"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: 600 }}
                      tickFormatter={(v) => `₹${v}K`}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      width={80}
                      tick={{ fill: "#64748b", fontSize: 11, fontWeight: 700 }}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
                      formatter={(v: any) => [`₹ ${v}K`, "Collected"]}
                    />
                    <Bar dataKey="collected" fill="#1e3a8a" radius={[0, 6, 6, 0]} barSize={18}>
                      {branchRevenue.map((_, i) => {
                        const shades = ["#1e3a8a", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe", "#dbeafe"];
                        return <Cell key={i} fill={shades[i % shades.length]} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Monthly Collection Trend (line) */}
          <div className="bg-white rounded-2xl md:rounded-3xl border border-slate-100 p-4 md:p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-[#1e294b]">Monthly Collection Trend</h3>
                <p className="text-[11px] text-slate-400 font-medium">Last 6 months · collected (₹ in thousands)</p>
              </div>
              <IndianRupee className="w-4 h-4 text-slate-400" />
            </div>
            {historyData.every(h => h.collected === 0) ? (
              <div className="h-[240px] flex items-center justify-center text-xs text-slate-400 font-semibold">
                No collection history yet
              </div>
            ) : (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="month"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: 600 }}
                      tickFormatter={(v) => `₹${v}K`}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
                      formatter={(v: any) => [`₹ ${v}K`, "Collected"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="collected"
                      stroke="#1e3a8a"
                      strokeWidth={2.5}
                      dot={{ fill: "#1e3a8a", r: 4, strokeWidth: 2, stroke: "#fff" }}
                      activeDot={{ r: 6, fill: "#1e3a8a", stroke: "#fff", strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Branch-wise revenue snapshot — always visible */}
      {!loading && branchRevenue.length > 0 && (() => {
        const totCollected = branchRevenue.reduce((a, b) => a + b.collected, 0);
        const totPending   = branchRevenue.reduce((a, b) => a + b.pending, 0);
        const totRevenue   = totCollected + totPending;
        const overallRate  = totRevenue > 0 ? Math.round((totCollected / totRevenue) * 100) : 0;
        const rateColor    = overallRate >= 75 ? "emerald" : overallRate >= 50 ? "amber" : "red";
        const topBranch    = [...branchRevenue].sort((a, b) => b.collected - a.collected)[0];
        const worstBranch  = [...branchRevenue]
          .map(b => ({ ...b, rate: (b.collected + b.pending) > 0 ? b.collected / (b.collected + b.pending) : 1 }))
          .sort((a, b) => a.rate - b.rate)[0];

        return (
        <div className="bg-white rounded-2xl md:rounded-3xl border border-slate-100 p-4 md:p-6 shadow-sm">
          {/* Header with summary KPIs */}
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 md:gap-4 mb-4 md:mb-6">
            <div>
              <h3 className="text-sm md:text-base font-extrabold text-[#1e294b] flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#1e3a8a]" /> Branch-wise Finance Snapshot
              </h3>
              <p className="text-[11px] md:text-xs text-slate-400 font-medium mt-0.5">
                {branchRevenue.length} branch{branchRevenue.length !== 1 ? "es" : ""} · ₹ in thousands · tap a branch to filter below
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 lg:min-w-[420px]">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2">
                <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">Collected</p>
                <p className="text-base md:text-lg font-extrabold text-emerald-700">₹ {totCollected}K</p>
              </div>
              <div className="rounded-xl border border-red-100 bg-red-50/60 px-3 py-2">
                <p className="text-[9px] font-black text-red-600 uppercase tracking-widest">Pending</p>
                <p className="text-base md:text-lg font-extrabold text-red-600">₹ {totPending}K</p>
              </div>
              <div className={`rounded-xl border px-3 py-2 ${
                rateColor === "emerald" ? "border-emerald-100 bg-emerald-50/60" :
                rateColor === "amber"   ? "border-amber-100 bg-amber-50/60"   :
                                          "border-red-100 bg-red-50/60"
              }`}>
                <p className={`text-[9px] font-black uppercase tracking-widest ${
                  rateColor === "emerald" ? "text-emerald-700" :
                  rateColor === "amber"   ? "text-amber-700"   : "text-red-600"
                }`}>Collection Rate</p>
                <p className={`text-base md:text-lg font-extrabold ${
                  rateColor === "emerald" ? "text-emerald-700" :
                  rateColor === "amber"   ? "text-amber-700"   : "text-red-600"
                }`}>{overallRate}%</p>
              </div>
            </div>
          </div>

          {/* Highlight ribbons — top & worst performer */}
          {branchRevenue.length > 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-50 to-white border border-emerald-100">
                <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white text-[10px] font-black">★</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">Top Collector</p>
                  <p className="text-xs font-extrabold text-[#1e294b] truncate">{topBranch.name} · ₹ {topBranch.collected}K</p>
                </div>
              </div>
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-50 to-white border border-red-100">
                <div className="w-8 h-8 rounded-lg bg-red-500 flex items-center justify-center text-white">
                  <TrendingDown className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-black text-red-600 uppercase tracking-widest">Needs Attention</p>
                  <p className="text-xs font-extrabold text-[#1e294b] truncate">
                    {worstBranch.name} · {Math.round(worstBranch.rate * 100)}% collected
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Chart */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Collected vs Pending by branch</p>
            <div className="flex items-center gap-3 text-[10px] font-bold">
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> <span className="text-slate-500">Collected</span></div>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-red-300" /> <span className="text-slate-500">Pending</span></div>
            </div>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={branchRevenue} margin={{ top: 5, right: 10, left: -10, bottom: 0 }} barCategoryGap="35%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${v}K`} />
                <Tooltip
                  contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
                  formatter={(v: any, name: string) => [`₹ ${v}K`, name]}
                  cursor={{ fill: "rgba(30, 58, 138, 0.04)" }}
                />
                <Bar dataKey="collected" name="Collected" fill="#22c55e" radius={[6, 6, 0, 0]} maxBarSize={60} />
                <Bar dataKey="pending"   name="Pending"   fill="#fca5a5" radius={[6, 6, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Per-branch cards with collection rate bars */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
            {branchRevenue.map(b => {
              const total = b.collected + b.pending;
              const rate  = total > 0 ? Math.round((b.collected / total) * 100) : 0;
              const isActive = branchFilter === b.name;
              const rateTone =
                rate >= 75 ? "text-emerald-600"
                : rate >= 50 ? "text-amber-600"
                : "text-red-600";
              const rateBar =
                rate >= 75 ? "bg-emerald-500"
                : rate >= 50 ? "bg-amber-500"
                : "bg-red-500";
              return (
                <div
                  key={b.name}
                  onClick={() => setBranchFilter(isActive ? "All" : b.name)}
                  role="button"
                  tabIndex={0}
                  className={`clickable-card p-4 rounded-2xl border cursor-pointer transition-all ${
                    isActive
                      ? "border-[#1e3a8a] bg-blue-50/60 shadow-md ring-1 ring-[#1e3a8a]/20"
                      : "border-slate-100 bg-white hover:bg-slate-50/60"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isActive ? "bg-[#1e3a8a] text-white" : "bg-slate-100 text-slate-500"
                      }`}>
                        <Building2 className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-sm font-extrabold text-[#1e294b] truncate">{b.name}</p>
                    </div>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                      rate >= 75 ? "bg-emerald-50 text-emerald-700"
                      : rate >= 50 ? "bg-amber-50 text-amber-700"
                      : "bg-red-50 text-red-600"
                    }`}>
                      {rate}%
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <p className="text-[9px] font-black text-emerald-600 uppercase tracking-wider">Collected</p>
                      <p className="text-sm font-extrabold text-emerald-700">₹ {b.collected}K</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-red-500 uppercase tracking-wider">Pending</p>
                      <p className="text-sm font-extrabold text-red-600">₹ {b.pending}K</p>
                    </div>
                  </div>

                  {/* Collection rate bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[9px] font-bold">
                      <span className="text-slate-400 uppercase tracking-widest">Collection</span>
                      <span className={rateTone}>{rate}% of ₹{total}K</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full ${rateBar} rounded-full transition-all duration-500`}
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      {/* ── DEFAULTERS TAB ─────────────────────────────────────────────────── */}
      {activeTab === "Defaulters" && (
        <div className="space-y-4 md:space-y-6 animate-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 md:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or grade..."
                className="pl-10 h-10 bg-white border-slate-100 rounded-xl text-xs font-semibold" />
            </div>
          </div>

          <div className="bg-white rounded-2xl md:rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
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
            ) : isMobile ? (
              <div className="flex flex-col gap-2 p-3">
                {filtered.map((d) => (
                  <div key={d.sid} className="rounded-xl border border-slate-100 bg-slate-50/40 p-3">
                    <div className="flex items-center gap-2.5 mb-2.5">
                      <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-[11px] font-black text-slate-500 shrink-0">
                        {d.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-extrabold text-[#1e294b] truncate">{d.name}</p>
                        <p className="text-[10px] font-semibold text-slate-400 truncate">{d.grade} · {d.branch}</p>
                      </div>
                      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-black shrink-0 ${d.risk.bg} ${d.risk.color}`}>
                        <div className="w-1.5 h-1.5 rounded-full bg-current" />
                        {d.risk.level}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2.5">
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Due</p>
                        <p className="text-[12px] font-extrabold text-[#1e294b]">₹{d.dueAmt.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Overdue</p>
                        <p className={`text-[12px] font-extrabold ${d.daysOverdue > 60 ? "text-red-500" : d.daysOverdue > 30 ? "text-amber-500" : "text-slate-500"}`}>
                          {d.daysOverdue > 0 ? `${d.daysOverdue}d` : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Prev Late</p>
                        <p className="text-[12px] font-extrabold text-slate-600">{d.prevLateCount}×</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleSendReminder(d)}
                      disabled={sendingSid === d.sid}
                      className="w-full flex items-center justify-center gap-1 text-[10px] font-black text-white bg-[#1e3a8a] hover:bg-[#1e294b] px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {sendingSid === d.sid ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Sending...</>
                      ) : (
                        <><MessageCircle className="w-3 h-3" /> Send Reminder</>
                      )}
                    </button>
                  </div>
                ))}
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
                          <button
                            onClick={() => handleSendReminder(d)}
                            disabled={sendingSid === d.sid}
                            className="flex items-center gap-1 text-[10px] font-black text-white bg-[#1e3a8a] hover:bg-[#1e294b] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {sendingSid === d.sid ? (
                              <><Loader2 className="w-3 h-3 animate-spin" /> Sending...</>
                            ) : (
                              <><MessageCircle className="w-3 h-3" /> Send Reminder</>
                            )}
                          </button>
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
        <div className="space-y-4 md:space-y-6 animate-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            <div className="bg-white rounded-2xl md:rounded-3xl border border-slate-100 p-4 md:p-6 shadow-sm">
              <h3 className="text-sm font-bold text-[#1e294b] mb-1">Monthly Collection vs Pending</h3>
              <p className="text-xs text-slate-400 font-medium mb-4 md:mb-5">₹ in thousands (K) — last 6 months</p>
              <div className="h-[220px] md:h-[240px]">
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
            <div className="bg-white rounded-2xl md:rounded-3xl border border-slate-100 p-4 md:p-6 shadow-sm">
              <h3 className="text-sm font-bold text-[#1e294b] mb-1">Branch-wise Revenue</h3>
              <p className="text-xs text-slate-400 font-medium mb-4 md:mb-5">Total collected per branch (₹K)</p>
              <div className="h-[220px] md:h-[240px]">
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
        <div className="space-y-4 md:space-y-6 animate-in slide-in-from-bottom-4 duration-500">

          {/* Risk explanation banner */}
          <div className="bg-amber-50 border border-amber-100 rounded-xl md:rounded-2xl p-3 md:p-5 flex items-start gap-3 md:gap-4">
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg md:rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4 md:w-5 md:h-5 text-amber-600" />
            </div>
            <div>
              <h4 className="text-[13px] md:text-sm font-bold text-amber-800 mb-1">How Default Risk is Calculated</h4>
              <p className="text-[11px] md:text-xs text-amber-700 leading-relaxed">
                Each student receives a risk score (0–100) based on: <strong>days overdue</strong> (up to 80 pts),
                <strong> previous late payment history</strong> (up to 15 pts), and <strong>outstanding amount</strong> (5 pts).
                High risk (≥60) = intervention required. Medium (30–59) = send reminder. Low (&lt;30) = monitor only.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">

            {/* Risk pie */}
            <div className="lg:col-span-5 bg-white rounded-2xl md:rounded-3xl border border-slate-100 p-4 md:p-6 shadow-sm">
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
            <div className="lg:col-span-7 bg-white rounded-2xl md:rounded-3xl border border-slate-100 p-4 md:p-6 shadow-sm">
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
                      <button
                        onClick={() => handleSendReminder(d)}
                        disabled={sendingSid === d.sid}
                        className="flex items-center gap-1 text-[10px] font-black text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors shrink-0 disabled:opacity-50"
                      >
                        {sendingSid === d.sid ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /> Sending</>
                        ) : (
                          <><MessageCircle className="w-3 h-3" /> Alert</>
                        )}
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
        <div className="space-y-4 md:space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3 bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-100 rounded-xl md:rounded-2xl p-3 md:p-4">
            <div className="w-9 h-9 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-violet-600 flex items-center justify-center shrink-0">
              <Brain className="w-4 h-4 md:w-5 md:h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] md:text-sm font-black text-[#1e294b]">AI-Powered Fee Default Prediction</p>
              <p className="text-[10px] md:text-xs text-slate-500 font-medium leading-snug">
                Students likely to default next month — based on payment history, attendance &amp; balance.
              </p>
            </div>
            {!predLoading && feePredictions.length > 0 && (
              <div className="text-right shrink-0">
                <p className="text-lg md:text-xl font-black text-violet-600">{predStats.totalAtRisk}</p>
                <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase">At Risk</p>
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
          ) : isMobile ? (
            <div className="flex flex-col gap-2">
              {feePredictions.map(p => (
                <div key={p.studentId} className="bg-white rounded-xl border border-slate-100 shadow-sm p-3">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-[11px] font-black text-white shrink-0 ${
                      p.riskLevel === "High" ? "bg-red-500" : p.riskLevel === "Medium" ? "bg-amber-500" : "bg-emerald-400"
                    }`}>
                      {p.studentName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-extrabold text-[#1e294b] truncate">{p.studentName}</p>
                      <p className="text-[10px] font-semibold text-slate-400 truncate">{p.grade} · {p.branch}</p>
                    </div>
                    <span className={`text-[9px] font-black px-2 py-1 rounded-full shrink-0 ${
                      p.riskLevel === "High"   ? "bg-red-50 text-red-600" :
                      p.riskLevel === "Medium" ? "bg-amber-50 text-amber-600" :
                      "bg-emerald-50 text-emerald-600"
                    }`}>
                      {p.riskLevel} · {p.defaultProbability}%
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-2.5">
                    <div>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Outstanding</p>
                      <p className="text-[12px] font-extrabold text-slate-700">
                        {p.outstandingAmt > 0 ? `₹${p.outstandingAmt.toLocaleString("en-IN")}` : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Late Pays</p>
                      <p className="text-[12px] font-extrabold text-slate-600">{p.latePayments}</p>
                    </div>
                    <div>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Attendance</p>
                      <p className={`text-[12px] font-extrabold ${p.attendancePct < 75 ? "text-red-600" : "text-slate-600"}`}>
                        {p.attendancePct}%
                      </p>
                    </div>
                  </div>
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
                      className="w-full flex items-center justify-center gap-1 text-[10px] font-black text-white bg-green-500 hover:bg-green-600 px-3 py-2 rounded-lg transition-colors"
                    >
                      <MessageCircle className="w-3 h-3" />
                      WhatsApp Remind
                    </button>
                  )}
                </div>
              ))}
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

      {!loading && (
        <AIInsightCard
          title="Finance Intelligence Summary"
          items={[
            { label:"Collection Health", value: stats.collectedAmt > 0 ? `₹${(stats.collectedAmt/1000).toFixed(1)}K inflow` : "Awaiting data", sub: stats.outstanding > stats.collectedAmt ? "Recovery needed" : "Healthy" },
            { label:"Risk Queue",        value: stats.critical > 0 ? `${stats.critical} critical` : "All under control", sub: stats.total > 0 ? `${stats.total} total defaulters` : "Zero defaulters" },
            { label:"Recovery Focus",    value: stats.outstanding > 0 ? `₹${(stats.outstanding/1000).toFixed(1)}K pending` : "Clean books", sub: stats.outstanding > 0 ? "Trigger reminders" : "Keep monitoring" },
          ]}
        />
      )}

      </div>
    </>
  );
}
