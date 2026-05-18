import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText, Download, Star, Plus, Printer, Mail, FileSpreadsheet,
  ChevronRight, GraduationCap, Presentation, DollarSign, Loader2,
  Users, TrendingUp, TrendingDown, AlertTriangle, BookOpen,
  ArrowLeft, CheckCircle, Clock, BarChart3, Bell, Calendar, RefreshCw,
  Building2, Sparkles,
} from "lucide-react";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD, VIOLET, ORANGE,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, GRAD_RED, GRAD_ORANGE,
  SHADOW_SM, SHADOW_LG, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";
import { generateBoardReportPDF } from "@/lib/boardReportService";
import { doc, getDoc } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
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
      { label: "Total Revenue", value: `₹${report.totalRevenue.toLocaleString("en-IN")}` },
      { label: "Collected", value: `₹${report.totalCollected.toLocaleString("en-IN")}` },
      { label: "Outstanding", value: `₹${report.outstanding.toLocaleString("en-IN")}` },
      { label: "Collection Rate", value: `${report.collectionRate}%` },
    );
    tableHeaders = ["Branch", "Collected", "Total"];
    tableRows = report.byBranch.map(b => [b.branch, `₹${b.collected.toLocaleString("en-IN")}`, `₹${b.total.toLocaleString("en-IN")}`]);
  } else if (report._type === "fee-collection") {
    stats.push(
      { label: "Total Billed", value: `₹${report.totalBilled.toLocaleString("en-IN")}` },
      { label: "Total Paid", value: `₹${report.totalPaid.toLocaleString("en-IN")}` },
      { label: "Pending", value: `₹${report.pendingAmount.toLocaleString("en-IN")}` },
      { label: "Collection %", value: `${report.collectionPct}%` },
    );
    tableHeaders = ["Branch", "Collection %"];
    tableRows = report.byBranch.map(b => [b.branch, `${b.pct}%`]);
  }

  if (report._type === "workload") {
    stats.push(
      { label: "Total Teachers",     value: report.totalTeachers.toString() },
      { label: "Avg Classes/Teacher", value: report.avgClassesPerTeacher.toString() },
      { label: "Avg Subjects",        value: report.avgSubjectsPerTeacher.toString() },
      { label: "Overloaded",          value: report.overloadedTeachers.toString() },
    );
    tableHeaders = ["Teacher", "Branch", "Classes", "Subjects"];
    tableRows = report.topByWorkload.map(t => [t.name, t.branch, t.classes.toString(), t.subjects.toString()]);
  } else if (report._type === "feedback") {
    stats.push(
      { label: "Total Feedback",  value: report.totalFeedback.toString() },
      { label: "Positive",        value: report.positiveCount.toString() },
      { label: "Neutral",         value: report.neutralCount.toString() },
      { label: "Negative",        value: report.negativeCount.toString() },
    );
    tableHeaders = ["Branch", "Count", "Avg Rating"];
    tableRows = report.byBranch.map(b => [b.branch, b.count.toString(), b.avgRating > 0 ? `${b.avgRating}/5` : "—"]);
  } else if (report._type === "training-needs") {
    stats.push(
      { label: "Need Training",   value: report.totalNeedingTraining.toString() },
      { label: "Critical (<50%)", value: report.criticalCount.toString() },
      { label: "Moderate (50–65%)", value: report.moderateCount.toString() },
      { label: "Subjects Affected", value: report.bySubject.length.toString() },
    );
    tableHeaders = ["Teacher", "Subject", "Score", "Branch"];
    tableRows = report.teachersAtRisk.map(t => [t.name, t.subject, `${t.score}%`, t.branch]);
  } else if (report._type === "outstanding") {
    stats.push(
      { label: "Total Defaulters",    value: report.totalDefaulters.toString() },
      { label: "30+ Days Overdue",    value: report.above30Days.toString() },
      { label: "60+ Days Overdue",    value: report.above60Days.toString() },
      { label: "Amount Outstanding",  value: `₹${report.amountOutstanding.toLocaleString("en-IN")}` },
    );
    tableHeaders = ["Branch", "Defaulters", "Amount"];
    tableRows = report.byBranch.map(b => [b.branch, b.count.toString(), `₹${b.amount.toLocaleString("en-IN")}`]);
  } else if (report._type === "expense") {
    stats.push(
      { label: "Total Expenses",    value: `₹${report.totalExpenses.toLocaleString("en-IN")}` },
      { label: "Largest Category",  value: report.largestCategory },
      { label: "Categories",        value: report.byCategory.length.toString() },
      { label: "Top Category %",    value: `${report.byCategory[0]?.pct || 0}%` },
    );
    tableHeaders = ["Category", "Amount", "% of Total"];
    tableRows = report.byCategory.map(c => [c.category, `₹${c.amount.toLocaleString("en-IN")}`, `${c.pct}%`]);
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
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const pageShellStyle = usePageShellStyle();
  const [dashboard, setDashboard] = useState<ReportsDashboardData | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [reportData, setReportData] = useState<AnyReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"Preview" | "Schedule" | "Share" | "Settings">("Preview");

  // Schedule tab state
  const [schedFreq,    setSchedFreq]    = useState<"Weekly" | "Monthly" | "Quarterly">("Monthly");
  const [schedEmail,   setSchedEmail]   = useState("");
  const [scheduling,   setScheduling]   = useState(false);
  const [schedDone,    setSchedDone]    = useState(false);

  // Settings tab state
  const [stgBranch,    setStgBranch]    = useState(true);
  const [stgHistory,   setStgHistory]   = useState(true);
  const [stgAutoRefresh, setStgAutoRefresh] = useState(false);

  // Board Report
  const [boardQuarter,  setBoardQuarter]  = useState(() => {
    const now = new Date();
    const q   = Math.ceil((now.getMonth() + 1) / 3);
    return `Q${q} ${now.getFullYear()}`;
  });
  const [boardGenerating, setBoardGenerating] = useState(false);

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

  // Schedule handler — saves to Firestore scheduled_reports collection
  const handleSchedule = useCallback(async () => {
    if (!selectedSlug || !schedEmail.trim()) {
      toast.error("Enter a recipient email first.");
      return;
    }
    /* Reject obviously invalid emails up front so we don't write a doc that
       can never deliver. Pattern is intentionally permissive (no perfect
       email regex exists) — just rejects "abc", "abc@", "@xyz" etc. */
    const trimmedEmail = schedEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error("That doesn't look like a valid email address.");
      return;
    }
    const reg = REPORT_REGISTRY[selectedSlug];
    setScheduling(true);
    try {
      const FREQ_MAP = {
        Weekly:    { label: "Every Monday",   nextRun: (() => { const d = new Date(); d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7)); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); })() },
        Monthly:   { label: "1st of Month",   nextRun: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) },
        Quarterly: { label: "Quarterly",      nextRun: (() => { const qm = Math.ceil((new Date().getMonth() + 1) / 3) * 3; return new Date(new Date().getFullYear(), qm, 0).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); })() },
      };
      await addDoc(collection(db, "scheduled_reports"), {
        name:        `${reg?.label || "Report"} — ${schedFreq}`,
        reportSlug:  selectedSlug,
        frequency:   FREQ_MAP[schedFreq].label,
        nextRun:     FREQ_MAP[schedFreq].nextRun,
        email:       trimmedEmail,
        recipients:  1,
        status:      "Active",
        ownerUid:    auth.currentUser?.uid || "",
        /* schoolId so reportsService scopedDocs("scheduled_reports", uid)
           can find this row on the next dashboard load. ownerUid is kept for
           backward compat — both fields equal uid in current single-owner
           model, but the scoped read uses schoolId. */
        schoolId:    auth.currentUser?.uid || "",
        createdAt:   serverTimestamp(),
      });
      setSchedDone(true);
      toast.success(`Scheduled ${schedFreq.toLowerCase()}! Will send to ${schedEmail}`);
      // Refresh dashboard counts
      fetchReportsDashboard().then(setDashboard).catch(() => {});
    } catch (e) {
      console.error("Schedule error:", e);
      toast.error("Failed to save schedule. Try again.");
    }
    setScheduling(false);
  }, [selectedSlug, schedFreq, schedEmail]);

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
      <div style={pageShellStyle}>
      <div className="space-y-4 md:space-y-8 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-6 md:pb-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs md:text-sm font-bold">
          <button onClick={() => { setSelectedSlug(null); setReportData(null); }} className="text-slate-400 hover:text-blue-600 transition-colors">Reports</button>
          <span className="text-slate-300">/</span>
          <span className="text-[#1e3a8a] font-bold truncate">{reportTitle}</span>
        </div>

        {/* Main Report Card */}
        <div className="dash3d bg-white rounded-2xl md:rounded-[2rem] border border-slate-100" style={{ boxShadow: SHADOW_SM }}>
          <div className="p-4 md:p-8 lg:p-10">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 md:gap-6 mb-6 md:mb-8">
              <div className="min-w-0">
                <h2 className="text-base md:text-2xl font-black text-[#111827] tracking-tight mb-1 md:mb-2 uppercase leading-tight break-words">{reportTitle}</h2>
                <p className="text-slate-400 text-[9px] md:text-sm font-bold uppercase tracking-tight opacity-70">Generated on {(reportData as any).generatedOn}</p>
              </div>
              <div className="flex items-center gap-2 md:gap-3 w-full lg:w-auto">
                <Button variant="outline" onClick={printReport} className="flex-1 lg:flex-none h-10 px-3 md:px-4 rounded-xl border-slate-200 text-[10px] md:text-xs font-black text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-1.5 md:gap-2 uppercase tracking-widest">
                  <Printer className="w-3.5 h-3.5 md:w-4 md:h-4" /> Print
                </Button>
                <Button onClick={() => handleExport("pdf")} className="flex-1 lg:flex-none h-10 px-3 md:px-4 rounded-xl bg-[#1e294b] text-white text-[10px] md:text-xs font-black hover:bg-[#1e3a8a] shadow-lg flex items-center justify-center gap-1.5 md:gap-2 uppercase tracking-widest">
                  <Download className="w-3.5 h-3.5 md:w-4 md:h-4" /> Export
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <div
              className="no-scrollbar"
              style={{
                display: "flex",
                gap: isMobile ? 6 : 12,
                marginBottom: isMobile ? 24 : 40,
                overflowX: "auto",
                paddingBottom: 2,
                WebkitOverflowScrolling: "touch",
                scrollSnapType: "x mandatory",
              }}
            >
              {(["Preview", "Schedule", "Share", "Settings"] as const).map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flexShrink: 0,
                    scrollSnapAlign: "start",
                    padding: isMobile ? "8px 14px" : "10px 32px",
                    borderRadius: isMobile ? 10 : 12,
                    fontSize: isMobile ? 10 : 12,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    border: activeTab === tab ? "none" : "1px solid #e2e8f0",
                    background: activeTab === tab ? "#1e3a8a" : "#fff",
                    color: activeTab === tab ? "#fff" : "#64748b",
                    boxShadow: activeTab === tab ? "0 2px 8px rgba(30,58,138,0.25)" : "none",
                    transition: "all 0.2s ease",
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            {activeTab === "Preview" && (
              <div className="animate-in fade-in duration-500">
                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5 mb-6 md:mb-12">
                  {payload.stats.map((stat, i) => (
                    <div key={i} className="dash-tile bg-[#f8fafc] border border-slate-100 p-3.5 md:p-6 rounded-xl md:rounded-[1.2rem] text-center" style={{ boxShadow: SHADOW_SM }}>
                      <p className="text-slate-400 text-[9px] md:text-[11px] font-black uppercase tracking-widest mb-2 md:mb-3">{stat.label}</p>
                      <h3 className={`text-lg md:text-3xl font-black tracking-tighter ${getStatColor(reportData._type, i)}`}>{stat.value}</h3>
                    </div>
                  ))}
                </div>

                {/* Charts */}
                {renderCharts(reportData, isMobile)}

                {/* Summary */}
                <div className="dash3d bg-[#f8fafc] border border-slate-100 p-4 md:p-8 rounded-xl md:rounded-[1.5rem] mb-4 md:mb-6" style={{ boxShadow: SHADOW_SM }}>
                  <h4 className="text-sm md:text-base font-bold text-[#111827] mb-2 md:mb-4">Report Summary</h4>
                  <p className="text-slate-600 text-xs md:text-sm leading-relaxed">{(reportData as any).summary}</p>
                </div>
              </div>
            )}

            {activeTab === "Schedule" && (
              <div className="animate-in fade-in duration-500 space-y-6">
                {schedDone ? (
                  <div className="flex flex-col items-center justify-center py-8 md:py-12 gap-3 md:gap-4 text-center">
                    <div className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                      <CheckCircle className="w-7 h-7 md:w-8 md:h-8 text-emerald-500" />
                    </div>
                    <p className="text-sm md:text-base font-black text-[#111827]">Report Scheduled!</p>
                    <p className="text-xs md:text-sm text-slate-400 px-4">Will send <strong>{schedFreq.toLowerCase()}</strong> to <strong className="break-all">{schedEmail}</strong></p>
                    <button
                      type="button"
                      onClick={() => { setSchedDone(false); setSchedEmail(""); }}
                      className="text-[10px] md:text-xs font-black text-[#1e3a8a] uppercase tracking-widest hover:underline mt-2 cursor-pointer"
                    >
                      Schedule Another
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Frequency picker */}
                    <div className="dash3d bg-[#f8fafc] border border-slate-100 p-4 md:p-6 rounded-xl md:rounded-[1.5rem]" style={{ boxShadow: SHADOW_SM }}>
                      <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-3 md:mb-4">Frequency</p>
                      <div className="grid grid-cols-3 gap-2 md:gap-3">
                        {(["Weekly", "Monthly", "Quarterly"] as const).map(freq => (
                          <button
                            key={freq}
                            type="button"
                            onClick={() => setSchedFreq(freq)}
                            className={`p-2.5 md:p-4 rounded-lg md:rounded-xl border-2 transition-all text-left cursor-pointer ${
                              schedFreq === freq
                                ? "border-[#1e3a8a] bg-blue-50"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <div className="flex items-center gap-1.5 md:gap-2 mb-1">
                              <Clock className={`w-3.5 h-3.5 md:w-4 md:h-4 ${schedFreq === freq ? "text-[#1e3a8a]" : "text-slate-400"}`} />
                              <span className={`font-black text-xs md:text-sm ${schedFreq === freq ? "text-[#1e3a8a]" : "text-[#111827]"}`}>{freq}</span>
                            </div>
                            <p className="text-[9px] md:text-[10px] text-slate-400 font-medium leading-tight">
                              {freq === "Weekly" ? "Every Monday" : freq === "Monthly" ? "1st of month" : "End of quarter"}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Recipient email */}
                    <div className="dash3d bg-[#f8fafc] border border-slate-100 p-4 md:p-6 rounded-xl md:rounded-[1.5rem]" style={{ boxShadow: SHADOW_SM }}>
                      <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3">Send To (Email)</p>
                      <div className="flex flex-col sm:flex-row gap-2 md:gap-3">
                        <input
                          type="email"
                          value={schedEmail}
                          onChange={e => setSchedEmail(e.target.value)}
                          placeholder="principal@school.com"
                          className="flex-1 h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-[#111827] outline-none focus:border-[#1e3a8a] transition-all"
                        />
                        <button
                          type="button"
                          onClick={handleSchedule}
                          disabled={scheduling || !schedEmail.trim()}
                          className="flex items-center justify-center gap-2 px-5 md:px-6 h-11 rounded-xl bg-[#1e3a8a] text-white text-xs font-black uppercase tracking-widest hover:bg-[#1e294b] transition-all disabled:opacity-50 cursor-pointer"
                        >
                          {scheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
                          {scheduling ? "Saving..." : "Schedule"}
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-2">
                        Report will be auto-generated and emailed on schedule
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === "Share" && (
              <div className="animate-in fade-in duration-500">
                <div className="dash3d bg-[#f8fafc] border border-slate-100 p-4 md:p-8 rounded-xl md:rounded-[1.5rem]" style={{ boxShadow: SHADOW_SM }}>
                  <h4 className="text-sm md:text-base font-bold text-[#111827] mb-4 md:mb-6">Share Report</h4>
                  <div className="flex flex-col gap-3 md:gap-4">

                    {/* Download PDF then share — most reliable */}
                    <button
                      type="button"
                      onClick={() => { handleExport("pdf"); toast.success("PDF downloaded — attach it to your email"); }}
                      className="p-3.5 md:p-5 rounded-xl border border-slate-200 bg-white hover:border-[#1e3a8a] hover:shadow-lg transition-all flex items-center gap-3 md:gap-4 cursor-pointer"
                    >
                      <Mail className="w-5 h-5 text-[#1e3a8a] shrink-0" />
                      <div className="text-left min-w-0">
                        <p className="font-bold text-[#111827] text-xs md:text-sm">Download PDF to Share</p>
                        <p className="text-[10px] md:text-xs text-slate-400">Export PDF → attach to email or WhatsApp</p>
                      </div>
                    </button>

                    {/* Open mailto directly — no async, no popup block */}
                    <a
                      href={(() => {
                        const reg = selectedSlug ? REPORT_REGISTRY[selectedSlug] : null;
                        const title = reg?.label || "Report";
                        const subject = encodeURIComponent(`[Edullent] ${title} Report`);
                        const body = encodeURIComponent(
                          `Hi,\n\nPlease find the ${title} report from Edullent Dashboard.\n\nGenerated on: ${new Date().toLocaleDateString()}\nReport: ${window.location.origin}/reports\n\nRegards`
                        );
                        return `mailto:?subject=${subject}&body=${body}`;
                      })()}
                      className="p-3.5 md:p-5 rounded-xl border border-slate-200 bg-white hover:border-[#1e3a8a] hover:shadow-lg transition-all flex items-center gap-3 md:gap-4 cursor-pointer no-underline"
                    >
                      <FileText className="w-5 h-5 text-emerald-500 shrink-0" />
                      <div className="text-left min-w-0">
                        <p className="font-bold text-[#111827] text-xs md:text-sm">Open Email Client</p>
                        <p className="text-[10px] md:text-xs text-slate-400">Opens your mail app with report details pre-filled</p>
                      </div>
                    </a>

                    {/* Copy link with robust fallback */}
                    <button
                      type="button"
                      onClick={() => {
                        const url = `${window.location.origin}/reports?view=${selectedSlug}`;
                        if (navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText(url)
                            .then(() => toast.success("Link copied!"))
                            .catch(() => { prompt("Copy this link:", url); });
                        } else {
                          prompt("Copy this link:", url);
                        }
                      }}
                      className="p-3.5 md:p-5 rounded-xl border border-slate-200 bg-white hover:border-[#1e3a8a] hover:shadow-lg transition-all flex items-center gap-3 md:gap-4 cursor-pointer"
                    >
                      <BookOpen className="w-5 h-5 text-amber-500 shrink-0" />
                      <div className="text-left min-w-0">
                        <p className="font-bold text-[#111827] text-xs md:text-sm">Copy Report Link</p>
                        <p className="text-[10px] md:text-xs text-slate-400">Shareable URL for this report</p>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Settings" && (
              <div className="animate-in fade-in duration-500">
                <div className="dash3d bg-[#f8fafc] border border-slate-100 p-4 md:p-8 rounded-xl md:rounded-[1.5rem]" style={{ boxShadow: SHADOW_SM }}>
                  <h4 className="text-sm md:text-base font-bold text-[#111827] mb-4 md:mb-6">Report Settings</h4>
                  <div className="space-y-2.5 md:space-y-3">
                    {[
                      {
                        label: "Include branch breakdown",
                        desc: "Show data separated by each branch",
                        icon: BarChart3,
                        val: stgBranch,
                        set: setStgBranch,
                      },
                      {
                        label: "Include historical comparison",
                        desc: "Compare current data with previous period",
                        icon: TrendingUp,
                        val: stgHistory,
                        set: setStgHistory,
                      },
                      {
                        label: "Auto-refresh data",
                        desc: "Reload report data every 60 seconds",
                        icon: RefreshCw,
                        val: stgAutoRefresh,
                        set: setStgAutoRefresh,
                      },
                    ].map((setting) => (
                      <div key={setting.label} className="flex items-center justify-between gap-3 p-3.5 md:p-5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all">
                        <div className="flex items-center gap-2.5 md:gap-3 min-w-0">
                          <div className={`w-8 h-8 md:w-9 md:h-9 rounded-lg md:rounded-xl flex items-center justify-center shrink-0 ${setting.val ? "bg-blue-50" : "bg-slate-50"}`}>
                            <setting.icon className={`w-4 h-4 ${setting.val ? "text-[#1e3a8a]" : "text-slate-400"}`} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-xs md:text-sm text-[#111827] leading-tight">{setting.label}</p>
                            <p className="text-[10px] md:text-xs text-slate-400 mt-0.5 leading-snug">{setting.desc}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setting.set(!setting.val)}
                          className={`w-11 h-6 rounded-full relative transition-all duration-300 shrink-0 cursor-pointer ${setting.val ? "bg-[#1e3a8a]" : "bg-slate-200"}`}
                        >
                          <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 shadow transition-all duration-300 ${setting.val ? "translate-x-5" : "translate-x-0.5"}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-3 md:mt-4 text-center">Settings apply to preview only — not to exported files</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Export Options */}
        <div className="dash3d bg-white rounded-2xl md:rounded-[2rem] border border-slate-100 p-4 md:p-10" style={{ boxShadow: SHADOW_SM }}>
          <h3 className="text-sm md:text-xl font-black text-[#111827] mb-5 md:mb-10 uppercase tracking-widest">Export Options</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
            {[
              { label: "PDF", icon: <FileText className="w-5 h-5 md:w-8 md:h-8" />, col: "text-[#ef4444]", format: "pdf" as const },
              { label: "Excel", icon: <FileSpreadsheet className="w-5 h-5 md:w-8 md:h-8" />, col: "text-[#22c55e]", format: "excel" as const },
              { label: "CSV", icon: <FileText className="w-5 h-5 md:w-8 md:h-8" />, col: "text-[#3b82f6]", format: "csv" as const },
              { label: "Email", icon: <Mail className="w-5 h-5 md:w-8 md:h-8" />, col: "text-[#1e3a8a]", format: "email" as const },
            ].map((opt, i) => (
              <button key={i} onClick={() => handleExport(opt.format)} className="dash-tile bg-[#f8fafc] border border-slate-100 p-4 md:p-8 rounded-xl md:rounded-[1.5rem] flex flex-col items-center gap-2 md:gap-4 cursor-pointer group" style={{ boxShadow: SHADOW_SM }}>
                <div className={`${opt.col} group-hover:scale-110 transition-transform`}>{opt.icon}</div>
                <span className="text-[10px] md:text-sm font-black text-slate-600 uppercase tracking-widest">{opt.label}</span>
              </button>
            ))}
          </div>
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

  // Default to the registry size if stats hasn't loaded yet. Hardcoding 12
  // would drift if REPORT_REGISTRY ever grows; computing from the imported
  // map keeps them in lock-step.
  const totalReports = stats?.totalReports ?? Object.keys(REPORT_REGISTRY).length;
  const scheduledCount = stats?.scheduled ?? 0;
  const recentDownloads = stats?.recentDownloads ?? 0;
  const favorites = stats?.favorites ?? 0;

  const categoryBlocks = [
    { key:"student",   title:"Student Reports",  icon:GraduationCap,  grad:GRAD_BLUE,    iconGrad:"linear-gradient(135deg,#0055FF 0%,#1166FF 100%)", iconShadow:"rgba(0,85,255,.28)",   bg:"rgba(0,85,255,.08)",    items: REPORT_CATEGORIES.student },
    { key:"teacher",   title:"Teacher Reports",  icon:Presentation,   grad:GRAD_GREEN,   iconGrad:"linear-gradient(135deg,#10B981 0%,#059669 100%)", iconShadow:"rgba(16,185,129,.28)", bg:"rgba(0,200,83,.10)",    items: REPORT_CATEGORIES.teacher },
    { key:"financial", title:"Financial Reports",icon:DollarSign,     grad:GRAD_GOLD,    iconGrad:"linear-gradient(135deg,#F59E0B 0%,#D97706 100%)", iconShadow:"rgba(245,158,11,.28)", bg:"rgba(255,170,0,.12)",   items: REPORT_CATEGORIES.financial },
  ];

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 16 : 24 }}>

      <PageHead
        icon={FileText}
        title="Reports Center"
        subtitle="Generate, schedule & download reports"
        right={
          <button
            className="dash-btn"
            style={{
              display:"inline-flex", alignItems:"center", justifyContent:"center", gap: isMobile ? 6 : 7,
              padding: isMobile ? "9px 12px" : "11px 18px", borderRadius: isMobile ? 12 : 14,
              background:GRAD_PRIMARY, color:"#fff",
              fontSize: isMobile ? 10 : 12, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
              border:"none", cursor:"pointer", boxShadow:SHADOW_BTN, fontFamily:"inherit",
              whiteSpace:"nowrap",
            }}
          >
            <Plus size={isMobile ? 13 : 15} strokeWidth={2.4}/> {isMobile ? "Create" : "Create Report"}
          </button>
        }
      />

      <DarkHero
        icon={BarChart3}
        eyebrow={<><Sparkles size={11} style={{ display:"inline", marginRight:4 }}/> Reporting Intelligence</> as any}
        title={totalReports.toString()}
        subtitle={`Available report${totalReports!==1?"s":""} across ${stats?.totalCategories || 3} categories · ${scheduledCount} scheduled · ${recentDownloads} recent downloads`}
        stats={[
          { label:"Scheduled", value: scheduledCount.toString() },
          { label:"Downloads", value: recentDownloads.toString() },
          { label:"Favorites", value: favorites.toString() },
        ]}
      />

      {/* Bright Stat Grid */}
      <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16 }}>
        <StatTile label="Total Reports"     value={totalReports.toString()}     sub={`${stats?.totalCategories || 3} categories`}  grad={GRAD_BLUE}   icon={FileText}     onClick={()=>navigate("/reports")} />
        <StatTile label="Scheduled"         value={scheduledCount.toString()}   sub="Auto-generated"                               grad={GRAD_GREEN}  icon={Clock}        onClick={()=>navigate("/reports")} />
        <StatTile label="Recent Downloads"  value={recentDownloads.toString()}  sub="Last 7 days"                                  grad={GRAD_VIOLET} icon={Download}     onClick={()=>navigate("/reports")} />
        <StatTile label="Favorites"         value={favorites.toString()}        sub="Quick access"                                 grad={GRAD_GOLD}   icon={Star}         onClick={()=>navigate("/reports")} />
      </div>

      {/* Report Categories */}
      <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 12 : 16 }}>
        {categoryBlocks.map(cat => {
          const Icon = cat.icon;
          return (
            <div
              key={cat.key}
              className="dash3d"
              style={{
                background:"#fff", borderRadius: isMobile ? 18 : 22, padding: isMobile ? "16px 16px" : "22px 24px",
                boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
              }}
            >
              <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, marginBottom: isMobile ? 12 : 16, paddingBottom: isMobile ? 10 : 14, borderBottom:"0.5px solid rgba(0,85,255,.08)" }}>
                <div style={{
                  width: isMobile ? 36 : 42, height: isMobile ? 36 : 42, borderRadius: isMobile ? 11 : 13, background:cat.iconGrad,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  boxShadow:`0 6px 14px ${cat.iconShadow}`, flexShrink:0,
                }}>
                  <Icon size={isMobile ? 17 : 20} color="#fff" strokeWidth={2.3}/>
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ fontSize: isMobile ? 13 : 15, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.3px" }}>{cat.title}</h3>
                  <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:700, color:"#5A6E96", margin:"2px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>{cat.items.length} templates</p>
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {cat.items.map(item => (
                  <button
                    key={item}
                    onClick={() => openReport(item)}
                    className="dash-row"
                    style={{
                      width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
                      padding: isMobile ? "10px 10px" : "11px 12px", borderRadius:10,
                      background:"transparent", border:"none",
                      fontSize: isMobile ? 12 : 12, fontWeight:600, color:T3,
                      cursor:"pointer", fontFamily:"inherit", textAlign:"left",
                    }}
                  >
                    <span style={{ minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{item}</span>
                    <ChevronRight size={14} color={T4} style={{ flexShrink: 0 }}/>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Scheduled Reports */}
      <div className="dash3d bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 overflow-hidden" style={{ boxShadow: SHADOW_SM }}>
        <div className="p-4 md:p-10 border-b border-slate-50 flex items-center justify-between">
          <h3 className="text-sm md:text-xl font-black text-[#111827] uppercase tracking-widest">Scheduled Reports</h3>
          {isMobile && scheduled.length > 0 && (
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{scheduled.length}</span>
          )}
        </div>

        {scheduled.length === 0 ? (
          <div className="p-6 md:p-10 text-center text-xs md:text-sm text-slate-400 font-semibold">
            No scheduled reports yet. Open a report &rarr; Schedule tab to set one up.
          </div>
        ) : isMobile ? (
          <div className="flex flex-col divide-y divide-slate-50">
            {scheduled.map((job, i) => (
              <div key={i} className="p-4 hover:bg-slate-50/30 transition-colors">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <p className="font-black text-[#111827] text-xs tracking-tight truncate flex-1 min-w-0">{job.name}</p>
                  <span className={`text-[9px] font-black uppercase tracking-widest shrink-0 px-2 py-0.5 rounded-md ${job.status === "Active" ? "text-blue-600 bg-blue-50" : "text-slate-500 bg-slate-100"}`}>{job.status}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Frequency</p>
                    <p className="text-[11px] font-bold text-slate-600 truncate">{job.frequency}</p>
                  </div>
                  <div>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Next Run</p>
                    <p className="text-[11px] font-bold text-slate-600 truncate">{job.nextRun}</p>
                  </div>
                  <div>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Users</p>
                    <p className="text-[11px] font-bold text-slate-600">{job.recipients}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto pb-4">
            <table className="w-full text-left min-w-[700px]">
              <thead>
                <tr className="bg-slate-50/50">
                  <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Report Name</th>
                  <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Frequency</th>
                  <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest hidden md:table-cell">Next Run</th>
                  <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest hidden sm:table-cell">Users</th>
                  <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {scheduled.map((job, i) => (
                  <tr key={i} className="hover:bg-slate-50/30 transition-colors group cursor-pointer">
                    <td className="py-6 px-6 md:px-10">
                      <p className="font-black text-[#111827] text-xs md:text-sm tracking-tight group-hover:text-blue-600 transition-colors truncate">{job.name}</p>
                    </td>
                    <td className="py-6 px-6 md:px-10 text-slate-500 font-bold text-[10px] md:text-xs uppercase tracking-tight">{job.frequency}</td>
                    <td className="py-6 px-6 md:px-10 text-slate-500 font-bold text-[10px] md:text-xs hidden md:table-cell uppercase tracking-tight">{job.nextRun}</td>
                    <td className="py-6 px-6 md:px-10 text-slate-500 font-bold text-[10px] md:text-xs hidden sm:table-cell uppercase tracking-tight">{job.recipients} users</td>
                    <td className="py-6 px-6 md:px-10">
                      <span className={`text-[10px] md:text-xs font-black uppercase tracking-widest ${job.status === "Active" ? "text-blue-600" : "text-slate-400"}`}>{job.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Board Report Section ───────────────────────────────────────────
          Inline styles instead of Tailwind arbitrary classes — the prior
          `bg-gradient-to-br from-[#1e3a8a] to-[#2563eb]` was rendering as
          near-transparent on the user's build (likely a Tailwind purge or
          JIT-arbitrary class miss), making the card almost invisible against
          the page background. Inline styles guarantee the dark gradient
          renders even if Tailwind config drifts. */}
      <div style={{
        background: "linear-gradient(135deg, #001A4D 0%, #0033CC 55%, #0055FF 100%)",
        borderRadius: isMobile ? 18 : 28,
        padding: isMobile ? "20px 18px" : "30px 36px",
        color: "#fff",
        boxShadow: "0 14px 38px rgba(0,8,40,0.40), 0 4px 12px rgba(0,8,40,0.22)",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Subtle radial highlight so the card has depth */}
        <div style={{
          position: "absolute", top: -40, right: -40, width: 240, height: 240,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 65%)",
          pointerEvents: "none",
        }} />
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 md:gap-6" style={{ position: "relative", zIndex: 1 }}>
          <div className="flex items-start gap-3 md:gap-4 min-w-0">
            <div style={{
              width: isMobile ? 44 : 52, height: isMobile ? 44 : 52,
              borderRadius: isMobile ? 13 : 16,
              background: "rgba(255,255,255,0.18)",
              border: "1px solid rgba(255,255,255,0.28)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            }}>
              <Building2 size={isMobile ? 22 : 26} color="#fff" strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center flex-wrap gap-2 mb-1">
                <h3 style={{ fontSize: isMobile ? 15 : 20, fontWeight: 800, color: "#fff", letterSpacing: "-0.4px", margin: 0 }}>One-Click Board Report</h3>
                <span style={{
                  fontSize: 9, fontWeight: 800, color: "#fff",
                  background: "rgba(255,255,255,0.22)",
                  padding: "3px 9px", borderRadius: 999,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                }}>PDF</span>
              </div>
              <p style={{
                color: "rgba(255,255,255,0.88)",
                fontSize: isMobile ? 12 : 13, fontWeight: 500, lineHeight: 1.5,
                marginTop: 4, marginBottom: 0,
              }}>
                Auto-generates a professional 12-page PDF with executive summary, branch heatmap,
                fee waterfall, risk analysis &amp; action items — ready for your trustees.
              </p>
              <div className="flex flex-wrap items-center" style={{ gap: 6, marginTop: 12 }}>
                {["Executive Summary", "Branch Performance", "Risk Analysis", "Fee Collection", "Recommendations"].map(s => (
                  <span key={s} style={{
                    fontSize: 10, fontWeight: 700, color: "#fff",
                    background: "rgba(255,255,255,0.14)",
                    border: "1px solid rgba(255,255,255,0.22)",
                    padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap",
                  }}>{s}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-stretch lg:items-end gap-2.5 md:gap-3 shrink-0 w-full lg:w-auto">
            <div className="flex items-center gap-2 justify-between lg:justify-end">
              <label style={{ fontSize: isMobile ? 11 : 12, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>Quarter:</label>
              <select
                value={boardQuarter}
                onChange={e => setBoardQuarter(e.target.value)}
                style={{
                  background: "rgba(255,255,255,0.16)",
                  border: "1px solid rgba(255,255,255,0.30)",
                  color: "#fff",
                  fontSize: 12, fontWeight: 700,
                  borderRadius: 10,
                  padding: "7px 10px",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                {(() => {
                  const opts: string[] = [];
                  const now = new Date();
                  for (let y = now.getFullYear(); y >= now.getFullYear() - 1; y--) {
                    for (let q = 4; q >= 1; q--) {
                      if (y === now.getFullYear() && q > Math.ceil((now.getMonth() + 1) / 3)) continue;
                      opts.push(`Q${q} ${y}`);
                    }
                  }
                  return opts.map(o => <option key={o} value={o} className="text-slate-900">{o}</option>);
                })()}
              </select>
            </div>
            <button
              disabled={boardGenerating}
              onClick={async () => {
                setBoardGenerating(true);
                try {
                  // Get school name from Firestore
                  const uid = auth.currentUser?.uid;
                  let schoolName = "My School";
                  let ownerName  = "";
                  if (uid) {
                    const snap = await getDoc(doc(db, "schools", uid));
                    schoolName  = snap.data()?.schoolName || schoolName;
                    ownerName   = snap.data()?.ownerName  || "";
                  }
                  await generateBoardReportPDF({ schoolName, quarter: boardQuarter, ownerName });
                  toast.success("Board Report downloaded!");
                } catch (e: any) {
                  toast.error("Report failed: " + e.message);
                }
                setBoardGenerating(false);
              }}
              className="flex items-center justify-center gap-2 whitespace-nowrap"
              style={{
                padding: isMobile ? "11px 18px" : "13px 24px",
                borderRadius: 14,
                background: "#fff",
                color: "#001A4D",
                fontSize: isMobile ? 12 : 13,
                fontWeight: 800,
                border: "none",
                cursor: boardGenerating ? "not-allowed" : "pointer",
                boxShadow: "0 6px 18px rgba(0,0,0,0.20), 0 2px 6px rgba(0,0,0,0.12)",
                opacity: boardGenerating ? 0.7 : 1,
                fontFamily: "inherit",
              }}
            >
              {boardGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {boardGenerating ? "Generating PDF…" : isMobile ? `Download ${boardQuarter}` : `Download ${boardQuarter} Report`}
            </button>
          </div>
        </div>
      </div>

      <AIInsightCard
        title="Reports Intelligence Summary"
        items={[
          { label:"Report Coverage",  value: `${totalReports} available`, sub: `${stats?.totalCategories || 3} categories ready` },
          { label:"Automation",       value: scheduledCount > 0 ? `${scheduledCount} scheduled` : "No auto jobs yet", sub: scheduledCount > 0 ? "Running on schedule" : "Set up recurring reports" },
          { label:"Usage Pulse",      value: recentDownloads > 0 ? `${recentDownloads} downloads` : "No recent activity", sub: favorites > 0 ? `${favorites} favorite${favorites!==1?"s":""}` : "Mark favorites for quick access" },
        ]}
      />

      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CHART RENDERER (per report type)
// ══════════════════════════════════════════════════════════════════════════════

function renderCharts(data: AnyReportData, isMobile: boolean = false): JSX.Element {
  const COLORS = ["#1e3a8a", "#3b82f6", "#f59e0b", "#22c55e", "#ef4444", "#8b5cf6"];
  const H = isMobile ? "h-[220px]" : "h-[280px]";
  const H_SMALL = isMobile ? "h-[210px]" : "h-[260px]";
  const GRID = isMobile ? "grid grid-cols-1 gap-6 mb-6" : "grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12";
  const TITLE = isMobile ? "text-sm font-bold text-[#111827] mb-3" : "text-base font-bold text-[#111827] mb-8";

  if (data._type === "enrollment") {
    const hasGradeData = data.enrollmentByGrade.some(g => g.enrollment > 0);
    const hasTrendData = data.enrollmentTrend.length > 0;

    return (
      <div className={GRID}>
        <div>
          <h3 className={TITLE}>Enrollment by Grade</h3>
          {!hasGradeData ? (
            <div className={`${H} flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2`}>
              <p className="text-sm text-slate-400 font-semibold">No grade-level data available</p>
              <p className="text-xs text-slate-300">Appears once students have grade assignments</p>
            </div>
          ) : (
            <div className={H}>
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
          <h3 className={TITLE}>Enrollment Trend</h3>
          {!hasTrendData ? (
            <div className={`${H} flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2`}>
              <p className="text-sm text-slate-400 font-semibold">No trend data yet</p>
            </div>
          ) : (
            <div className={H}>
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
      <div className={GRID}>
        <div>
          <h3 className={TITLE}>Monthly Attendance Trend</h3>
          {!hasTrend ? (
            <EmptyChart message="No monthly trend data yet" />
          ) : (
            <div className={H}>
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
          <h3 className={TITLE}>Branch-wise Attendance</h3>
          {!hasBranch ? (
            <EmptyChart message="No branch data" />
          ) : (
            <div className={H}>
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
      <div className={GRID}>
        <div>
          <h3 className={TITLE}>Subject Performance</h3>
          {!hasSubjects ? <EmptyChart message="No subject data" /> : (
            <div className={H}>
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
          <h3 className={TITLE}>Score Distribution</h3>
          {!hasDist ? <EmptyChart message="No distribution data" /> : (
            <div className={H}>
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
      <div className={GRID}>
        <div>
          <h3 className={TITLE}>Risk by Branch</h3>
          {!hasBranch ? <EmptyChart message="No at-risk data" /> : (
            <div className={H}>
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
          <h3 className={TITLE}>Risk Categories</h3>
          {!hasCat ? <EmptyChart message="No category data" /> : (
            <div className={H}>
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
      <div className={GRID}>
        <div>
          <h3 className={TITLE}>Teachers by Branch</h3>
          {!hasBranch ? <EmptyChart message="No teacher data" /> : (
            <div className={H}>
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
          <h3 className={TITLE}>Performance Distribution</h3>
          {!hasDist ? <EmptyChart message="No distribution data" /> : (
            <div className={H}>
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
      <div className={GRID}>
        <div>
          <h3 className={TITLE}>Revenue by Branch</h3>
          {!hasBranch ? <EmptyChart message="No revenue data" /> : (
            <div className={H}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byBranch} margin={{ left: -10, right: 10 }}>
                  <XAxis dataKey="branch" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} tickFormatter={v => `₹${(v/1000).toFixed(0)}K`} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Collected"]} />
                  <Bar dataKey="collected" name="Collected" fill="#1e3a8a" radius={[4, 4, 0, 0]} barSize={24} />
                  <Bar dataKey="total" name="Total" fill="#e2e8f0" radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div>
          <h3 className={TITLE}>Monthly Collection Trend</h3>
          {!hasTrend ? <EmptyChart message="No monthly data" /> : (
            <div className={H}>
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
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} tickFormatter={v => `₹${(v/1000).toFixed(0)}K`} />
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
      <div className={GRID}>
        <div>
          <h3 className={TITLE}>Collection Rate by Branch</h3>
          {!hasBranch ? <EmptyChart message="No fee data" /> : (
            <div className={H}>
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
          <h3 className={TITLE}>Payment Modes</h3>
          {!hasModes ? <EmptyChart message="No payment data" /> : (
            <div className={H}>
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

  // ── Workload Analysis ───────────────────────────────────────────────────────
  if (data._type === "workload") {
    const hasDist = data.workloadDist.some(d => d.count > 0);
    const hasTop  = data.topByWorkload.length > 0;
    return (
      <div className={GRID}>
        <div>
          <h3 className={TITLE}>Workload Distribution</h3>
          {!hasDist ? <EmptyChart message="No class assignment data" /> : (
            <div className={H}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.workloadDist} margin={{ left: -10, right: 10 }}>
                  <XAxis dataKey="range" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <Bar dataKey="count" name="Teachers" fill="#1e3a8a" radius={[4,4,0,0]} barSize={36} label={{ position: "top", fill: "#64748b", fontSize: 10, fontWeight: "bold" }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div>
          <h3 className={TITLE}>Top Workload — Teachers</h3>
          {!hasTop ? <EmptyChart message="No teacher data" /> : (
            <div className={H}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.topByWorkload.slice(0, 6)} layout="vertical" margin={{ left: 60, right: 20 }}>
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 10, fontWeight: "bold" }} width={60} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <Bar dataKey="classes" name="Classes" fill="#1e3a8a" radius={[0,4,4,0]} barSize={14} />
                  <Bar dataKey="subjects" name="Subjects" fill="#3b82f6" radius={[0,4,4,0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Feedback Summary ────────────────────────────────────────────────────────
  if (data._type === "feedback") {
    const sentimentData = [
      { name: "Positive", value: data.positiveCount, fill: "#22c55e" },
      { name: "Neutral",  value: data.neutralCount,  fill: "#f59e0b" },
      { name: "Negative", value: data.negativeCount, fill: "#ef4444" },
    ].filter(d => d.value > 0);
    const hasBranch  = data.byBranch.some(b => b.count > 0);
    const hasRecent  = data.recentItems.length > 0;
    return (
      <div className={isMobile ? "space-y-6 mb-6" : "space-y-10 mb-12"}>
        <div className={isMobile ? "grid grid-cols-1 gap-6" : "grid grid-cols-1 lg:grid-cols-2 gap-10"}>
          <div>
            <h3 className={TITLE}>Sentiment Breakdown</h3>
            {sentimentData.length === 0 ? <EmptyChart message="No rated feedback" /> : (
              <div className={H_SMALL}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={sentimentData} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                      {sentimentData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: "12px", border: "none" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div>
            <h3 className={TITLE}>Feedback by Branch</h3>
            {!hasBranch ? <EmptyChart message="No branch feedback data" /> : (
              <div className={H_SMALL}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byBranch} margin={{ left: -10, right: 10 }}>
                    <XAxis dataKey="branch" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} />
                    <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                    <Bar dataKey="count" name="Feedback Count" fill="#1e3a8a" radius={[4,4,0,0]} barSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
        {hasRecent && (
          <div>
            <h3 className={isMobile ? "text-sm font-bold text-[#111827] mb-3" : "text-base font-bold text-[#111827] mb-4"}>Recent Feedback</h3>
            <div className="space-y-2 md:space-y-3">
              {data.recentItems.map((item, i) => (
                <div key={i} className="flex items-start gap-3 md:gap-4 p-3 md:p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-[#1e3a8a] text-white flex items-center justify-center text-[11px] md:text-xs font-black shrink-0">
                    {item.author.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center flex-wrap gap-1.5 md:gap-2 mb-1">
                      <span className="text-[11px] md:text-xs font-black text-[#111827] truncate">{item.author}</span>
                      <span className="text-[9px] md:text-[10px] px-1.5 md:px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-bold whitespace-nowrap">{item.type}</span>
                      <span className="text-[9px] md:text-[10px] text-slate-400 ml-auto whitespace-nowrap">{item.date}</span>
                    </div>
                    <p className="text-[11px] md:text-xs text-slate-500 leading-relaxed truncate">{item.message || "—"}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Training Needs ──────────────────────────────────────────────────────────
  if (data._type === "training-needs") {
    const hasSubj  = data.bySubject.length > 0;
    const hasRisk  = data.teachersAtRisk.length > 0;
    return (
      <div className={isMobile ? "space-y-6 mb-6" : "space-y-10 mb-12"}>
        <div className={isMobile ? "grid grid-cols-1 gap-6" : "grid grid-cols-1 lg:grid-cols-2 gap-10"}>
          <div>
            <h3 className={TITLE}>Weak Subjects (Avg Score)</h3>
            {!hasSubj ? <EmptyChart message="No subject performance data" /> : (
              <div className={H}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.bySubject} margin={{ left: -10, right: 10 }}>
                    <XAxis dataKey="subject" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                    <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} />
                    <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} formatter={(v: number) => [`${v}%`, "Avg Score"]} />
                    <Bar dataKey="avgScore" name="Avg Score" fill="#ef4444" radius={[4,4,0,0]} barSize={32} label={{ position: "top", fill: "#64748b", fontSize: 10, fontWeight: "bold", formatter: (v: number) => `${v}%` }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div>
            <h3 className={isMobile ? "text-sm font-bold text-[#111827] mb-3" : "text-base font-bold text-[#111827] mb-4"}>Teachers Needing Support</h3>
            {!hasRisk ? (
              <div className={`${H} flex items-center justify-center border border-dashed border-slate-200 rounded-xl`}>
                <p className="text-sm text-emerald-500 font-bold">All teachers performing well!</p>
              </div>
            ) : (
              <div className={`space-y-2 md:space-y-3 ${isMobile ? "max-h-[220px]" : "max-h-[280px]"} overflow-y-auto pr-1`}>
                {data.teachersAtRisk.map((t, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 p-3 md:p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="min-w-0">
                      <p className="text-xs md:text-sm font-black text-[#111827] truncate">{t.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">{t.subject} • {t.branch}</p>
                    </div>
                    <span className={`text-[11px] md:text-xs font-black px-2.5 md:px-3 py-1 rounded-lg shrink-0 ${t.score < 50 ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}>
                      {t.score}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Outstanding Fees ────────────────────────────────────────────────────────
  if (data._type === "outstanding") {
    const agingData = [
      { label: "30+ Days", count: data.above30Days, amount: data.amount30, fill: "#f59e0b" },
      { label: "60+ Days", count: data.above60Days, amount: data.amount60, fill: "#ef4444" },
      { label: "90+ Days", count: data.above90Days, amount: data.amount90, fill: "#7f1d1d" },
    ].filter(d => d.count > 0);
    const hasBranch = data.byBranch.length > 0;
    return (
      <div className={GRID}>
        <div>
          <h3 className={TITLE}>Aging Analysis</h3>
          {agingData.length === 0 ? <EmptyChart message="No overdue fees found" /> : (
            <div className={H}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingData} margin={{ left: -10, right: 10 }}>
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} formatter={(v: number, name: string) => [name === "count" ? `${v} students` : `₹${v.toLocaleString("en-IN")}`, name === "count" ? "Defaulters" : "Amount"]} />
                  <Bar dataKey="count" name="count" radius={[4,4,0,0]} barSize={40} label={{ position: "top", fill: "#64748b", fontSize: 10, fontWeight: "bold" }}>
                    {agingData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div>
          <h3 className={TITLE}>Outstanding by Branch</h3>
          {!hasBranch ? <EmptyChart message="No outstanding data by branch" /> : (
            <div className={H}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byBranch} margin={{ left: -10, right: 10 }}>
                  <XAxis dataKey="branch" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} tickFormatter={v => `₹${(v/1000).toFixed(0)}K`} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Outstanding"]} />
                  <Bar dataKey="amount" name="amount" fill="#ef4444" radius={[4,4,0,0]} barSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Expense Analysis ────────────────────────────────────────────────────────
  if (data._type === "expense") {
    const hasCat   = data.byCategory.length > 0;
    const hasTrend = data.monthlyTrend.some(m => m.amount > 0);
    return (
      <div className={GRID}>
        <div>
          <h3 className={TITLE}>Expense by Category</h3>
          {!hasCat ? <EmptyChart message="No expense data" /> : (
            <div className={H}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.byCategory} cx="50%" cy="50%" outerRadius={90} dataKey="amount" nameKey="category" label={({ category, pct }) => `${category} ${pct}%`} labelLine={false}>
                    {data.byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none" }} formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Amount"]} />
                  <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div>
          <h3 className={TITLE}>Monthly Expense Trend</h3>
          {!hasTrend ? <EmptyChart message="No monthly expense data" /> : (
            <div className={H}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.monthlyTrend} margin={{ left: -10, right: 10 }}>
                  <defs>
                    <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} tickFormatter={v => `₹${(v/1000).toFixed(0)}K`} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Expenses"]} />
                  <Area type="monotone" dataKey="amount" stroke="#ef4444" strokeWidth={3} fill="url(#expGrad)" dot={{ r: 4, fill: "#ef4444", strokeWidth: 2, stroke: "#fff" }} />
                </AreaChart>
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
