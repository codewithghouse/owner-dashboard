import { alertDetail } from "@/data/dummyData";
import { ArrowLeft, AlertTriangle, GraduationCap, CheckCircle2, Clock, Calendar, MapPin, User, ChevronRight, Circle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Button } from "@/components/ui/button";

export default function AlertDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const a = alertDetail;

  return (
    <div className="space-y-8 max-w-[1400px] mx-auto animate-in fade-in duration-500 pb-16">
      {/* Header Section */}
      <div className="bg-white rounded-[2rem] border border-slate-100 p-8 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="flex items-start gap-6">
            <div className="w-16 h-16 rounded-2xl bg-[#ef4444] flex items-center justify-center text-white shrink-0 shadow-lg shadow-rose-900/10">
              <GraduationCap className="w-8 h-8" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-2xl lg:text-3xl font-black text-[#1e294b] tracking-tight">{a.title}</h1>
                <span className="px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest bg-[#ef4444] text-white">Critical</span>
                <div className="px-3 py-1 rounded-md border border-slate-100 bg-slate-50 text-slate-400 text-[9px] font-bold">Alert #RA-2025-0142</div>
              </div>
              <div className="flex items-center gap-4 text-slate-400 text-[11px] font-bold">
                <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Detected on {a.detectedOn}</span>
                <span className="text-slate-200">|</span>
                <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {a.branch}</span>
                <span className="text-slate-200">|</span>
                <span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> {a.grade}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <Button variant="outline" className="h-11 px-6 rounded-xl border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">Acknowledge</Button>
             <Button className="h-11 px-6 rounded-xl bg-[#1e3a8a] text-white text-xs font-bold hover:bg-blue-900 shadow-lg shadow-blue-900/10">Assign</Button>
             <Button className="h-11 px-6 rounded-xl bg-[#10b981] text-white text-xs font-bold hover:bg-emerald-600 shadow-lg shadow-emerald-900/10">Resolve</Button>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: "Current Attendance", value: "78%", note: "↓ 12% from baseline (90%)", color: "text-rose-500" },
          { label: "Students Affected", value: "42", note: "Out of 48 total", color: "text-[#111827]" },
          { label: "Duration", value: "5 days", note: "Since Jan 10, 2025", color: "text-[#111827]" },
        ].map((m, i) => (
          <div key={i} className="bg-[#fef2f2]/50 border border-rose-100 p-8 rounded-[1.5rem] transition-all hover:bg-white hover:shadow-lg">
             <p className="text-slate-400 text-[11px] font-bold uppercase tracking-tight mb-4">{m.label}</p>
             <h3 className={`text-4xl font-black ${m.color} tracking-tighter mb-2`}>{m.value}</h3>
             <p className="text-[#ef4444] text-[11px] font-bold">{m.note}</p>
          </div>
        ))}
      </div>

      {/* Issue Description */}
      <div className="bg-white rounded-[1.5rem] border border-slate-100 p-8">
         <h4 className="text-lg font-bold text-[#1e294b] mb-4">Issue Description</h4>
         <p className="text-slate-600 text-sm leading-relaxed max-w-4xl">
           Significant attendance decline detected in Grade 8 at North Branch. Pattern analysis shows consistent drop across all sections, with Monday and Friday showing highest absence rates. Preliminary investigation suggests transportation issues and seasonal illness as potential causes.
         </p>
      </div>

      {/* Middle Section: Chart & List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Trend Chart */}
        <div className="lg:col-span-7 bg-white p-8 rounded-[1.5rem] border border-slate-100">
          <h4 className="text-base font-bold text-[#1e294b] mb-12">Attendance Trend</h4>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={a.attendanceTrend} margin={{ left: -20, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} dy={10} />
                <YAxis domain={[70, 95]} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} ticks={[70, 75, 80, 85, 90, 95]} />
                <Tooltip />
                <ReferenceLine y={90} stroke="#10b981" strokeDasharray="5 5" label={{ value: 'Baseline', position: 'right', fill: '#10b981', fontSize: 10, fontWeight: 'bold' }} />
                <Line type="monotone" dataKey="attendance" stroke="#ef4444" strokeWidth={3} dot={{ r: 4, fill: "#ef4444", strokeWidth: 1.5, stroke: "#fff" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Affected Students */}
        <div className="lg:col-span-5 bg-white p-8 rounded-[1.5rem] border border-slate-100">
           <h4 className="text-base font-bold text-[#1e294b] mb-8">Affected Students</h4>
           <div className="space-y-3">
             {a.affectedStudents.map((s, idx) => (
               <div key={idx} className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50/50 hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                 <div className="flex items-center gap-4">
                   <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-[11px] font-black ${idx % 2 === 0 ? 'bg-[#ef4444]' : 'bg-[#f59e0b]'}`}>
                     {s.initials}
                   </div>
                   <span className="text-sm font-bold text-[#1e294b]">{s.name}</span>
                 </div>
                 <span className={`text-sm font-black ${idx % 2 === 0 ? 'text-[#ef4444]' : 'text-[#f59e0b]'}`}>{s.attendance}</span>
               </div>
             ))}
           </div>
        </div>
      </div>

      {/* Bottom Row: Actions & Recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recommended Actions */}
        <div className="bg-white p-10 rounded-[2rem] border border-slate-100 shadow-sm">
           <h4 className="text-lg font-bold text-[#1e294b] mb-10">Recommended Actions</h4>
           <div className="space-y-6">
              {[
                { title: "Contact parents of students with <70% attendance", sub: "Priority: High • Estimated time: 2 hours", done: true },
                { title: "Investigate transportation issues with bus coordinator", sub: "Priority: High • Estimated time: 1 hour", done: true },
                { title: "Schedule parent-teacher meeting for affected students", sub: "Priority: Medium • Estimated time: 3 hours", done: false },
              ].map((action, i) => (
                <div key={i} className="flex items-start gap-5 group">
                  <div className={`mt-1 shrink-0 ${action.done ? 'text-[#10b981]' : 'text-slate-300'}`}>
                    {action.done ? <CheckCircle2 className="w-6 h-6 fill-emerald-50" /> : <Circle className="w-6 h-6" />}
                  </div>
                  <div className="flex-1 pb-6 border-b border-slate-50 group-last:border-none">
                     <p className={`text-[15px] font-bold leading-none mb-2 ${action.done ? 'text-slate-800' : 'text-slate-500'}`}>{action.title}</p>
                     <p className="text-slate-400 text-[11px] font-medium tracking-tight uppercase">{action.sub}</p>
                  </div>
                </div>
              ))}
           </div>
        </div>

        {/* Similar Historical Alerts */}
        <div className="bg-white p-10 rounded-[2rem] border border-slate-100 shadow-sm">
           <h4 className="text-lg font-bold text-[#1e294b] mb-10">Similar Historical Alerts</h4>
           <div className="space-y-4">
              {[
                { title: "Grade 7 Attendance Drop", sub: "Nov 2024 • North Branch • Resolved in 8 days" },
                { title: "Grade 9 Absenteeism", sub: "Sep 2024 • Main Campus • Resolved in 5 days" },
              ].map((h, i) => (
                <div key={i} className="p-6 rounded-2xl bg-slate-50/50 border border-slate-100 flex items-center justify-between hover:bg-slate-50 transition-all cursor-pointer">
                  <div>
                    <h5 className="text-[15px] font-bold text-[#1e294b] mb-1.5">{h.title}</h5>
                    <p className="text-slate-400 text-xs font-medium">{h.sub}</p>
                  </div>
                  <span className="px-4 py-1.5 rounded-lg bg-[#dcfce7] text-[#10b981] text-[10px] font-black uppercase tracking-widest">Resolved</span>
                </div>
              ))}
           </div>
        </div>
      </div>
    </div>
  );
}
