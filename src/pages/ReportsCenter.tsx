import { useState } from "react";
import { reportStats, reportCategories, scheduledReports, enrollmentReport } from "@/data/dummyData";
import {
  FileText, Clock, Download, Star, ArrowLeft, Plus,
  Settings, Filter, Calendar, Users, Briefcase, Zap, CheckCircle, MapPin, ChevronRight,
  GraduationCap, Presentation, DollarSign, Printer, Mail, FileSpreadsheet
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, LineChart, Line,
} from "recharts";
import { Button } from "@/components/ui/button";

export default function ReportsCenter() {
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [activeReportTab, setActiveReportTab] = useState<"Preview" | "Schedule" | "Share" | "Settings">("Preview");

  return (
    <div className="space-y-10 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">
      {!selectedReport ? (
        <>
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

          {/* Stats Cards Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { label: "Total Reports", value: "48", note: "12 categories" },
              { label: "Scheduled", value: "8", note: "Auto-generated", noteCol: "text-emerald-500" },
              { label: "Recent Downloads", value: "24", note: "Last 7 days" },
              { label: "Favorites", value: "6", note: "Quick access" },
            ].map((stat, i) => (
              <div key={i} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm transition-all hover:shadow-md">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-tight mb-4">{stat.label}</p>
                <h3 className="text-4xl font-extrabold text-[#111827] tracking-tighter mb-2">{stat.value}</h3>
                <p className={`text-[11px] font-bold ${stat.noteCol || 'text-slate-400'}`}>{stat.note}</p>
              </div>
            ))}
          </div>

          {/* Report Categories */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-[2rem] border border-slate-100 p-8 shadow-sm">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-2xl bg-[#1e3a8a] flex items-center justify-center text-white shadow-lg">
                  <GraduationCap className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-[#111827]">Student Reports</h3>
              </div>
              <div className="space-y-0 divide-y divide-slate-50">
                {reportCategories.student.map(item => (
                  <button
                    key={item}
                    onClick={() => item === "Enrollment Summary" && setSelectedReport(enrollmentReport)}
                    className="w-full flex items-center justify-between py-4 text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors group"
                  >
                    {item}
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors" />
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-[2rem] border border-slate-100 p-8 shadow-sm">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-2xl bg-[#22c55e] flex items-center justify-center text-white shadow-lg">
                  <Presentation className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-[#111827]">Teacher Reports</h3>
              </div>
              <div className="space-y-0 divide-y divide-slate-50">
                {reportCategories.teacher.map(item => (
                  <button key={item} className="w-full flex items-center justify-between py-4 text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors group">
                    {item}
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors" />
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-[2rem] border border-slate-100 p-8 shadow-sm">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-2xl bg-[#f59e0b] flex items-center justify-center text-white shadow-lg">
                  <DollarSign className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-[#111827]">Financial Reports</h3>
              </div>
              <div className="space-y-0 divide-y divide-slate-50">
                {reportCategories.financial.map(item => (
                  <button key={item} className="w-full flex items-center justify-between py-4 text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors group">
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
                  {[
                    { name: "Weekly Executive Summary", freq: "Every Monday", next: "Jan 20, 2025", recipients: "3 users", status: "Active" },
                    { name: "Monthly Financial Report", freq: "1st of Month", next: "Feb 1, 2025", recipients: "5 users", status: "Active" },
                    { name: "Quarterly Academic Review", freq: "Quarterly", next: "Mar 31, 2025", recipients: "8 users", status: "Active" },
                  ].map((job, i) => (
                    <tr key={i} className="hover:bg-slate-50/30 transition-colors group cursor-pointer">
                      <td className="py-7 px-10">
                        <p className="font-bold text-[#111827] text-[15px] tracking-tight group-hover:text-blue-600 transition-colors">{job.name}</p>
                      </td>
                      <td className="py-7 px-10 text-slate-500 font-medium text-sm">{job.freq}</td>
                      <td className="py-7 px-10 text-slate-500 font-medium text-sm">{job.next}</td>
                      <td className="py-7 px-10 text-slate-500 font-medium text-sm">{job.recipients}</td>
                      <td className="py-7 px-10">
                        <span className="text-[#111827] font-black text-sm">{job.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* ==================== ENROLLMENT SUMMARY REPORT DETAIL ==================== */
        <div className="animate-in fade-in duration-700 space-y-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm font-bold">
            <button onClick={() => setSelectedReport(null)} className="text-slate-400 hover:text-blue-600 transition-colors">Reports Center</button>
            <span className="text-slate-300">/</span>
            <span className="text-[#1e3a8a] font-bold">Enrollment Summary Report</span>
          </div>

          {/* Main Report Card */}
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-8 lg:p-10">
              {/* Report Header */}
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-[#111827] tracking-tight mb-2">Enrollment Summary Report</h2>
                  <p className="text-slate-400 text-sm font-medium">Generated on {selectedReport.generatedOn} • Report ID: {selectedReport.id}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" className="h-10 px-5 rounded-xl border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                    <Printer className="w-4 h-4" /> Print
                  </Button>
                  <Button className="h-10 px-5 rounded-xl bg-[#1e294b] text-white text-xs font-bold hover:bg-[#1e3a8a] shadow-lg flex items-center gap-2">
                    <Download className="w-4 h-4" /> Export
                  </Button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-3 mb-10">
                {["Preview", "Schedule", "Share", "Settings"].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveReportTab(tab as any)}
                    className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      activeReportTab === tab ? "bg-[#1e3a8a] text-white shadow-sm" : "bg-white text-slate-500 hover:bg-slate-50 border border-slate-100"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-12">
                {[
                  { label: "Total Enrollment", value: selectedReport.totalEnrollment.toLocaleString(), col: "text-[#111827]" },
                  { label: "New Admissions", value: `+${selectedReport.newAdmissions}`, col: "text-[#22c55e]" },
                  { label: "Withdrawals", value: `-${selectedReport.withdrawals}`, col: "text-[#ef4444]" },
                  { label: "Net Growth", value: `+${selectedReport.netGrowth}`, col: "text-[#22c55e]" },
                ].map((stat, i) => (
                  <div key={i} className="bg-[#f8fafc] border border-slate-100 p-6 rounded-[1.2rem] text-center transition-all hover:bg-white hover:shadow-lg">
                    <p className="text-slate-400 text-[11px] font-bold uppercase tracking-tight mb-3">{stat.label}</p>
                    <h3 className={`text-3xl font-black ${stat.col} tracking-tighter`}>{stat.value}</h3>
                  </div>
                ))}
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12">
                {/* Enrollment by Grade */}
                <div>
                  <h3 className="text-base font-bold text-[#111827] mb-8">Enrollment by Grade</h3>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={selectedReport.enrollmentByGrade} margin={{ left: -10, right: 10 }}>
                        <XAxis dataKey="grade" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} ticks={[0, 100, 200, 300, 400, 500, 600, 700]} />
                        <Tooltip cursor={{ fill: '#f8fafc' }} />
                        <Bar dataKey="enrollment" fill="#1e3a8a" radius={[4, 4, 0, 0]} barSize={32}
                          label={{ position: 'top', fill: '#64748b', fontSize: 10, fontWeight: 'bold' }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Enrollment Trend */}
                <div>
                  <h3 className="text-base font-bold text-[#111827] mb-8">Enrollment Trend</h3>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={selectedReport.enrollmentTrend} margin={{ left: -10, right: 10 }}>
                        <defs>
                          <linearGradient id="colorEnroll" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#1e3a8a" stopOpacity={0.08}/>
                            <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} domain={[0, 5000]} ticks={[0, 1000, 2000, 3000, 4000, 5000]} tickFormatter={(val) => val.toLocaleString()} />
                        <Tooltip />
                        <Area type="monotone" dataKey="enrollment" stroke="#1e3a8a" strokeWidth={3} fill="url(#colorEnroll)" dot={{ r: 5, fill: "#1e3a8a", strokeWidth: 2.5, stroke: "#fff" }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Report Summary */}
              <div className="bg-[#f8fafc] border border-slate-100 p-8 rounded-[1.5rem] mb-6">
                <h4 className="text-base font-bold text-[#111827] mb-4">Report Summary</h4>
                <p className="text-slate-600 text-sm leading-relaxed">
                  {selectedReport.summary} New admissions totaled {selectedReport.newAdmissions} students, while withdrawals accounted for {selectedReport.withdrawals} students. The highest growth was observed in Grades 6-8, indicating strong intake at the middle school level.
                </p>
              </div>
            </div>
          </div>

          {/* Export Options */}
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-10">
            <h3 className="text-xl font-bold text-[#111827] mb-10">Export Options</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[
                { label: "PDF", icon: <FileText className="w-8 h-8" />, col: "text-[#ef4444]" },
                { label: "Excel", icon: <FileSpreadsheet className="w-8 h-8" />, col: "text-[#22c55e]" },
                { label: "CSV", icon: <FileText className="w-8 h-8" />, col: "text-[#3b82f6]" },
                { label: "Email", icon: <Mail className="w-8 h-8" />, col: "text-[#1e3a8a]" },
              ].map((opt, i) => (
                <button key={i} className="bg-[#f8fafc] border border-slate-100 p-8 rounded-[1.5rem] flex flex-col items-center gap-4 transition-all hover:bg-white hover:shadow-lg hover:border-slate-200 cursor-pointer group">
                  <div className={`${opt.col} group-hover:scale-110 transition-transform`}>{opt.icon}</div>
                  <span className="text-sm font-bold text-slate-600">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
