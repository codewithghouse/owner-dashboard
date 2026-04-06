import { useState, useEffect, useCallback } from "react";
import {
  FileText, Download, Star, Plus, Printer, Mail, FileSpreadsheet,
  ChevronRight, GraduationCap, Presentation, DollarSign, Loader2,
  Users, TrendingUp, TrendingDown, AlertTriangle, BookOpen,
  ArrowLeft, CheckCircle, Clock, BarChart3,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  fetchReportsDashboard, ReportsDashboardData,
  REPORT_CATEGORIES, REPORT_REGISTRY, getReportSlug,
  AnyReportData, logReportDownload,
} from "@/lib/reportsService";
import { exportPDF, exportExcel, exportCSV, exportEmail, printReport } from "@/lib/exportUtils";

// ── Helper: build export payload from any report ──────────────────────────────
function buildExportPayload(report: AnyReportData, title: string) {
  const base = { title, reportId: (report as any).id, generatedOn: (report as any).generatedOn, summary: (report as any).summary || "" };
  const stats: { label: string; value: string }[] = [];
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];

  if (report._type === "enrollment") {
    stats.push(
      { label: "Total Enrollment", value: report.totalEnrollment.toLocaleString() },
      { label: "New Admissions", value: `+${report.newAdmissions}` },
      { label: "Withdrawals", value: `-${report.withdrawals}` },
      { label: "Net Growth", value: `+${report.netGrowth}` },
    );
    tableHeaders = ["Grade", "Enrollment"];
    tableRows = report.enrollmentByGrade.map(g => [g.grade, g.enrollment.toString()]);
  } else if (report._type === "attendance") {
    stats.push(
      { label: "Overall Rate", value: `${report.overallRate}%` },
      { label: "Present Today", value: report.presentToday.toLocaleString() },
      { label: "Absent Today", value: report.absentToday.toLocaleString() },
      { label: "Chronic Absentees", value: report.chronicAbsent.toString() },
    );
    tableHeaders = ["Branch", "Attendance Rate"];
    tableRows = report.branchWise.map(b => [b.branch, `${b.rate}%`]);
  } else if (report._type === "performance") {
    stats.push(
      { label: "Avg Score", value: `${report.avgScore}%` },
      { label: "Pass Rate", value: `${report.passRate}%` },
      { label: "Distinction Rate", value: `${report.distinctionRate}%` },
      { label: "Fail Rate", value: `${report.failRate}%` },
    );
    tableHeaders = ["Subject", "Average Score"];
    tableRows = report.subjectScores.map(s => [s.subject, `${s.score}%`]);
  } else if (report._type === "at-risk") {
    stats.push(
      { label: "Total At-Risk", value: report.totalAtRisk.toString() },
      { label: "Critical", value: report.critical.toString() },
      { label: "Warning", value: report.warning.toString() },
      { label: "Improving", value: report.improving.toString() },
    );
    tableHeaders = ["Branch", "At-Risk Count"];
    tableRows = report.riskByBranch.map(b => [b.branch, b.count.toString()]);
  } else if (report._type === "teacher-perf") {
    stats.push(
      { label: "Total Teachers", value: report.totalTeachers.toString() },
      { label: "Avg Effectiveness", value: `${report.avgEffectiveness}%` },
      { label: "Top Performers", value: report.topPerformers.toString() },
      { label: "Needs Improvement", value: report.needsImprovement.toString() },
    );
    tableHeaders = ["Branch", "Teachers", "Avg Score"];
    tableRows = report.byBranch.map(b => [b.branch, b.count.toString(), `${b.avgScore}%`]);
  } else if (report._type === "revenue") {
    stats.push(
      { label: "Total Revenue", value: `$${report.totalRevenue.toLocaleString()}` },
      { label: "Collected", value: `$${report.totalCollected.toLocaleString()}` },
      { label: "Outstanding", value: `$${report.outstanding.toLocaleString()}` },
      { label: "Collection Rate", value: `${report.collectionRate}%` },
    );
    tableHeaders = ["Branch", "Collected", "Total"];
    tableRows = report.byBranch.map(b => [b.branch, `$${b.collected.toLocaleString()}`, `$${b.total.toLocaleString()}`]);
  } else if (report._type === "fee-collection") {
    stats.push(
      { label: "Total Billed", value: `$${report.totalBilled.toLocaleString()}` },
      { label: "Total Paid", value: `$${report.totalPaid.toLocaleString()}` },
      { label: "Pending", value: `$${report.pendingAmount.toLocaleString()}` },
      { label: "Collection %", value: `${report.collectionPct}%` },
    );
    tableHeaders = ["Branch", "Collection %"];
    tableRows = report.byBranch.map(b => [b.branch, `${b.pct}%`]);
  }

  return { ...base, stats, tableHeaders, tableRows };
}

