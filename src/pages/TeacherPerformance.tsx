import {
  teacherStats,
  performanceDistribution,
  performanceVsAttendance,
  teachersList,
  subjectRatings,
  topTeachers,
  teacherProfile
} from "@/data/dummyData";
import {
  Search, Filter, ArrowLeft, Star, Mail, Calendar, BookOpen, Clock, Users,
  ChevronRight, TrendingUp, TrendingDown, MoreVertical, GraduationCap, X, CheckCircle2, Award
} from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, Legend, AreaChart, Area
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useMemo } from "react";

const branchComparisonData = [
  { category: "Teaching", teacher: 94, branchAvg: 78 },
  { category: "Feedback", teacher: 96, branchAvg: 82 },
  { category: "Attendance", teacher: 98, branchAvg: 85 },
  { category: "Results", teacher: 92, branchAvg: 76 },
  { category: "Growth", teacher: 95, branchAvg: 80 },
];

export default function TeacherPerformance() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("Overview");

  const selectedTeacher = useMemo(() => {
    if (id) return teachersList.find(t => t.id === id);
    return null;
  }, [id]);

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n.replace('.', ''))[0][0] + (name.split(' ').length > 1 ? name.split(' ')[name.split(' ').length - 1][0] : '');
  };

  const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value, name, fill }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = outerRadius + 30;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <g>
        <path d={`M${cx + outerRadius * Math.cos(-midAngle * RADIAN)},${cy + outerRadius * Math.sin(-midAngle * RADIAN)}L${x},${y}`} stroke={fill} fill="none" />
        <text x={x + (x > cx ? 10 : -10)} y={y} fill="#64748b" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" className="text-[10px] font-bold uppercase tracking-tighter">
          {name}
        </text>
      </g>
    );
  };

  return (
    <div className="space-y-10 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">
      {!selectedTeacher ? (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-extrabold text-[#111827] tracking-tight">Teacher Performance</h1>
            <p className="text-slate-400 font-medium text-sm">Effectiveness metrics & evaluation analytics</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { label: "Teacher Effectiveness Index", value: "84.6", change: "+1.2 vs last term", color: "text-emerald-500" },
              { label: "Total Teachers", value: "186", change: "+8 new hires", color: "text-emerald-500" },
              { label: "Top Performers", value: "42", change: "22.6% of staff", color: "text-emerald-500" },
              { label: "Needs Improvement", value: "18", change: "9.7% of staff", color: "text-amber-400" },
            ].map((stat, i) => (
              <div key={i} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm transition-all hover:shadow-md">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-tight mb-4">{stat.label}</p>
                <h3 className="text-4xl font-extrabold text-[#111827] tracking-tighter mb-2">{stat.value}</h3>
                <p className={`text-[11px] font-bold ${stat.color}`}>{stat.change}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
              <h3 className="text-lg font-bold text-[#111827] mb-6">Performance Distribution</h3>
              <div className="h-[300px] relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={performanceDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={4} dataKey="value" label={renderCustomizedLabel}>
                      {performanceDistribution.map((entry, index) => ( <Cell key={`cell-${index}`} fill={entry.fill} stroke="none" /> ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
              <h3 className="text-lg font-bold text-[#111827] mb-10">Subject-wise Ratings</h3>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={subjectRatings} layout="vertical" margin={{ left: -10, right: 40, bottom: 5 }}>
                    <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} />
                    <YAxis dataKey="subject" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11, fontWeight: 'bold' }} width={80} />
                    <Tooltip cursor={{ fill: '#f8fafc' }} />
                    <Bar dataKey="rating" fill="#1e3a8a" radius={[0, 4, 4, 0]} barSize={14} label={{ position: 'right', fill: '#64748b', fontSize: 11, fontWeight: '700', dx: 5 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
              <h3 className="text-lg font-bold text-[#111827] mb-8">Top Performers</h3>
              <div className="space-y-6">
                {topTeachers.map((teacher, idx) => (
                  <div key={idx} className="flex items-center justify-between group cursor-pointer hover:translate-x-1 transition-transform" onClick={() => navigate(`/teachers/${teacher.id || 'TCH-2018-0042'}`)}>
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${idx < 3 ? 'bg-emerald-500' : 'bg-amber-400'}`}>{idx + 1}</div>
                      <div>
                        <p className="font-extrabold text-[#111827] text-sm tracking-tight">{teacher.name}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{teacher.subject} <span className="mx-1">•</span> {teacher.branch}</p>
                      </div>
                    </div>
                    <span className="text-emerald-500 font-black text-sm">{teacher.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
            <h3 className="text-lg font-bold text-[#111827] mb-12">Performance vs Attendance Correlation</h3>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={performanceVsAttendance} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 'bold' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 'bold' }} domain={[0, 100]} />
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  <Line type="monotone" dataKey="performance" name="Performance" stroke="#1e3a8a" strokeWidth={3} dot={{ r: 5, fill: "#1e3a8a", strokeWidth: 2, stroke: "#fff" }} />
                  <Line type="monotone" dataKey="attendance" name="Attendance" stroke="#22c55e" strokeWidth={3} dot={{ r: 5, fill: "#22c55e", strokeWidth: 2, stroke: "#fff" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : (
        <div className="animate-in fade-in duration-700 space-y-8">
          {/* Main Content Card - Exactly as Step 179 Image */}
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl overflow-hidden">
            <div className="p-8 lg:p-12">
              {/* Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
                <div className="flex items-center gap-6">
                  <div className="w-20 h-20 rounded-full bg-[#1e293b] flex items-center justify-center text-white font-bold text-2xl shadow-lg border-4 border-white overflow-hidden">
                    <div className="w-full h-full flex items-center justify-center bg-[#1e3a8a]">
                      {getInitials(selectedTeacher.name)}
                    </div>
                  </div>
                  <div>
                    <h2 className="text-2xl lg:text-3xl font-bold text-[#1e294b] tracking-tight">{selectedTeacher.name}</h2>
                    <p className="text-slate-500 font-medium text-sm mt-1">
                      Senior {selectedTeacher.subject} Teacher • {selectedTeacher.branch} • ID: {selectedTeacher.id}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="bg-[#22c55e] text-white text-[11px] font-bold px-6 py-2 rounded-full shadow-lg h-9 flex items-center">
                    Excellent
                  </span>
                  <Button className="bg-[#1e3a8a] hover:bg-[#152a6a] text-white font-bold h-10 px-6 rounded-xl shadow-lg shadow-blue-900/15">
                    Schedule Review
                  </Button>
                  <button onClick={() => navigate('/teachers')} className="p-2.5 rounded-xl bg-slate-50 text-slate-400 hover:bg-slate-100 transition-all border border-slate-100">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-3 mb-10">
                 {["Overview", "Classes", "Feedback", "History"].map(tab => (
                   <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-8 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      activeTab === tab ? "bg-[#1e3a8a] text-white shadow-lg" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                    }`}
                   >
                     {tab}
                   </button>
                 ))}
              </div>

              {/* Stats Cards Row */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
                {[
                  { label: "Effectiveness Score", value: "96.2", note: "Top 1% school-wide" },
                  { label: "Student Feedback", value: "4.8/5.0", note: "Based on 234 reviews" },
                  { label: "Class Attendance", value: "98.5%", note: "Average across classes" },
                  { label: "Students Taught", value: "312", note: "This academic year" },
                ].map((stat, i) => (
                  <div key={i} className="bg-[#f0fdf4] p-8 rounded-[1.5rem] border border-emerald-100/50">
                    <p className="text-[#059669]/60 text-[11px] font-bold uppercase tracking-wider mb-4">{stat.label}</p>
                    <h3 className="text-4xl font-extrabold text-[#059669] tracking-tighter mb-2">{stat.value}</h3>
                    <p className="text-[#059669]/80 text-[11px] font-bold">{stat.note}</p>
                  </div>
                ))}
              </div>

              {/* Performance Timeline & vs Branch */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-10">
                <div>
                   <h3 className="text-lg font-bold text-[#1e294b] mb-10">Performance Timeline</h3>
                   <div className="h-[250px] w-full">
                     <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={teacherProfile.performanceTimeline} margin={{ left: -20, right: 10 }}>
                          <defs>
                            <linearGradient id="timelineGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} domain={[85, 100]} ticks={[87, 90, 93, 96, 99]} />
                          <Tooltip />
                          <Area type="monotone" dataKey="score" stroke="#10b981" strokeWidth={3} fill="url(#timelineGrad)" dot={{ r: 4, fill: "#10b981", strokeWidth: 2, stroke: "#fff" }} />
                        </AreaChart>
                     </ResponsiveContainer>
                   </div>
                </div>

                <div>
                   <h3 className="text-lg font-bold text-[#1e294b] mb-10">vs Branch Average</h3>
                   <div className="h-[250px] w-full">
                     <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={branchComparisonData} margin={{ left: -20, right: 10, bottom: 20 }}>
                          <XAxis dataKey="category" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} />
                          <Tooltip cursor={{ fill: 'transparent' }} />
                          <Legend verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '11px', fontWeight: 'bold' }} />
                          <Bar dataKey="teacher" name="Teacher" fill="#1db45a" radius={[4, 4, 0, 0]} barSize={25} />
                          <Bar dataKey="branchAvg" name="Branch Avg" fill="#94a3b8" radius={[4, 4, 0, 0]} barSize={25} opacity={0.6} />
                        </BarChart>
                     </ResponsiveContainer>
                   </div>
                </div>
              </div>
            </div>
          </div>

          {/* Current Classes Section - As in image */}
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-8 lg:p-12">
            <h3 className="text-xl font-bold text-[#1e294b] mb-10">Current Classes</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { name: "Grade 9 - A", students: 32, schedule: "Mon-Fri 9:00 AM", score: "89%", att: "97%" },
                { name: "Grade 10 - B", students: 28, schedule: "Mon-Fri 10:30 AM", score: "92%", att: "99%" },
                { name: "Grade 11 - A", students: 24, schedule: "Mon-Fri 1:00 PM", score: "94%", att: "100%" },
              ].map((cls, idx) => (
                <div key={idx} className="bg-[#f8fafc]/50 p-8 rounded-[1.5rem] border border-slate-100 transition-all hover:bg-white hover:shadow-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-lg font-bold text-[#1e294b]">{cls.name}</h4>
                    <span className="bg-[#22c55e] text-white text-[10px] font-bold px-4 py-1 rounded-lg">Active</span>
                  </div>
                  <p className="text-slate-400 font-bold text-[11px] mb-8 uppercase tracking-tight">{cls.students} students • {cls.schedule}</p>
                  <div className="flex items-center gap-6">
                    <span className="text-[#22c55e] font-black text-sm">Avg: {cls.score}</span>
                    <span className="text-[#22c55e] font-black text-sm">Att: {cls.att}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
