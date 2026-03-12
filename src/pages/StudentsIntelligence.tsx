import {
  studentStats,
  enrollmentTrend,
  gradeDistribution,
  performanceByBranch,
  attendanceByGrade,
  studentsList
} from "@/data/dummyData";
import {
  Users, Search, Plus, Filter, ChevronLeft, ChevronRight,
  MoreVertical, Mail, Phone, ExternalLink, Calendar, BookOpen, AlertCircle, X, ArrowLeft, Clock, AlertTriangle, Heart, Download, TrendingUp, TrendingDown
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useState, useMemo } from "react";

export default function StudentsIntelligence() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");

  const selectedStudent = useMemo(() => {
    if (id) return studentsList.find(s => s.id === id);
    return null;
  }, [id]);

  // STATUS CONFIGURATION - 100% Marks Based
  const getStatusConfig = (score: number) => {
    if (score >= 85) {
      return {
        theme: 'emerald',
        bg: 'bg-emerald-50/50',
        border: 'border-emerald-100',
        text: 'text-emerald-600',
        accent: 'bg-emerald-500',
        hex: '#10b981',
        secondaryHex: '#0ea5e9',
        label: 'Excellent',
        icon: <TrendingUp className="w-4 h-4" />,
        shadow: 'shadow-emerald-500/20'
      };
    } else if (score >= 70) {
      return {
        theme: 'orange',
        bg: 'bg-orange-50/50',
        border: 'border-orange-100',
        text: 'text-orange-600',
        accent: 'bg-orange-500',
        hex: '#f59e0b',
        secondaryHex: '#fbbf24',
        label: 'Stable',
        icon: <TrendingUp className="w-4 h-4 rotate-45" />,
        shadow: 'shadow-orange-500/20'
      };
    } else {
      return {
        theme: 'red',
        bg: 'bg-red-50/50',
        border: 'border-red-100',
        text: 'text-red-600',
        accent: 'bg-red-500',
        hex: '#ef4444',
        secondaryHex: '#f43f5e',
        label: 'High Risk',
        icon: <TrendingDown className="w-4 h-4" />,
        shadow: 'shadow-red-500/20'
      };
    }
  };

  // Dynamic Graph History
  const performanceHistory = useMemo(() => {
    if (!selectedStudent) return [];
    const baseScore = selectedStudent.academicScore;
    const baseAttendance = selectedStudent.attendance;
    const isImproving = baseScore >= 80;
    
    return [
      { month: 'Jun', score: baseScore - (isImproving ? 10 : -7), attendance: baseAttendance - (isImproving ? 8 : -4) },
      { month: 'Jul', score: baseScore - (isImproving ? 8 : -5), attendance: baseAttendance - (isImproving ? 6 : -3) },
      { month: 'Aug', score: baseScore - (isImproving ? 6 : -4), attendance: baseAttendance - (isImproving ? 5 : -2) },
      { month: 'Sep', score: baseScore - (isImproving ? 4 : -2), attendance: baseAttendance - (isImproving ? 3 : -1) },
      { month: 'Oct', score: baseScore - (isImproving ? 2 : -1), attendance: baseAttendance - (isImproving ? 1 : 1) },
      { month: 'Nov', score: baseScore - (isImproving ? 1 : 0), attendance: baseAttendance - (isImproving ? 0 : 2) },
      { month: 'Dec', score: baseScore, attendance: baseAttendance },
    ];
  }, [selectedStudent]);

  const getHeatmapColor = (value: number) => {
    if (value >= 95) return "bg-green-600 text-white";
    if (value >= 85) return "bg-orange-500 text-white";
    return "bg-red-600 text-white";
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">
      {!selectedStudent ? (
        <>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-[#1e294b] tracking-tight">Students Intelligence</h1>
              <p className="text-slate-500 font-medium">Enrollment, performance & behavior analytics</p>
            </div>
            <div className="flex items-center gap-4">
              <Button className="bg-[#1e3a8a] border-none hover:bg-[#152a6a] text-white font-bold h-11 rounded-xl px-6 shadow-lg shadow-blue-900/15 flex items-center gap-2">
                <Plus className="w-5 h-5" />
                Add Student
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { label: "Total Enrollment", value: "4,286", change: "+124 this term", color: "text-green-500" },
              { label: "Average Attendance", value: "91.8%", change: "+0.5% vs last month", color: "text-green-500" },
              { label: "At-Risk Students", value: "186", change: "4.3% of total", color: "text-red-500" },
              { label: "High Performers", value: "892", change: "20.8% of total", color: "text-green-500" },
            ].map((stat, i) => (
              <div key={i} className="bg-white p-7 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md transition-all">
                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2">{stat.label}</p>
                <h3 className="text-4xl font-extrabold text-[#1e294b] tracking-tighter mb-2">{stat.value}</h3>
                <p className={`text-[11px] font-bold ${stat.color}`}>{stat.change}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
              <h3 className="text-lg font-bold text-[#1e294b] mb-6">Grade Distribution</h3>
              <div className="h-[280px] relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={gradeDistribution} cx="50%" cy="50%" innerRadius={0} outerRadius={100} dataKey="value" stroke="#fff" strokeWidth={2} label={({ name, midAngle, cx, cy, radius, outerRadius }) => { const RADIAN = Math.PI / 180; const x = cx + (outerRadius + 20) * Math.cos(-midAngle * RADIAN); const y = cy + (outerRadius + 20) * Math.sin(-midAngle * RADIAN); return ( <text x={x} y={y} fill="#94a3b8" fontSize={10} fontWeight="bold" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central"> {name} </text> ); }}>
                      {gradeDistribution.map((entry, index) => ( <Cell key={`cell-${index}`} fill={entry.fill} /> ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
              <h3 className="text-lg font-bold text-[#1e294b] mb-6">Enrollment Trend</h3>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={enrollmentTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="enrollGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1e3a8a" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} domain={[0, 5000]} ticks={[0, 1000, 2000, 3000, 4000, 5000]} />
                    <Tooltip />
                    <Area type="monotone" dataKey="value" stroke="#1e3a8a" strokeWidth={3} fill="url(#enrollGradient)" dot={{ r: 4, fill: "#1e3a8a", strokeWidth: 2, stroke: "#fff" }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
              <h3 className="text-lg font-bold text-[#1e294b] mb-6">Performance by Branch</h3>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={performanceByBranch} layout="vertical" margin={{ left: -10, right: 50, bottom: 10, top: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                    <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 'bold' }} ticks={[0, 20, 40, 60, 80, 100]} dy={10} />
                    <YAxis dataKey="branch" type="category" axisLine={{ stroke: '#cbd5e1', strokeWidth: 1.5 }} tickLine={{ stroke: '#cbd5e1', strokeWidth: 1.5 }} tick={{ fill: '#64748b', fontSize: 12, fontWeight: 'bold' }} width={80} dx={-5} />
                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={28} label={{ position: 'right', fill: '#64748b', fontSize: 12, fontWeight: '700', formatter: (v: any) => ` ${v}%` }}>
                      {performanceByBranch.map((entry, index) => ( <Cell key={`cell-${index}`} fill={entry.value >= 85 ? '#16a34a' : '#f59e0b'} /> ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm overflow-x-auto">
            <div className="flex items-center justify-between mb-8 min-w-[800px]">
              <h3 className="text-lg font-bold text-[#1e294b]">Attendance Heatmap</h3>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2"> <div className="w-2.5 h-2.5 rounded-full bg-green-600"></div> <span className="text-xs font-bold text-[#1e294b]">95%+</span> </div>
                <div className="flex items-center gap-2"> <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div> <span className="text-xs font-bold text-[#1e294b]">85-94%</span> </div>
                <div className="flex items-center gap-2"> <div className="w-2.5 h-2.5 rounded-full bg-red-600"></div> <span className="text-xs font-bold text-[#1e294b]">&lt;85%</span> </div>
              </div>
            </div>
            <div className="min-w-[800px]">
              <div className="grid grid-cols-7 gap-4">
                <div className="col-span-1"></div>
                {['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11'].map(grade => ( <div key={grade} className="text-center font-bold text-slate-400 text-[10px] uppercase tracking-wider mb-2">{grade}</div> ))}
                <div className="flex flex-col gap-2 justify-center">
                  {['Main Campus', 'North Branch', 'South Branch'].map(branch => ( <div key={branch} className="text-[10px] font-bold text-slate-400 flex items-center justify-end gap-2 pr-4 h-12 uppercase tracking-tight">{branch}</div> ))}
                </div>
                <div className="col-span-6 grid grid-cols-6 gap-2">
                  {attendanceByGrade.main.map((item, idx) => ( <div key={`main-${idx}`} className={`h-12 rounded-xl flex items-center justify-center font-bold text-sm text-white ${getHeatmapColor(item.attendance)} transition-transform hover:scale-105 cursor-default`}> {item.attendance}% </div> ))}
                  {attendanceByGrade.north.map((item, idx) => ( <div key={`north-${idx}`} className={`h-12 rounded-xl flex items-center justify-center font-bold text-sm text-white ${getHeatmapColor(item.attendance)} transition-transform hover:scale-105 cursor-default`}> {item.attendance}% </div> ))}
                  {attendanceByGrade.south.map((item, idx) => ( <div key={`south-${idx}`} className={`h-12 rounded-xl flex items-center justify-center font-bold text-sm text-white ${getHeatmapColor(item.attendance)} transition-transform hover:scale-105 cursor-default`}> {item.attendance}% </div> ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden mb-10">
            <div className="p-8 border-b border-slate-50 bg-[#f8fafc]/30 flex items-center justify-between">
                <h3 className="text-lg font-extrabold text-[#1e294b]">Student Roster</h3>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input className="pl-10 h-10 w-64 border-slate-100 bg-white rounded-xl text-xs font-bold" placeholder="Quick search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                  </div>
                  <Button variant="outline" className="h-10 rounded-xl border-slate-100 text-slate-400 font-bold px-4"> <Filter className="w-4 h-4" /> </Button>
                </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[1000px]">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-8 py-5 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Student Details</th>
                    <th className="px-8 py-5 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Branch / Grade</th>
                    <th className="px-8 py-5 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Attendance</th>
                    <th className="px-8 py-5 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Academic</th>
                    <th className="px-8 py-5 text-right text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Risk Level</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {studentsList.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase())).map((s) => {
                    const cfg = getStatusConfig(s.academicScore);
                    return (
                    <tr key={s.id} className="hover:bg-slate-50/50 transition-all cursor-pointer group" onClick={() => navigate(`/students/${s.id}`)}>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-4">
                          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-extrabold text-xs text-white shadow-lg ${cfg.shadow} ${cfg.accent} group-hover:scale-110 transition-transform`}> {getInitials(s.name)} </div>
                          <div>
                            <p className="font-extrabold text-[#1e294b] text-sm group-hover:text-blue-600 transition-colors uppercase tracking-tight">{s.name}</p>
                            <p className="text-[10px] text-slate-400 font-bold">ID: {s.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6"> <div className="flex flex-col"> <span className="text-[11px] font-extrabold text-slate-600 uppercase tracking-tight">{s.grade}</span> <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{s.branch}</span> </div> </td>
                      <td className="px-8 py-6 font-extrabold text-[#1e294b] text-sm">{s.attendance}%</td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-4">
                            <div className="flex-1 h-2 w-24 bg-slate-100 rounded-full overflow-hidden shadow-inner"> <div className={`h-full ${cfg.accent} rounded-full`} style={{ width: `${s.academicScore}%` }}></div> </div>
                            <span className="text-[11px] font-extrabold text-slate-700">{s.academicScore}%</span>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <span className={`px-4 py-1.5 rounded-full text-[10px] font-extrabold uppercase tracking-widest border ${cfg.bg} ${cfg.text} ${cfg.border} shadow-sm group-hover:shadow-md transition-all`}>
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-[3.5rem] border border-slate-100 shadow-2xl overflow-hidden animate-in slide-in-from-bottom-10 duration-700 pb-16">
          <div className="p-10 lg:p-16">
            {/* Header Section */}
            {(() => {
              const cfg = getStatusConfig(selectedStudent.academicScore);
              return (
              <>
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-12 mb-16">
                  <div className="flex items-center gap-10">
                    <div className={`w-24 h-24 lg:w-28 lg:h-28 rounded-full ${cfg.accent} flex items-center justify-center text-white font-extrabold text-4xl shadow-2xl ${cfg.shadow} transition-all border-8 border-white`}>
                      {getInitials(selectedStudent.name)}
                    </div>
                    <div>
                      <h2 className="text-4xl lg:text-5xl font-extrabold text-[#1e294b] tracking-tighter mb-3">{selectedStudent.name}</h2>
                      <p className="text-slate-500 font-bold text-lg tracking-tight opacity-80 uppercase text-[12px]">
                        {selectedStudent.grade} <span className="mx-4 text-slate-200">|</span> {selectedStudent.branch} <span className="mx-4 text-slate-200">|</span> <span className="text-slate-400">ID: {selectedStudent.id}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-5">
                    <span className={`${cfg.accent} text-white text-[11px] font-extrabold px-8 py-3 rounded-full shadow-2xl ${cfg.shadow} flex items-center gap-3 uppercase tracking-[0.1em]`}>
                      {cfg.icon} {cfg.label}
                    </span>
                    <Button className="bg-[#1e3a8a] border-none hover:bg-[#152a6a] text-white font-extrabold h-12 px-10 rounded-2xl shadow-2xl shadow-blue-900/30 uppercase text-[11px] tracking-widest">
                      Contact Parent
                    </Button>
                    <button onClick={() => navigate('/students')} className="p-4 rounded-2xl bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-800 transition-all border border-slate-100 shadow-sm">
                      <X className="w-7 h-7" />
                    </button>
                  </div>
                </div>

                {/* Stats Cards Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-20">
                  <div className={`${cfg.bg} p-12 rounded-[3.5rem] border ${cfg.border} shadow-sm transition-all hover:translate-y-[-4px] duration-500`}>
                    <p className="text-slate-500 text-[11px] font-bold mb-8 uppercase tracking-[0.25em] opacity-60">Attendance (Last 30 Days)</p>
                    <h3 className={`text-6xl font-extrabold ${cfg.text} tracking-tighter mb-4`}>{selectedStudent.attendance}%</h3>
                    <p className={`${cfg.text} text-xs font-extrabold leading-tight flex items-center gap-2 uppercase tracking-tight`}>
                      {selectedStudent.academicScore >= 80 ? '↑ 5%' : '↓ 12%'} <span className="opacity-50 font-bold">vs Prev Month</span>
                    </p>
                  </div>

                  <div className={`${cfg.bg} p-12 rounded-[3.5rem] border ${cfg.border} shadow-sm transition-all hover:translate-y-[-4px] duration-500`}>
                    <p className="text-slate-500 text-[11px] font-bold mb-8 uppercase tracking-[0.25em] opacity-60">Academic Score</p>
                    <h3 className={`text-6xl font-extrabold ${cfg.text} tracking-tighter mb-4`}>{selectedStudent.academicScore}/100</h3>
                    <p className={`${cfg.text} text-xs font-extrabold leading-tight flex items-center gap-2 uppercase tracking-tight`}>
                      {selectedStudent.academicScore >= 80 ? '↑ 10 pts' : '↓ 8 pts'} <span className="opacity-50 font-bold">on Average</span>
                    </p>
                  </div>

                  <div className={`${cfg.bg} p-12 rounded-[3.5rem] border ${cfg.border} shadow-sm transition-all hover:translate-y-[-4px] duration-500`}>
                    <p className="text-slate-500 text-[11px] font-bold mb-8 uppercase tracking-[0.25em] opacity-60">Behavior Incidents</p>
                    <h3 className={`text-6xl font-extrabold ${cfg.text} tracking-tighter mb-4`}>
                      {selectedStudent.academicScore >= 85 ? '0' : selectedStudent.academicScore >= 70 ? '1' : '4'}
                    </h3>
                    <p className={`${cfg.text} text-[11px] font-black leading-tight uppercase tracking-[0.25em] opacity-80`}>
                      STATUS: CLEAN
                    </p>
                  </div>
                </div>

                {/* Performance Trend Chart */}
                <div className="bg-slate-50/30 p-10 rounded-[4rem] border border-slate-50 shadow-inner">
                  <h3 className="text-2xl font-black text-[#1e294b] mb-16 pl-6 uppercase tracking-[0.15em] opacity-90">Performance Evolution</h3>
                  <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={performanceHistory} margin={{ top: 20, right: 40, left: 10, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="5 5" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 14, fontWeight: 800 }} dy={20} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 14, fontWeight: 800 }} domain={[selectedStudent.academicScore >= 70 ? 60 : 40, 100]} dx={-15} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '32px', border: 'none', boxShadow: '0 30px 60px -12px rgba(0,0,0,0.2)', padding: '25px', background: '#fff' }} 
                          labelStyle={{ fontWeight: 900, color: '#1e294b', marginBottom: '12px', fontSize: '16px', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                        />
                        <Line type="monotone" dataKey="score" stroke={cfg.hex} strokeWidth={5} dot={{ r: 8, fill: cfg.hex, strokeWidth: 4, stroke: "#fff" }} activeDot={{ r: 12, strokeWidth: 0 }} />
                        <Line type="monotone" dataKey="attendance" stroke={cfg.secondaryHex} strokeWidth={5} strokeDasharray="8 8" opacity={0.5} dot={{ r: 8, fill: cfg.secondaryHex, strokeWidth: 4, stroke: "#fff" }} activeDot={{ r: 12, strokeWidth: 0 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