// ── Report stat card colors ───────────────────────────────────────────────────
function getStatColor(type: string, idx: number): string {
  if (type === "enrollment") return ["text-[#111827]", "text-[#22c55e]", "text-[#ef4444]", "text-[#22c55e]"][idx] || "text-[#111827]";
  if (type === "attendance") return ["text-[#1e3a8a]", "text-[#22c55e]", "text-[#ef4444]", "text-[#f59e0b]"][idx] || "text-[#111827]";
  if (type === "performance") return ["text-[#1e3a8a]", "text-[#22c55e]", "text-[#3b82f6]", "text-[#ef4444]"][idx] || "text-[#111827]";
  if (type === "at-risk") return ["text-[#f59e0b]", "text-[#ef4444]", "text-[#f59e0b]", "text-[#22c55e]"][idx] || "text-[#111827]";
  if (type === "teacher-perf") return ["text-[#1e3a8a]", "text-[#3b82f6]", "text-[#22c55e]", "text-[#ef4444]"][idx] || "text-[#111827]";
  return ["text-[#1e3a8a]", "text-[#22c55e]", "text-[#ef4444]", "text-[#3b82f6]"][idx] || "text-[#111827]";
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export default function ReportsCenter() {
  const [dashboard, setDashboard] = useState<ReportsDashboardData | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [reportData, setReportData] = useState<AnyReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"Preview" | "Schedule" | "Share" | "Settings">("Preview");

  // Load dashboard
  useEffect(() => {
    setLoading(true);
    fetchReportsDashboard()
      .then(setDashboard)
      .catch(err => { console.error(err); toast.error("Failed to load reports data."); })
      .finally(() => setLoading(false));
  }, []);

  // Load individual report
  const openReport = useCallback((label: string) => {
    const slug = getReportSlug(label);
    const reg = REPORT_REGISTRY[slug];
    if (!reg) { toast.error("Report type not available yet."); return; }
    setSelectedSlug(slug);
    setReportLoading(true);
    setReportData(null);
    setActiveTab("Preview");
    reg.fetcher()
      .then(setReportData)
      .catch(err => { console.error(err); toast.error("Failed to generate report."); })
      .finally(() => setReportLoading(false));
  }, []);

  // Export handlers
  const handleExport = useCallback((format: "pdf" | "excel" | "csv" | "email") => {
    if (!reportData || !selectedSlug) return;
    const reg = REPORT_REGISTRY[selectedSlug];
    const payload = buildExportPayload(reportData, reg?.label || "Report");
    if (format === "pdf") { exportPDF(payload); toast.success("PDF downloaded"); }
    else if (format === "excel") { exportExcel(payload); toast.success("Excel downloaded"); }
    else if (format === "csv") { exportCSV(payload); toast.success("CSV downloaded"); }
    else if (format === "email") {
      exportEmail(payload).then(r => toast[r.success ? "success" : "error"](r.message));
    }
  }, [reportData, selectedSlug]);

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#1e3a8a]" />
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Loading Reports Center...</p>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // REPORT DETAIL VIEW
  // ══════════════════════════════════════════════════════════════════════════════
  if (selectedSlug) {
    const reg = REPORT_REGISTRY[selectedSlug];
    const reportTitle = `${reg?.label || "Report"} Report`;

    if (reportLoading || !reportData) {
      return (
        <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-[#1e3a8a]" />
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Generating {reg?.label}...</p>
        </div>
      );
    }

    const payload = buildExportPayload(reportData, reg?.label || "Report");

    return (
      <div className="space-y-8 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm font-bold">
          <button onClick={() => { setSelectedSlug(null); setReportData(null); }} className="text-slate-400 hover:text-blue-600 transition-colors">Reports Center</button>
          <span className="text-slate-300">/</span>
          <span className="text-[#1e3a8a] font-bold">{reportTitle}</span>
        </div>

        {/* Main Report Card */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-8 lg:p-10">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
              <div>
                <h2 className="text-2xl font-bold text-[#111827] tracking-tight mb-2">{reportTitle}</h2>
                <p className="text-slate-400 text-sm font-medium">Generated on {(reportData as any).generatedOn} • Report ID: {(reportData as any).id}</p>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={printReport} className="h-10 px-5 rounded-xl border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                  <Printer className="w-4 h-4" /> Print
                </Button>
                <Button onClick={() => handleExport("pdf")} className="h-10 px-5 rounded-xl bg-[#1e294b] text-white text-xs font-bold hover:bg-[#1e3a8a] shadow-lg flex items-center gap-2">
                  <Download className="w-4 h-4" /> Export
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-3 mb-10">
              {(["Preview", "Schedule", "Share", "Settings"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    activeTab === tab ? "bg-[#1e3a8a] text-white shadow-sm" : "bg-white text-slate-500 hover:bg-slate-50 border border-slate-100"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            {activeTab === "Preview" && (
              <div className="animate-in fade-in duration-500">
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-12">
                  {payload.stats.map((stat, i) => (
                    <div key={i} className="bg-[#f8fafc] border border-slate-100 p-6 rounded-[1.2rem] text-center transition-all hover:bg-white hover:shadow-lg">
                      <p className="text-slate-400 text-[11px] font-bold uppercase tracking-tight mb-3">{stat.label}</p>
                      <h3 className={`text-3xl font-black tracking-tighter ${getStatColor(reportData._type, i)}`}>{stat.value}</h3>
                    </div>
                  ))}
                </div>

                {/* Charts */}
                {renderCharts(reportData)}

                {/* Summary */}
                <div className="bg-[#f8fafc] border border-slate-100 p-8 rounded-[1.5rem] mb-6">
                  <h4 className="text-base font-bold text-[#111827] mb-4">Report Summary</h4>
                  <p className="text-slate-600 text-sm leading-relaxed">{(reportData as any).summary}</p>
                </div>
              </div>
            )}

            {activeTab === "Schedule" && (
              <div className="animate-in fade-in duration-500">
                <div className="bg-[#f8fafc] border border-slate-100 p-8 rounded-[1.5rem]">
                  <h4 className="text-base font-bold text-[#111827] mb-6">Schedule This Report</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {["Weekly", "Monthly", "Quarterly"].map(freq => (
                      <button key={freq} className="p-6 rounded-[1.2rem] border border-slate-200 bg-white hover:border-[#1e3a8a] hover:shadow-lg transition-all text-left group">
                        <div className="flex items-center gap-3 mb-3">
                          <Clock className="w-5 h-5 text-slate-400 group-hover:text-[#1e3a8a]" />
                          <span className="font-bold text-[#111827]">{freq}</span>
                        </div>
                        <p className="text-xs text-slate-400">{freq === "Weekly" ? "Every Monday at 8:00 AM" : freq === "Monthly" ? "1st of each month" : "End of each quarter"}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Share" && (
              <div className="animate-in fade-in duration-500">
                <div className="bg-[#f8fafc] border border-slate-100 p-8 rounded-[1.5rem]">
                  <h4 className="text-base font-bold text-[#111827] mb-6">Share Report</h4>
                  <div className="flex flex-col gap-4">
                    <button onClick={() => handleExport("email")} className="p-5 rounded-xl border border-slate-200 bg-white hover:border-[#1e3a8a] hover:shadow-lg transition-all flex items-center gap-4">
                      <Mail className="w-5 h-5 text-[#1e3a8a]" />
                      <div className="text-left"><p className="font-bold text-[#111827] text-sm">Send via Email</p><p className="text-xs text-slate-400">Share report link or PDF attachment</p></div>
                    </button>
                    <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/reports?view=${selectedSlug}`); toast.success("Link copied!"); }} className="p-5 rounded-xl border border-slate-200 bg-white hover:border-[#1e3a8a] hover:shadow-lg transition-all flex items-center gap-4">
                      <FileText className="w-5 h-5 text-[#22c55e]" />
                      <div className="text-left"><p className="font-bold text-[#111827] text-sm">Copy Report Link</p><p className="text-xs text-slate-400">Shareable URL for this report</p></div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Settings" && (
              <div className="animate-in fade-in duration-500">
                <div className="bg-[#f8fafc] border border-slate-100 p-8 rounded-[1.5rem]">
                  <h4 className="text-base font-bold text-[#111827] mb-6">Report Settings</h4>
                  <div className="space-y-4">
                    {[
                      { label: "Include branch breakdown", desc: "Show data separated by branch" },
                      { label: "Include historical comparison", desc: "Compare with previous period" },
                      { label: "Auto-refresh data", desc: "Refresh data every 60 seconds" },
                    ].map((setting, i) => (
                      <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white">
                        <div><p className="font-bold text-sm text-[#111827]">{setting.label}</p><p className="text-xs text-slate-400">{setting.desc}</p></div>
                        <div className="w-10 h-6 rounded-full bg-[#1e3a8a] relative cursor-pointer">
                          <div className="absolute right-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Export Options */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-10">
          <h3 className="text-xl font-bold text-[#111827] mb-10">Export Options</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { label: "PDF", icon: <FileText className="w-8 h-8" />, col: "text-[#ef4444]", format: "pdf" as const },
              { label: "Excel", icon: <FileSpreadsheet className="w-8 h-8" />, col: "text-[#22c55e]", format: "excel" as const },
              { label: "CSV", icon: <FileText className="w-8 h-8" />, col: "text-[#3b82f6]", format: "csv" as const },
              { label: "Email", icon: <Mail className="w-8 h-8" />, col: "text-[#1e3a8a]", format: "email" as const },
            ].map((opt, i) => (
              <button key={i} onClick={() => handleExport(opt.format)} className="bg-[#f8fafc] border border-slate-100 p-8 rounded-[1.5rem] flex flex-col items-center gap-4 transition-all hover:bg-white hover:shadow-lg hover:border-slate-200 cursor-pointer group">
                <div className={`${opt.col} group-hover:scale-110 transition-transform`}>{opt.icon}</div>
                <span className="text-sm font-bold text-slate-600">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DASHBOARD LIST VIEW
  // ══════════════════════════════════════════════════════════════════════════════
  const stats = dashboard?.stats;
  const scheduled = dashboard?.scheduledReports || [];

  return (
    <div className="space-y-10 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-[#111827] tracking-tight">Reports Center</h1>
          <p className="text-slate-400 font-medium text-sm">Generate, schedule & download reports</p>
        </div>
        <Button className="bg-[#1e294b] hover:bg-[#1e3a8a] text-white font-bold h-12 rounded-xl px-8 shadow-lg shadow-blue-900/10 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Create Custom Report
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: "Total Reports", value: stats?.totalReports?.toString() || "12", note: `${stats?.totalCategories || 3} categories` },
          { label: "Scheduled", value: stats?.scheduled?.toString() || "0", note: "Auto-generated", noteCol: "text-emerald-500" },
          { label: "Recent Downloads", value: stats?.recentDownloads?.toString() || "0", note: "Last 7 days" },
          { label: "Favorites", value: stats?.favorites?.toString() || "0", note: "Quick access" },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm transition-all hover:shadow-md">
            <p className="text-slate-400 text-xs font-bold uppercase tracking-tight mb-4">{stat.label}</p>
            <h3 className="text-4xl font-extrabold text-[#111827] tracking-tighter mb-2">{stat.value}</h3>
            <p className={`text-[11px] font-bold ${stat.noteCol || "text-slate-400"}`}>{stat.note}</p>
          </div>
        ))}
      </div>

      {/* Report Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Student Reports */}
        <div className="bg-white rounded-[2rem] border border-slate-100 p-8 shadow-sm">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-[#1e3a8a] flex items-center justify-center text-white shadow-lg">
              <GraduationCap className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[#111827]">Student Reports</h3>
          </div>
          <div className="space-y-0 divide-y divide-slate-50">
            {REPORT_CATEGORIES.student.map(item => (
              <button
                key={item}
                onClick={() => openReport(item)}
                className="w-full flex items-center justify-between py-4 text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors group"
              >
                {item}
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors" />
              </button>
            ))}
          </div>
        </div>

        {/* Teacher Reports */}
        <div className="bg-white rounded-[2rem] border border-slate-100 p-8 shadow-sm">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-[#22c55e] flex items-center justify-center text-white shadow-lg">
              <Presentation className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[#111827]">Teacher Reports</h3>
          </div>
          <div className="space-y-0 divide-y divide-slate-50">
            {REPORT_CATEGORIES.teacher.map(item => (
              <button
                key={item}
                onClick={() => openReport(item)}
                className="w-full flex items-center justify-between py-4 text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors group"
              >
                {item}
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors" />
              </button>
            ))}
          </div>
        </div>

        {/* Financial Reports */}
        <div className="bg-white rounded-[2rem] border border-slate-100 p-8 shadow-sm">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-[#f59e0b] flex items-center justify-center text-white shadow-lg">
              <DollarSign className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[#111827]">Financial Reports</h3>
          </div>
          <div className="space-y-0 divide-y divide-slate-50">
            {REPORT_CATEGORIES.financial.map(item => (
              <button
                key={item}
                onClick={() => openReport(item)}
                className="w-full flex items-center justify-between py-4 text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors group"
              >
                {item}
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scheduled Reports Table */}
      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-10 border-b border-slate-50">
          <h3 className="text-xl font-bold text-[#111827]">Scheduled Reports</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[900px]">
            <thead>
              <tr className="bg-slate-50/50">
                {["Report Name", "Frequency", "Next Run", "Recipients", "Status"].map(h => (
                  <th key={h} className="py-6 px-10 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {scheduled.map((job, i) => (
                <tr key={i} className="hover:bg-slate-50/30 transition-colors group cursor-pointer">
                  <td className="py-7 px-10">
                    <p className="font-bold text-[#111827] text-[15px] tracking-tight group-hover:text-blue-600 transition-colors">{job.name}</p>
                  </td>
                  <td className="py-7 px-10 text-slate-500 font-medium text-sm">{job.frequency}</td>
                  <td className="py-7 px-10 text-slate-500 font-medium text-sm">{job.nextRun}</td>
                  <td className="py-7 px-10 text-slate-500 font-medium text-sm">{job.recipients} users</td>
                  <td className="py-7 px-10">
                    <span className={`text-[13px] font-black ${job.status === "Active" ? "text-[#111827]" : "text-slate-400"}`}>{job.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CHART RENDERER (per report type)
// ══════════════════════════════════════════════════════════════════════════════

function renderCharts(data: AnyReportData): JSX.Element {
  const COLORS = ["#1e3a8a", "#3b82f6", "#f59e0b", "#22c55e", "#ef4444", "#8b5cf6"];

  if (data._type === "enrollment") {
    const hasGradeData = data.enrollmentByGrade.some(g => g.enrollment > 0);
    const hasTrendData = data.enrollmentTrend.length > 0;

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12">
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Enrollment by Grade</h3>
          {!hasGradeData ? (
            <div className="h-[280px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
              <p className="text-sm text-slate-400 font-semibold">No grade-level data available</p>
              <p className="text-xs text-slate-300">Appears once students have grade assignments</p>
            </div>
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.enrollmentByGrade} margin={{ left: -10, right: 10 }}>
                  <XAxis dataKey="grade" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} />
                  <Tooltip cursor={{ fill: "#f8fafc" }} contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <Bar dataKey="enrollment" fill="#1e3a8a" radius={[4, 4, 0, 0]} barSize={32}
                    label={{ position: "top", fill: "#64748b", fontSize: 10, fontWeight: "bold" }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Enrollment Trend</h3>
          {!hasTrendData ? (
            <div className="h-[280px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
              <p className="text-sm text-slate-400 font-semibold">No trend data yet</p>
            </div>
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.enrollmentTrend} margin={{ left: -10, right: 10 }}>
                  <defs>
                    <linearGradient id="colorEnroll" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1e3a8a" stopOpacity={0.08} />
                      <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} tickFormatter={(val) => val.toLocaleString()} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <Area type="monotone" dataKey="enrollment" stroke="#1e3a8a" strokeWidth={3} fill="url(#colorEnroll)" dot={{ r: 5, fill: "#1e3a8a", strokeWidth: 2.5, stroke: "#fff" }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (data._type === "attendance") {
    const hasTrend = data.monthlyTrend.some(m => m.rate > 0);
    const hasBranch = data.branchWise.some(b => b.rate > 0);
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12">
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Monthly Attendance Trend</h3>
          {!hasTrend ? (
            <EmptyChart message="No monthly trend data yet" />
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.monthlyTrend} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} domain={[0, 100]} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <Line type="monotone" dataKey="rate" stroke="#1e3a8a" strokeWidth={3} dot={{ r: 5, fill: "#1e3a8a", strokeWidth: 2.5, stroke: "#fff" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Branch-wise Attendance</h3>
          {!hasBranch ? (
            <EmptyChart message="No branch data" />
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.branchWise} margin={{ left: -10, right: 10 }}>
                  <XAxis dataKey="branch" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} domain={[0, 100]} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <Bar dataKey="rate" radius={[4, 4, 0, 0]} barSize={32} label={{ position: "top", fill: "#64748b", fontSize: 10, fontWeight: "bold" }}>
                    {data.branchWise.map((b, i) => <Cell key={i} fill={b.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (data._type === "performance") {
    const hasSubjects = data.subjectScores.length > 0;
    const hasDist = data.gradeDistribution.some(g => g.count > 0);
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12">
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Subject Performance</h3>
          {!hasSubjects ? <EmptyChart message="No subject data" /> : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.subjectScores} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} />
                  <YAxis dataKey="subject" type="category" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 10, fontWeight: "bold" }} width={80} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={14}>
                    {data.subjectScores.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Score Distribution</h3>
          {!hasDist ? <EmptyChart message="No distribution data" /> : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.gradeDistribution} margin={{ left: -10, right: 10 }}>
                  <XAxis dataKey="range" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 9, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <Bar dataKey="count" fill="#1e3a8a" radius={[4, 4, 0, 0]} barSize={28} label={{ position: "top", fill: "#64748b", fontSize: 10, fontWeight: "bold" }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (data._type === "at-risk") {
    const hasBranch = data.riskByBranch.length > 0;
    const hasCat = data.riskCategories.length > 0;
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12">
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Risk by Branch</h3>
          {!hasBranch ? <EmptyChart message="No at-risk data" /> : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.riskByBranch} margin={{ left: -10, right: 10 }}>
                  <XAxis dataKey="branch" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={32} label={{ position: "top", fill: "#64748b", fontSize: 10, fontWeight: "bold" }}>
                    {data.riskByBranch.map((b, i) => <Cell key={i} fill={b.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Risk Categories</h3>
          {!hasCat ? <EmptyChart message="No category data" /> : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.riskCategories} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="count" nameKey="category" label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {data.riskCategories.map((_, i) => <Cell key={i} fill={["#ef4444", "#f59e0b", "#3b82f6"][i % 3]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (data._type === "teacher-perf") {
    const hasBranch = data.byBranch.some(b => b.count > 0);
    const hasDist = data.distribution.some(d => d.count > 0);
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12">
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Teachers by Branch</h3>
          {!hasBranch ? <EmptyChart message="No teacher data" /> : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byBranch} margin={{ left: -10, right: 10 }}>
                  <XAxis dataKey="branch" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <Bar dataKey="count" fill="#1e3a8a" radius={[4, 4, 0, 0]} barSize={32} label={{ position: "top", fill: "#64748b", fontSize: 10, fontWeight: "bold" }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Performance Distribution</h3>
          {!hasDist ? <EmptyChart message="No distribution data" /> : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.distribution} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="count" nameKey="range" label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {data.distribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Revenue & Fee Collection
  if (data._type === "revenue") {
    const hasBranch = data.byBranch.some(b => b.total > 0);
    const hasTrend = data.monthlyTrend.some(m => m.amount > 0);
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12">
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Revenue by Branch</h3>
          {!hasBranch ? <EmptyChart message="No revenue data" /> : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byBranch} margin={{ left: -10, right: 10 }}>
                  <XAxis dataKey="branch" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} formatter={(v: number) => [`$${v.toLocaleString()}`, "Collected"]} />
                  <Bar dataKey="collected" name="Collected" fill="#1e3a8a" radius={[4, 4, 0, 0]} barSize={24} />
                  <Bar dataKey="total" name="Total" fill="#e2e8f0" radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Monthly Collection Trend</h3>
          {!hasTrend ? <EmptyChart message="No monthly data" /> : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.monthlyTrend} margin={{ left: -10, right: 10 }}>
                  <defs>
                    <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.08} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <Area type="monotone" dataKey="amount" stroke="#22c55e" strokeWidth={3} fill="url(#colorRev)" dot={{ r: 5, fill: "#22c55e", strokeWidth: 2.5, stroke: "#fff" }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (data._type === "fee-collection") {
    const hasBranch = data.byBranch.some(b => b.pct > 0);
    const hasModes = data.paymentModes.length > 0;
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12">
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Collection Rate by Branch</h3>
          {!hasBranch ? <EmptyChart message="No fee data" /> : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byBranch} margin={{ left: -10, right: 10 }}>
                  <XAxis dataKey="branch" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} domain={[0, 100]} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <Bar dataKey="pct" radius={[4, 4, 0, 0]} barSize={32} label={{ position: "top", fill: "#64748b", fontSize: 10, fontWeight: "bold", formatter: (v: number) => `${v}%` }}>
                    {data.byBranch.map((b, i) => <Cell key={i} fill={b.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div>
          <h3 className="text-base font-bold text-[#111827] mb-8">Payment Modes</h3>
          {!hasModes ? <EmptyChart message="No payment data" /> : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.paymentModes} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="count" nameKey="mode" label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {data.paymentModes.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    );
  }

  return <></>;
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-[280px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
      <BarChart3 className="w-10 h-10 text-slate-200" />
      <p className="text-sm text-slate-400 font-semibold">{message}</p>
      <p className="text-xs text-slate-300">Data will populate once records are available</p>
    </div>
  );
}
