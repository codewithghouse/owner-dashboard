import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, Cell,
} from "recharts";
import { X, BookOpen, Loader2 } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAcademicsOverview, useSubjectDetail } from "@/hooks/useAcademics";

// ── skeleton ──────────────────────────────────────────────────────────────────
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-100 rounded-2xl ${className}`} />;
}

// ── grade cell colour ─────────────────────────────────────────────────────────
const getMatrixColor = (value: number) => {
  if (!value) return "#f1f5f9";
  if (value >= 90) return "#bef264";
  if (value >= 80) return "#d9f99d";
  if (value >= 70) return "#fef08a";
  if (value >= 60) return "#fed7aa";
  return "#fecaca";
};

// ── main component ────────────────────────────────────────────────────────────
export default function AcademicsOverview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("Performance");

  const { data: overview, loading: overviewLoading, error } = useAcademicsOverview();
  const { subject, loading: subjectLoading } = useSubjectDetail(id);

  // ══════════════════════════════════════════════════════════════════════
  //  SUBJECT DETAIL VIEW
  // ══════════════════════════════════════════════════════════════════════
  if (id) {
    if (subjectLoading) {
      return (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-[#1e3a8a]" />
        </div>
      );
    }
    if (!subject) return null;

    const statusColor =
      subject.status === "Strong" ? "bg-[#22c55e]" :
      subject.status === "Good"   ? "bg-[#3b82f6]" :
      subject.status === "No Data"? "bg-slate-400"  : "bg-[#f59e0b]";

    return (
      <div className="animate-in fade-in duration-700 space-y-8 pb-10">

        {/* Main Card */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl overflow-hidden">
          <div className="p-6 md:p-10 lg:p-12">

            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-10">
              <div className="flex items-center gap-4 md:gap-8">
                <div className="w-14 h-14 md:w-20 md:h-20 rounded-2xl bg-[#1e3a8a] flex items-center justify-center text-white shadow-lg border-2 md:border-4 border-white shrink-0">
                  <BookOpen className="w-7 h-7 md:w-10 md:h-10" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl md:text-3xl lg:text-4xl font-black text-[#1e294b] tracking-tight uppercase truncate">
                    {subject.name}
                  </h2>
                  <p className="text-slate-500 font-bold text-[10px] md:text-sm tracking-widest mt-1 uppercase opacity-70 truncate">
                    {subject.teachers} Teachers • {subject.students.toLocaleString()} Students
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between lg:justify-end gap-3 w-full lg:w-auto">
                <span className={`text-white text-[10px] font-black px-5 md:px-8 py-2 md:py-2.5 rounded-full shadow-lg h-9 md:h-10 flex items-center uppercase tracking-widest ${statusColor}`}>
                  {subject.status}
                </span>
                <button
                  onClick={() => navigate("/academics")}
                  className="p-2 md:p-2.5 rounded-xl bg-slate-50 text-slate-400 hover:bg-slate-100 transition-all border border-slate-100"
                >
                  <X className="w-5 h-5 md:w-6 md:h-6" />
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-2 md:gap-3 mb-10 overflow-x-auto pb-2 no-scrollbar">
              {["Performance", "Topics", "Resources"].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`whitespace-nowrap px-6 md:px-10 py-2.5 md:py-3 rounded-xl md:rounded-2xl text-[10px] md:text-[11px] font-black uppercase tracking-widest transition-all ${
                    activeTab === tab
                      ? "bg-[#1e3a8a] text-white shadow-xl"
                      : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-12">
              {[
                { label: "Average Score",       ...subject.metrics.avgScore,      type: "green",  route: "/academics" },
                { label: "Pass Rate",           ...subject.metrics.passRate,      type: "green",  route: "/academics" },
                { label: "Top Performers",      ...subject.metrics.topPerformers, type: "green",  route: "/students"  },
                { label: "Areas Needing Focus", ...subject.metrics.focusAreas,    type: "yellow", route: "/risks"     },
              ].map((stat, i) => (
                <div
                  key={i}
                  onClick={() => navigate(stat.route)}
                  role="button"
                  tabIndex={0}
                  className={`clickable-card p-5 md:p-8 rounded-2xl md:rounded-[1.5rem] border ${
                  stat.type === "green" ? "bg-[#f0fdf4] border-emerald-100/50" : "bg-[#fffbeb] border-amber-100/50"
                }`}>
                  <p className={`text-[9px] md:text-[11px] font-black uppercase tracking-tight mb-3 md:mb-4 ${
                    stat.type === "green" ? "text-[#059669]/60" : "text-[#d97706]/60"
                  }`}>{stat.label}</p>
                  <h3 className={`text-2xl md:text-4xl font-black tracking-tighter mb-1 md:mb-2 ${
                    stat.type === "green" ? "text-[#059669]" : "text-[#d97706]"
                  }`}>{stat.value}</h3>
                  <p className={`text-[9px] md:text-[11px] font-black uppercase tracking-tight ${
                    stat.type === "green" ? "text-[#059669]/80" : "text-[#d97706]/80"
                  }`}>{stat.note}</p>
                </div>
              ))}
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              {/* Topic-wise Performance */}
              <div>
                <h3 className="text-lg font-black text-[#1e294b] mb-10">Topic-wise Performance</h3>
                {subject.topics.length === 0 ? (
                  <div className="h-[280px] flex items-center justify-center border border-dashed border-slate-200 rounded-xl">
                    <p className="text-sm text-slate-300 font-semibold">No topic data available</p>
                  </div>
                ) : (
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={subject.topics} layout="vertical" margin={{ left: -10, right: 40 }}>
                        <XAxis type="number" domain={[0, 100]} hide />
                        <YAxis dataKey="name" type="category" axisLine={false} tickLine={false}
                          tick={{ fill: "#64748b", fontSize: 11, fontWeight: "bold" }} width={90} />
                        <Tooltip cursor={{ fill: "transparent" }} />
                        <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={16}>
                          {subject.topics.map((entry, index) => (
                            <Cell key={`cell-${index}`}
                              fill={entry.score >= 80 ? "#22c55e" : entry.score >= 65 ? "#f59e0b" : "#ef4444"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Branch Comparison */}
              <div>
                <h3 className="text-lg font-black text-[#1e294b] mb-10">Branch Comparison</h3>
                {subject.classComparison.length === 0 ? (
                  <div className="h-[280px] flex items-center justify-center border border-dashed border-slate-200 rounded-xl">
                    <p className="text-sm text-slate-300 font-semibold">No branch data available</p>
                  </div>
                ) : (
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={subject.classComparison} margin={{ bottom: 20 }}>
                        <XAxis dataKey="grade" axisLine={false} tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "800" }} dy={10} />
                        <YAxis hide domain={[0, 100]} />
                        <Tooltip cursor={{ fill: "transparent" }} />
                        {Object.keys(subject.classComparison[0] || {})
                          .filter(k => k !== "grade")
                          .map((key, i) => (
                            <Bar key={key} dataKey={key} name={key}
                              fill={["#1e3a8a","#3b82f6","#10b981","#f59e0b","#8b5cf6"][i % 5]}
                              radius={[2, 2, 0, 0]} barSize={20} />
                          ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Weak Areas */}
        {subject.weakAreas.length > 0 && (
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6 md:p-10 lg:p-14">
            <h3 className="text-lg md:text-xl font-extrabold text-[#111827] mb-8 md:mb-12 uppercase tracking-wide">
              Weak Areas & Recommendations
            </h3>
            <div className="space-y-6 md:space-y-8">
              {subject.weakAreas.map((area, idx) => (
                <div key={idx} className={`p-6 md:p-10 rounded-2xl md:rounded-[2.5rem] relative overflow-hidden transition-all hover:translate-y-[-5px] duration-500 shadow-sm ${
                  area.status === "Critical" ? "bg-[#fef2f2]" : "bg-[#fffbeb]"
                }`}>
                  <div className={`absolute top-0 left-0 w-1.5 md:w-2 h-full ${area.status === "Critical" ? "bg-red-500" : "bg-amber-400"}`} />
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 relative z-10">
                    <div>
                      <h4 className="text-xl md:text-2xl font-black text-[#1e294b] tracking-tight">{area.topic}</h4>
                      <p className="text-slate-400 font-bold text-[10px] md:text-sm mt-1 uppercase tracking-tight">
                         Avg: {area.avgScore} &bull; {area.affected}
                      </p>
                    </div>
                    <span className={`self-start sm:self-center px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                      area.status === "Critical"
                        ? "bg-[#ef4444] text-white border-red-200"
                        : "bg-[#eab308] text-white border-amber-200"
                    }`}>
                      {area.status}
                    </span>
                  </div>
                  <div className="relative z-10 flex flex-col md:flex-row md:items-start gap-2 md:gap-4">
                    <span className="text-[#1e294b] font-black text-[10px] md:text-sm whitespace-nowrap uppercase tracking-widest">Recommendation:</span>
                    <p className="text-slate-600 font-bold text-xs md:text-sm leading-relaxed">{area.recommendation}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  OVERVIEW PAGE
  // ══════════════════════════════════════════════════════════════════════
  const [selectedBranchId, setSelectedBranchId] = useState<string>("all");

  const branches     = overview?.branches ?? [];
  // activeData: "all" → top-level fields, branch → perBranch[id]
  const activeData   = selectedBranchId === "all"
    ? overview
    : overview?.perBranch[selectedBranchId] != null
      ? { ...overview, ...overview.perBranch[selectedBranchId] }
      : overview;
  const gradeColumns = activeData?.gradeColumns ?? ["G6","G7","G8","G9","G10","G11","G12"];
  const hasData      = (activeData?.gradeMatrix?.length ?? 0) > 0;

  return (
    <div className="space-y-10 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">

      {/* Header */}
      <div className="flex flex-col gap-1 px-1">
        <h1 className="text-2xl md:text-3xl font-extrabold text-[#111827] tracking-tight">Academics Overview</h1>
        <p className="text-slate-400 font-bold text-[10px] md:text-sm uppercase tracking-tight">
          {hasData ? "Branch-wise performance & learning outcomes" : "Grade-wise performance & learning outcomes"}
        </p>
      </div>

      {/* Branch Dropdown */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-1">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">
          Filter by Branch:
        </label>
        {overviewLoading ? (
          <div className="h-10 w-full sm:w-48 rounded-xl bg-slate-100 animate-pulse" />
        ) : (
          <div className="relative w-full sm:w-64">
            <span
              className="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full pointer-events-none"
              style={{
                backgroundColor:
                  selectedBranchId === "all"
                    ? "#1e3272"
                    : branches.find(b => b.id === selectedBranchId)?.color ?? "#1e3272",
              }}
            />
            <select
              value={selectedBranchId}
              onChange={e => setSelectedBranchId(e.target.value)}
              disabled={branches.length === 0}
              className="w-full pl-8 pr-10 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-black text-[#1e294b] shadow-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#1e3272]/20 focus:border-[#1e3272] transition-all disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-tight"
            >
              <option value="all">All Branches</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <svg
              className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        )}
        {selectedBranchId !== "all" && (
          <button
            onClick={() => setSelectedBranchId("all")}
            className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors underline underline-offset-2"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl px-6 py-4 text-rose-600 text-sm font-semibold">
          Error loading data: {error}
        </div>
      )}

      {/* ── Stats Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {overviewLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 md:h-40" />)
          : [
              { label: "Overall Pass Rate",   ...activeData!.stats.overallPassRate, green: true,  route: "/academics" },
              { label: "Average Score",       ...activeData!.stats.averageScore,    green: true,  route: "/academics" },
              { label: "Distinction Rate",    ...activeData!.stats.distinctionRate, green: true,  route: "/academics" },
              { label: "Total Students",      ...activeData!.stats.totalStudents,   green: false, route: "/students"  },
            ].map((stat, i) => (
              <div
                key={i}
                onClick={() => navigate(stat.route)}
                role="button"
                tabIndex={0}
                className="clickable-card bg-white p-6 md:p-8 rounded-2xl md:rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md transition-all"
              >
                <p className="text-slate-400 text-[10px] md:text-xs font-black uppercase tracking-widest mb-3 md:mb-4">{stat.label}</p>
                <h3 className="text-3xl md:text-4xl font-black text-[#111827] tracking-tighter mb-1 md:mb-2">{stat.value}</h3>
                <p className={`text-[10px] md:text-[11px] font-black uppercase ${stat.green ? "text-emerald-500" : "text-blue-500"}`}>
                  {stat.change}
                </p>
              </div>
            ))}
      </div>

      {/* ── Grade Matrix + Subject Comparison ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Grade-wise Performance Matrix */}
        <div className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 p-6 md:p-8 shadow-sm overflow-hidden">
          <h3 className="text-base md:text-lg font-black text-[#111827] mb-2 uppercase tracking-wide">Performance Matrix</h3>
          <p className="text-[10px] md:text-xs text-slate-400 font-bold mb-6 uppercase tracking-tight">Grade-wise subject performance</p>
          {overviewLoading ? (
            <Skeleton className="h-64" />
          ) : !hasData ? (
            <div className="h-64 flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
              <p className="text-sm text-slate-400 font-semibold">No results found yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto pb-4 no-scrollbar">
              <div className="min-w-[460px]">
                {/* Grade column headers */}
                <div className="flex gap-1 mb-1 ml-14">
                  {gradeColumns.map(g => (
                    <div key={g} className="flex-1 h-8 flex items-center justify-center text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      {g}
                    </div>
                  ))}
                </div>
                {/* Subject rows */}
                {activeData!.gradeMatrix.map(row => (
                  <div key={row.subject as string} className="flex gap-1 mb-1 items-center">
                    <div className="w-14 shrink-0 text-right pr-2 text-[10px] font-black text-slate-500 truncate uppercase tracking-tighter">
                      {(row.subject as string).slice(0, 7)}
                    </div>
                    {gradeColumns.map(g => {
                      const val = (row[g] as number) || 0;
                      return (
                        <div
                          key={g}
                          className="flex-1 h-10 md:h-12 flex items-center justify-center text-[10px] font-black cursor-pointer hover:scale-105 transition-all rounded-lg shadow-sm"
                          style={{ backgroundColor: getMatrixColor(val), color: "#1e293b" }}
                          onClick={() => navigate(`/academics/${(row.subject as string).toLowerCase()}`)}
                        >
                          {val > 0 ? val : "—"}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Subject Performance Comparison (by Branch) */}
        {(() => {
          const subjPerf = activeData?.subjectPerformance ?? [];
          // Check if any branch has real attribution data
          const hasBranchData = branches.length > 0 && subjPerf.some(row =>
            branches.some(b => (row[b.name] as number) > 0)
          );
          // Fall back to "Overall" aggregate bar when branch attribution is missing
          const chartBranches: { id: string; name: string; color: string }[] = hasBranchData
            ? branches
            : [{ id: "overall", name: "Overall", color: "#1e3a8a" }];
          const subLabel = hasBranchData ? "Average score per subject by branch" : "Average score per subject (all branches combined)";

          return (
            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
              <h3 className="text-lg font-bold text-[#111827] mb-2">Subject Performance Comparison</h3>
              <p className="text-xs text-slate-400 font-medium mb-8">{subLabel}</p>
              {overviewLoading ? (
                <Skeleton className="h-[320px]" />
              ) : subjPerf.length === 0 ? (
                <div className="h-[320px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
                  <p className="text-sm text-slate-400 font-semibold">No subject data yet</p>
                  <p className="text-xs text-slate-300">Data appears once teachers record results</p>
                </div>
              ) : (
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={subjPerf} margin={{ top: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="subject" axisLine={false} tickLine={false}
                        tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                      <YAxis axisLine={false} tickLine={false}
                        tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} domain={[0, 100]} />
                      <Tooltip cursor={{ fill: "transparent" }} />
                      <Legend verticalAlign="bottom" iconType="rect"
                        wrapperStyle={{ paddingTop: "20px", fontSize: "11px", fontWeight: "bold" }} />
                      {chartBranches.map(b => (
                        <Bar key={b.id} dataKey={b.name} name={b.name}
                          fill={b.color} radius={[2, 2, 0, 0]} barSize={18} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Exam Distribution + Learning Outcomes ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Exam Results Distribution */}
        <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
          <h3 className="text-lg font-bold text-[#111827] mb-12">Exam Results Distribution</h3>
          {overviewLoading ? (
            <Skeleton className="h-[300px]" />
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activeData!.examDistribution} margin={{ bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="range" axisLine={false} tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} />
                  <Tooltip cursor={{ fill: "transparent" }} />
                  <Bar dataKey="count" name="Students" radius={[4, 4, 0, 0]} barSize={34}>
                    {activeData!.examDistribution.map((_, index) => (
                      <Cell key={`cell-${index}`}
                        fill={["#22c55e","#3b82f6","#1d4ed8","#f59e0b","#ef4444"][index % 5]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Learning Outcome Trends */}
        <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
          <h3 className="text-lg font-bold text-[#111827] mb-12">Learning Outcome Trends</h3>
          {overviewLoading ? (
            <Skeleton className="h-[300px]" />
          ) : !activeData!.learningOutcomes.some(o => o.knowledge > 0 || o.skills > 0 || o.application > 0) ? (
            <div className="h-[300px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
              <p className="text-sm text-slate-400 font-semibold">No quarterly trend data yet</p>
              <p className="text-xs text-slate-300">Trends appear as results are recorded over time</p>
            </div>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activeData!.learningOutcomes} margin={{ top: 5, right: 30, left: -10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="q" axisLine={{ stroke: "#94a3b8" }} tickLine={{ stroke: "#94a3b8" }}
                    tick={{ fill: "#94a3b8", fontSize: 13, fontWeight: "800" }} dy={15} />
                  <YAxis axisLine={false} tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 13, fontWeight: "800" }}
                    domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <Legend
                    verticalAlign="bottom" align="center"
                    wrapperStyle={{ paddingTop: "40px" }}
                    content={({ payload }) => (
                      <div className="flex justify-center gap-8 mt-10">
                        {payload?.map((entry: any, index: number) => (
                          <div key={index} className="flex items-center gap-3">
                            <div className="w-5 h-5 rounded-full border-[3px] bg-white" style={{ borderColor: entry.color }} />
                            <span className="text-[13px] font-black text-slate-500">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  />
                  <Line type="monotone" dataKey="knowledge"   name="Knowledge"   stroke="#1e3a8a" strokeWidth={4}
                    dot={{ r: 6, fill: "#fff", strokeWidth: 3, stroke: "#1e3a8a" }} />
                  <Line type="monotone" dataKey="skills"      name="Skills"      stroke="#10b981" strokeWidth={4}
                    dot={{ r: 6, fill: "#fff", strokeWidth: 3, stroke: "#10b981" }} />
                  <Line type="monotone" dataKey="application" name="Application" stroke="#f59e0b" strokeWidth={4}
                    dot={{ r: 6, fill: "#fff", strokeWidth: 3, stroke: "#f59e0b" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── Branch Performance Cards (bottom) ───────────────────────────────── */}
      {!overviewLoading && branches.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-[#111827] mb-5">Branch-wise Breakdown</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {branches.map(b => (
              <div
                key={b.id}
                onClick={() => navigate(`/branches/${b.id}`)}
                role="button"
                tabIndex={0}
                className="clickable-card bg-white border border-slate-100 rounded-[2rem] p-7 shadow-sm hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-sm font-black shadow-md shrink-0"
                    style={{ backgroundColor: b.color }}>
                    {b.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-[#111827] truncate">{b.name}</h3>
                    <p className="text-xs text-slate-400 font-medium">{b.students.toLocaleString()} students</p>
                  </div>
                  <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide text-white shrink-0 ${
                    b.passRate >= 80 ? "bg-emerald-500" : b.passRate >= 60 ? "bg-amber-500" : "bg-red-500"
                  }`}>
                    {b.passRate >= 80 ? "Strong" : b.passRate >= 60 ? "Average" : b.passRate > 0 ? "Weak" : "No Data"}
                  </span>
                </div>
                <div className="space-y-0 divide-y divide-slate-50">
                  {[
                    { label: "Avg Score",    value: b.avgScore > 0    ? `${b.avgScore}%`        : "—", color: b.avgScore >= 75    ? "text-emerald-500" : "text-amber-500" },
                    { label: "Pass Rate",    value: b.passRate > 0    ? `${b.passRate}%`        : "—", color: b.passRate >= 80    ? "text-emerald-500" : "text-amber-500" },
                    { label: "Distinction", value: b.distinctionRate > 0 ? `${b.distinctionRate}%` : "—", color: "text-blue-500"  },
                    { label: "Attendance",  value: b.avgAttendance > 0 ? `${b.avgAttendance}%`  : "—", color: b.avgAttendance >= 85 ? "text-emerald-500" : "text-rose-500" },
                  ].map(m => (
                    <div key={m.label} className="flex justify-between items-center py-3">
                      <span className="text-sm text-slate-500 font-medium">{m.label}</span>
                      <span className={`text-sm font-black ${m.color}`}>{m.value}</span>
                    </div>
                  ))}
                </div>
                {Object.keys(b.subjectScores).length > 0 && (
                  <div className="mt-5 pt-4 border-t border-slate-50">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-3">Top Subjects</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(b.subjectScores)
                        .sort(([, a], [, bv]) => bv - a)
                        .slice(0, 3)
                        .map(([subj, score]) => (
                          <span key={subj}
                            className="px-3 py-1 rounded-lg text-[10px] font-bold text-white cursor-pointer hover:opacity-80"
                            style={{ backgroundColor: b.color }}
                            onClick={(e) => { e.stopPropagation(); navigate(`/academics/${subj.toLowerCase()}`); }}
                          >
                            {subj.slice(0, 8)} {score}%
                          </span>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
