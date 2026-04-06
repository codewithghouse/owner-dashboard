import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, BarChart, Bar,
} from "recharts";
import { ArrowLeft, CheckCircle, AlertTriangle, Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  subscribeBranchesComparison, subscribeBranchDetail,
  BranchComparisonData, BranchDetailData,
} from "@/lib/branchesService";
import { toast } from "sonner";

export default function BranchesComparison() {
  const { id }     = useParams();
  const navigate   = useNavigate();
  const [listData,   setListData]   = useState<BranchComparisonData | null>(null);
  const [detailData, setDetailData] = useState<BranchDetailData | null>(null);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    setLoading(true);
    setListData(null);
    setDetailData(null);

    if (id) {
      const unsub = subscribeBranchDetail(
        id,
        d => { setDetailData(d); setLoading(false); },
        err => { console.error(err); toast.error("Failed to load branch details."); setLoading(false); }
      );
      return unsub;
    } else {
      const unsub = subscribeBranchesComparison(
        d => { setListData(d); setLoading(false); },
        err => { console.error(err); toast.error("Failed to load branches data."); setLoading(false); }
      );
      return unsub;
    }
  }, [id]);

  // ── Metric color helper ───────────────────────────────────────────────────
  const metricColor = (v: number) =>
    v >= 85 ? "text-[#22c55e]" : v >= 70 ? "text-[#f59e0b]" : "text-[#ef4444]";

  const statusConfig = (status: string) => {
    if (status === "Strong")      return "bg-emerald-500";
    if (status === "Good")        return "bg-blue-500";
    return "bg-[#ef4444]";
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#1e3a8a]" />
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
          {id ? "Loading Branch Details..." : "Aggregating Branch Data..."}
        </p>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DETAIL VIEW  /branches/:id
  // ══════════════════════════════════════════════════════════════════════════
  if (id) {
    if (!detailData) {
      return (
        <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
          <p className="text-sm font-bold text-slate-400">Branch not found.</p>
          <Button variant="outline" onClick={() => navigate("/branches")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
        </div>
      );
    }

    const { summary, historicalTrend, benchmarkComparison, strengths, improvements, actionPlan } = detailData;
    const hasTrendData    = historicalTrend.some(t => t.score > 0);
    const benchmarkFiltered = benchmarkComparison.filter(row => row.branch > 0);
    const kpiCards = [
      (summary.attendance > 0 || summary.passRate > 0)
        ? { label: "Academic Health Index", value: `${summary.ahi}%`, note: summary.ahi >= 85 ? "Above target" : "Below target", color: summary.color }
        : null,
      summary.attendance > 0
        ? { label: "Attendance", value: `${summary.attendance}%`, note: summary.attendance >= 85 ? "On track" : "Below target", color: summary.color }
        : null,
      summary.passRate > 0
        ? { label: "Pass Rate", value: `${summary.passRate}%`, note: summary.passRate >= 75 ? "Performing well" : "Needs attention", color: summary.color }
        : null,
      summary.feeCollection > 0
        ? { label: "Fee Collection", value: `${summary.feeCollection}%`, note: summary.feeCollection >= 85 ? "On target" : "Below target", color: summary.color }
        : null,
      { label: "Active Alerts", value: summary.activeAlerts.toString(), note: summary.activeAlerts === 0 ? "No active risks" : "Students at risk", color: summary.activeAlerts > 0 ? "#ef4444" : "#22c55e" },
    ].filter(Boolean) as { label: string; value: string; note: string; color: string }[];

    return (
      <div className="space-y-8 max-w-[1400px] mx-auto animate-in fade-in duration-500 pb-16">

        {/* ── Profile Card ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm">
          <div className="p-8 lg:p-12">

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-10">
              <div className="flex items-center gap-6">
                <button
                  onClick={() => navigate("/branches")}
                  className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors shrink-0"
                >
                  <ArrowLeft className="w-5 h-5 text-slate-500" />
                </button>
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0"
                  style={{ backgroundColor: summary.color }}
                >
                  <Building2 className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="text-2xl lg:text-3xl font-bold text-[#111827] tracking-tight">{summary.name}</h2>
                  <p className="text-slate-400 font-medium text-sm mt-1">
                    {summary.studentCount.toLocaleString()} students
                    {summary.teacherCount > 0 && ` • ${summary.teacherCount} teachers`}
                    {summary.established !== "N/A" && ` • Established ${summary.established}`}
                    {summary.location !== "—" && ` • ${summary.location}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`px-5 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest text-white ${statusConfig(summary.status)}`}>
                  {summary.status}
                </span>
                <Button className="h-10 px-5 rounded-lg bg-[#1e294b] text-white text-[11px] font-bold hover:bg-[#1e3a8a] shadow-lg">
                  Generate Report
                </Button>
              </div>
            </div>

            {/* KPI Cards — only those with real data */}
            <div className={`grid grid-cols-2 ${kpiCards.length <= 2 ? "md:grid-cols-2" : kpiCards.length === 3 ? "md:grid-cols-3" : "md:grid-cols-4"} gap-5 mb-12`}>
              {kpiCards.map((kpi, i) => (
                <div key={i} className="p-6 rounded-[1.2rem] border border-slate-100 bg-[#f8fafc]/50 transition-all hover:bg-white hover:shadow-lg">
                  <p className="text-slate-400 text-[11px] font-bold uppercase tracking-tight mb-3">{kpi.label}</p>
                  <h3 className="text-3xl font-black tracking-tighter mb-1.5" style={{ color: kpi.color }}>
                    {kpi.value}
                  </h3>
                  <p className="text-[11px] font-bold" style={{ color: kpi.color }}>{kpi.note}</p>
                </div>
              ))}
            </div>

            {/* Charts — only render if at least one has data */}
            {(hasTrendData || benchmarkFiltered.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12">

              {/* Attendance Trend */}
              <div>
                <h3 className="text-base font-bold text-[#111827] mb-8">Attendance Trend (Last 6 Months)</h3>
                {!hasTrendData ? (
                  <div className="h-[260px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
                    <p className="text-sm text-slate-400 font-semibold">No attendance data yet</p>
                    <p className="text-xs text-slate-300">Appears once daily attendance is recorded</p>
                  </div>
                ) : (
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={historicalTrend} margin={{ left: -20, right: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="period" axisLine={false} tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} dy={10} />
                        <YAxis axisLine={false} tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} domain={[0, 100]} />
                        <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                        <Line type="monotone" dataKey="schoolAvg" name="School Avg"
                          stroke="#22c55e" strokeWidth={2} strokeDasharray="6 6" dot={false} />
                        <Line type="monotone" dataKey="score" name={summary.name}
                          stroke={summary.color} strokeWidth={3}
                          dot={{ r: 5, fill: "#fff", strokeWidth: 2.5, stroke: summary.color }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Benchmark Comparison */}
              <div>
                <h3 className="text-base font-bold text-[#111827] mb-8">Benchmark Comparison</h3>
                {benchmarkFiltered.length === 0 ? (
                  <div className="h-[260px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
                    <p className="text-sm text-slate-400 font-semibold">No benchmark data yet</p>
                    <p className="text-xs text-slate-300">Appears once results or attendance are recorded</p>
                  </div>
                ) : (
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={benchmarkFiltered} barGap={6} margin={{ bottom: 20 }}>
                        <XAxis dataKey="metric" axisLine={false} tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                        <YAxis axisLine={false} tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }}
                          domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} />
                        <Tooltip cursor={{ fill: "#f8fafc" }} contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                        <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: "10px" }}
                          content={({ payload }) => (
                            <div className="flex justify-center gap-6 mt-4">
                              {payload?.map((e: any, i: number) => (
                                <div key={i} className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: e.color }}></div>
                                  <span className="text-[10px] font-bold text-slate-500">{e.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        />
                        <Bar dataKey="branch" name={summary.name.split(" ")[0]} fill={summary.color}
                          radius={[3, 3, 0, 0]} barSize={18} />
                        <Bar dataKey="avg" name="School Avg" fill="#d1d5db"
                          radius={[3, 3, 0, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Strengths & Improvements */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-8 rounded-[1.5rem] border border-emerald-100 bg-[#f0fdf4]/50">
                <h4 className="text-base font-bold text-[#22c55e] mb-6 flex items-center gap-2.5">
                  <CheckCircle className="w-5 h-5" /> Strengths
                </h4>
                <ul className="space-y-3">
                  {strengths.map((s, i) => (
                    <li key={i} className="text-slate-700 font-medium text-sm leading-relaxed">• {s}</li>
                  ))}
                </ul>
              </div>
              <div className="p-8 rounded-[1.5rem] border border-rose-100 bg-[#fef2f2]/50">
                <h4 className="text-base font-bold text-[#ef4444] mb-6 flex items-center gap-2.5">
                  <AlertTriangle className="w-5 h-5" /> Areas for Improvement
                </h4>
                <ul className="space-y-3">
                  {improvements.map((s, i) => (
                    <li key={i} className="text-slate-700 font-medium text-sm leading-relaxed">• {s}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* ── Recommended Action Plan ──────────────────────────────────────── */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-10">
          <h3 className="text-xl font-bold text-[#111827] mb-10">Recommended Action Plan</h3>
          <div className="space-y-0 divide-y divide-slate-50">
            {actionPlan.map((plan, idx) => (
              <div key={idx} className="flex items-center justify-between py-7 gap-8 group">
                <div className="flex items-center gap-6">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm shrink-0"
                    style={{ backgroundColor: summary.color }}
                  >
                    {idx + 1}
                  </div>
                  <div>
                    <h4 className="text-[15px] font-bold text-[#111827] mb-1 group-hover:text-blue-600 transition-colors">
                      {plan.task}
                    </h4>
                    <p className="text-slate-400 text-xs font-medium">{plan.sub}</p>
                  </div>
                </div>
                <span className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-white whitespace-nowrap ${plan.prColor}`}>
                  {plan.priority}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LIST VIEW  /branches
  // ══════════════════════════════════════════════════════════════════════════
  if (!listData) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <p className="text-sm font-bold text-slate-400">No branch data available.</p>
      </div>
    );
  }

  const { branches, performanceRanking, comparativeTrends, efficiencyMetrics } = listData;

  // Only show ranking rows where at least one branch has real data
  const rankingWithData = performanceRanking.filter(row =>
    branches.some((_, i) => (row[`b${i}`] as number) > 0)
  );
  // Only show trends chart if any month has real attendance data
  const hasTrendsData = comparativeTrends.some(row =>
    branches.some((_, i) => (row[`b${i}`] as number) > 0)
  );

  return (
    <div className="space-y-10 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">

      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold text-[#111827] tracking-tight">Branches Comparison</h1>
        <p className="text-slate-400 font-medium text-sm">Side-by-side performance analysis</p>
      </div>

      {/* Branch Cards */}
      {branches.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center bg-white rounded-[2rem] border border-slate-100">
          <Building2 className="w-16 h-16 text-slate-200 mb-4" />
          <p className="text-sm font-bold text-slate-400">No branches found</p>
          <p className="text-xs text-slate-300 mt-1">Add branches to your school to see comparisons</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {branches.map(b => (
            <div
              key={b.id}
              className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-lg transition-all cursor-pointer group"
              onClick={() => navigate(`/branches/${b.id}`)}
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0"
                    style={{ backgroundColor: b.color }}
                  >
                    <Building2 className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[#111827] group-hover:text-blue-600 transition-colors">{b.name}</h3>
                    <p className="text-xs font-bold text-slate-400">{b.studentCount.toLocaleString()} students</p>
                  </div>
                </div>
                {/* Only show status badge if we have actual computed data */}
                {b.ahi > 0 && (
                  <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest text-white ${statusConfig(b.status)}`}>
                    {b.status}
                  </span>
                )}
              </div>

              {/* Only render rows that have real data */}
              {(() => {
                const available = [
                  { label: "AHI",            value: b.ahi,           show: b.attendance > 0 || b.passRate > 0 },
                  { label: "Attendance",     value: b.attendance,    show: b.attendance > 0 },
                  { label: "Pass Rate",      value: b.passRate,      show: b.passRate > 0 },
                  { label: "Fee Collection", value: b.feeCollection, show: b.feeCollection > 0 },
                ].filter(m => m.show);
                return available.length > 0 ? (
                  <div className="space-y-0 divide-y divide-slate-50">
                    {available.map(m => (
                      <div key={m.label} className="flex justify-between items-center py-4">
                        <span className="text-sm font-medium text-slate-500">{m.label}</span>
                        <span className={`text-sm font-black ${metricColor(m.value)}`}>{m.value}%</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-300 font-medium py-4 text-center">No performance data yet</p>
                );
              })()}

              {b.activeAlerts > 0 && (
                <div className="mt-4 px-4 py-2.5 rounded-xl bg-[#fef2f2] border border-rose-100 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="text-xs font-bold text-rose-500">{b.activeAlerts} student{b.activeAlerts > 1 ? "s" : ""} at risk</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Charts — only render if at least one has data */}
      {branches.length > 0 && (rankingWithData.length > 0 || hasTrendsData) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Performance Ranking */}
          <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
            <h3 className="text-lg font-bold text-[#111827] mb-12">Performance Ranking</h3>
            {rankingWithData.length === 0 ? (
              <div className="h-[300px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
                <p className="text-sm text-slate-400 font-semibold">No performance data yet</p>
                <p className="text-xs text-slate-300">Appears once attendance or results are recorded</p>
              </div>
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rankingWithData} layout="vertical" barGap={4} margin={{ left: 0, right: 20 }}>
                    <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} ticks={[0, 20, 40, 60, 80, 100]} />
                    <YAxis dataKey="metric" type="category" axisLine={false} tickLine={false}
                      tick={{ fill: "#64748b", fontSize: 11, fontWeight: "bold" }} width={80} />
                    <Tooltip cursor={{ fill: "#f8fafc" }} contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: "20px" }}
                      content={({ payload }) => (
                        <div className="flex justify-center gap-6 mt-6">
                          {payload?.map((e: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: e.color }}></div>
                              <span className="text-[11px] font-bold text-slate-500">{e.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    />
                    {branches.map((b, i) => (
                      <Bar key={b.id} dataKey={`b${i}`} name={b.name.split(" ")[0]}
                        fill={b.color} radius={[0, 2, 2, 0]} barSize={10} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Comparative Trends */}
          <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
            <h3 className="text-lg font-bold text-[#111827] mb-12">Comparative Trends (Attendance %)</h3>
            {!hasTrendsData ? (
              <div className="h-[300px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
                <p className="text-sm text-slate-400 font-semibold">No attendance trend data yet</p>
                <p className="text-xs text-slate-300">Appears once daily attendance is recorded</p>
              </div>
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={comparativeTrends} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} dy={10} />
                    <YAxis axisLine={false} tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }}
                      domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} />
                    <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: "20px" }}
                      content={({ payload }) => (
                        <div className="flex justify-center gap-6 mt-6">
                          {payload?.map((e: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-full border-[2.5px] bg-white" style={{ borderColor: e.color }}></div>
                              <span className="text-[11px] font-bold text-slate-500">{e.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    />
                    {branches.map((b, i) => (
                      <Line key={b.id} type="monotone" dataKey={`b${i}`} name={b.name.split(" ")[0]}
                        stroke={b.color} strokeWidth={3}
                        dot={{ r: 5, fill: "#fff", strokeWidth: 2.5, stroke: b.color }}
                        activeDot={{ r: 7 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Efficiency Metrics */}
      {branches.length > 0 && (
        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-10">
          <h3 className="text-xl font-bold text-[#111827] mb-10">Efficiency Metrics</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {efficiencyMetrics.map((m, i) => (
              <div key={i} className="bg-[#f8fafc]/50 border border-slate-100 p-8 rounded-[1.5rem] text-center transition-all hover:bg-white hover:shadow-lg">
                <p className="text-slate-400 text-[11px] font-bold uppercase tracking-tight mb-4">{m.label}</p>
                <h3 className={`text-3xl font-black tracking-tighter mb-2 ${m.col}`}>{m.value}</h3>
                <p className={`text-[11px] font-bold ${m.col}`}>{m.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
