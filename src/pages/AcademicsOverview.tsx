import {
  academicsStats,
  gradePerformanceMatrix,
  subjectPerformance,
  examDistribution,
  learningOutcomeTrends,
  subjectsList,
  subjectDetailsData
} from "@/data/dummyData";
import {
  TrendingUp, Award, BarChart3, BookOpen, Calculator, Search, Filter,
  ArrowLeft, Brain, BookMarked, MessageSquare, AlertTriangle, CheckCircle, X, ChevronRight, MoreVertical
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, Cell, ScatterChart, Scatter, ZAxis, AreaChart, Area
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useState, useMemo } from "react";

export default function AcademicsOverview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab ] = useState("Performance");

  // Heatmap Color Scale Implementation
  const getMatrixColor = (value: number) => {
    if (value >= 95) return "#bef264"; // lime-300
    if (value >= 90) return "#d9f99d"; // lime-200
    if (value >= 85) return "#fef08a"; // yellow-200
    if (value >= 80) return "#fed7aa"; // orange-200
    return "#fecaca"; // red-200
  };

  const selectedSubject = useMemo(() => {
    if (id) return subjectDetailsData[id as keyof typeof subjectDetailsData] || subjectDetailsData.math;
    return null;
  }, [id]);

  return (
    <div className="space-y-10 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">
      {!selectedSubject ? (
        <>
          {/* Header */}
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-extrabold text-[#111827] tracking-tight">Academics Overview</h1>
            <p className="text-slate-400 font-medium text-sm">Grade-wise performance & learning outcomes</p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { label: "Overall Pass Rate", value: "94.2%", change: "+1.8% vs last year" },
              { label: "Average GPA", value: "3.42", change: "+0.15 improvement" },
              { label: "Distinction Rate", value: "28.6%", change: "+3.2% increase" },
              { label: "Curriculum Coverage", value: "87.4%", change: "On track", isStatus: true },
            ].map((stat, i) => (
              <div key={i} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm transition-all hover:shadow-md">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-tight mb-4">{stat.label}</p>
                <h3 className="text-4xl font-extrabold text-[#111827] tracking-tighter mb-2">{stat.value}</h3>
                <p className={`text-[11px] font-bold ${stat.isStatus ? 'text-amber-500' : 'text-emerald-500'}`}>{stat.change}</p>
              </div>
            ))}
          </div>

          {/* Performance Matrix & Subject Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm overflow-hidden">
               <h3 className="text-lg font-bold text-[#111827] mb-8">Grade-wise Performance Matrix</h3>
               <div className="overflow-x-auto">
                 <div className="min-w-[500px]">
                    <div className="grid grid-cols-8 gap-1">
                       <div className="col-span-1 h-10"></div>
                       {["G6", "G7", "G8", "G9", "G10", "G11", "G12"].map(g => (
                         <div key={g} className="h-10 flex items-center justify-center text-[11px] font-bold text-slate-400 uppercase">{g}</div>
                       ))}
                       
                       {gradePerformanceMatrix.map((row: any) => (
                         <div key={row.subject} className="contents">
                            <div className="col-span-1 flex items-center justify-end pr-4 text-[11px] font-bold text-slate-500 uppercase">{row.subject}</div>
                            {["G6", "G7", "G8", "G9", "G10", "G11", "G12"].map(g => (
                              <div 
                                key={g} 
                                className="h-12 w-full flex items-center justify-center text-[10px] font-bold transition-all hover:scale-105 cursor-pointer shadow-sm rounded-sm"
                                style={{ backgroundColor: getMatrixColor(row[g]), color: '#1e293b' }}
                                onClick={() => navigate(`/academics/${row.subject.toLowerCase()}`)}
                              >
                                {row[g]}
                              </div>
                            ))}
                         </div>
                       ))}
                    </div>
                    {/* Color Scale Bar */}
                    <div className="mt-8 flex flex-col items-center">
                       <div className="flex items-center gap-4 text-[10px] font-bold text-slate-400 mb-2">
                          <span>60</span>
                          <div className="w-48 h-3 rounded-full bg-gradient-to-r from-red-200 via-orange-200 via-yellow-200 to-lime-300"></div>
                          <span>100</span>
                       </div>
                    </div>
                 </div>
               </div>
            </div>

            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
               <h3 className="text-lg font-bold text-[#111827] mb-12">Subject Performance Comparison</h3>
               <div className="h-[320px]">
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={subjectPerformance} margin={{ top: 0, bottom: 20 }}>
                       <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                       <XAxis dataKey="subject" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                       <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} domain={[0, 100]} />
                       <Tooltip cursor={{ fill: 'transparent' }} />
                       <Legend verticalAlign="bottom" iconType="rect" wrapperStyle={{ paddingTop: '20px', fontSize: '11px', fontWeight: 'bold' }} />
                       <Bar dataKey="main" name="Main" fill="#1e3a8a" radius={[2, 2, 0, 0]} barSize={20} />
                       <Bar dataKey="north" name="North" fill="#3b82f6" radius={[2, 2, 0, 0]} barSize={20} />
                       <Bar dataKey="south" name="South" fill="#93c5fd" radius={[2, 2, 0, 0]} barSize={20} />
                    </BarChart>
                 </ResponsiveContainer>
               </div>
            </div>
          </div>

          {/* Bottom Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
               <h3 className="text-lg font-bold text-[#111827] mb-12">Exam Results Distribution</h3>
               <div className="h-[300px]">
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={examDistribution} margin={{ bottom: 10 }}>
                       <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                       <XAxis dataKey="range" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                       <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} />
                       <Tooltip />
                       <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={34}>
                         {examDistribution.map((entry, index) => {
                           const colors = ['#10b981', '#10b981', '#3b82f6', '#1d4ed8', '#f59e0b', '#f97316', '#ef4444'];
                           return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                         })}
                       </Bar>
                    </BarChart>
                 </ResponsiveContainer>
               </div>
            </div>

            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
               <h3 className="text-lg font-bold text-[#111827] mb-12">Learning Outcome Trends</h3>
               <div className="h-[300px]">
                 <ResponsiveContainer width="100%" height="100%">
                    <LineChart 
                      data={[
                        { q: 'Q1', knowledge: 82, skills: 78, application: 75 },
                        { q: 'Q2', knowledge: 84, skills: 81, application: 77 },
                        { q: 'Q3', knowledge: 86, skills: 84, application: 80 },
                        { q: 'Q4', knowledge: 89, skills: 87, application: 83 },
                      ]} 
                      margin={{ top: 5, right: 30, left: -10, bottom: 20 }}
                    >
                       <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                       <XAxis 
                          dataKey="q" 
                          axisLine={{ stroke: '#94a3b8', strokeWidth: 1 }} 
                          tickLine={{ stroke: '#94a3b8' }} 
                          tick={{ fill: '#94a3b8', fontSize: 13, fontWeight: '800' }} 
                          dy={15} 
                       />
                       <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 13, fontWeight: '800' }} 
                          domain={[0, 100]} 
                          ticks={[0, 20, 40, 60, 80, 100]} 
                       />
                       <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
                       <Legend 
                          verticalAlign="bottom" 
                          align="center" 
                          wrapperStyle={{ paddingTop: '40px' }}
                          content={({ payload }) => (
                            <div className="flex justify-center gap-8 mt-10">
                              {payload?.map((entry: any, index: number) => (
                                <div key={index} className="flex items-center gap-3">
                                  <div className="w-5 h-5 rounded-full border-[3px] bg-white" style={{ borderColor: entry.color }}></div>
                                  <span className="text-[13px] font-black text-slate-500">{entry.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                       />
                       <Line type="monotone" dataKey="knowledge" name="Knowledge" stroke="#1e3a8a" strokeWidth={4} dot={{ r: 6, fill: "#fff", strokeWidth: 3, stroke: "#1e3a8a" }} />
                       <Line type="monotone" dataKey="skills" name="Skills" stroke="#10b981" strokeWidth={4} dot={{ r: 6, fill: "#fff", strokeWidth: 3, stroke: "#10b981" }} />
                       <Line type="monotone" dataKey="application" name="Application" stroke="#f59e0b" strokeWidth={4} dot={{ r: 6, fill: "#fff", strokeWidth: 3, stroke: "#f59e0b" }} />
                    </LineChart>
                 </ResponsiveContainer>
               </div>
            </div>
          </div>
        </>
      ) : (
        <div className="animate-in fade-in duration-700 space-y-8 pb-10">
          {/* Individual Subject Dashboard Card */}
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl overflow-hidden">
            <div className="p-8 lg:p-12">
              {/* Profile Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-10">
                <div className="flex items-center gap-8">
                  <div className="w-20 h-20 rounded-2xl bg-[#1e3a8a] flex items-center justify-center text-white shadow-lg border-4 border-white overflow-hidden">
                    <Calculator className="w-10 h-10" />
                  </div>
                  <div>
                    <h2 className="text-3xl lg:text-4xl font-bold text-[#1e294b] tracking-tight uppercase">{selectedSubject.name}</h2>
                    <p className="text-slate-500 font-bold text-sm tracking-widest mt-1 uppercase opacity-70">
                      Subject Performance Analysis • {selectedSubject.teachers} Teachers • {selectedSubject.students.toLocaleString()} Students
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="bg-[#22c55e] text-white text-[11px] font-black px-8 py-2.5 rounded-full shadow-lg h-10 flex items-center uppercase tracking-widest">
                    {selectedSubject.status}
                  </span>
                  <button onClick={() => navigate('/academics')} className="p-2.5 rounded-xl bg-slate-50 text-slate-400 hover:bg-slate-100 transition-all border border-slate-100">
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-3 mb-10">
                 {["Performance", "Topics", "Resources"].map(tab => (
                   <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-10 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${
                      activeTab === tab ? "bg-[#1e3a8a] text-white shadow-xl" : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                    }`}
                   >
                     {tab}
                   </button>
                 ))}
              </div>

              {/* KPI Cards Row */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
                {[
                  { label: "Average Score", value: selectedSubject.metrics.avgScore.value, note: selectedSubject.metrics.avgScore.note, type: 'green' },
                  { label: "Pass Rate", value: selectedSubject.metrics.passRate.value, note: selectedSubject.metrics.passRate.note, type: 'green' },
                  { label: "Top Performers", value: selectedSubject.metrics.topPerformers.value, note: selectedSubject.metrics.topPerformers.note, type: 'green' },
                  { label: "Areas Needing Focus", value: selectedSubject.metrics.focusAreas.value, note: selectedSubject.metrics.focusAreas.note, type: 'yellow' },
                ].map((stat, i) => (
                  <div key={i} className={`p-8 rounded-[1.5rem] border ${stat.type === 'green' ? 'bg-[#f0fdf4] border-emerald-100/50' : 'bg-[#fffbeb] border-amber-100/50'}`}>
                    <p className={`${stat.type === 'green' ? 'text-[#059669]/60' : 'text-[#d97706]/60'} text-[11px] font-black uppercase tracking-tight mb-4`}>{stat.label}</p>
                    <h3 className={`text-4xl font-black ${stat.type === 'green' ? 'text-[#059669]' : 'text-[#d97706]'} tracking-tighter mb-2`}>{stat.value}</h3>
                    <p className={`${stat.type === 'green' ? 'text-[#059669]/80' : 'text-[#d97706]/80'} text-[11px] font-black uppercase tracking-tight`}>{stat.note}</p>
                  </div>
                ))}
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div>
                  <h3 className="text-lg font-black text-[#1e294b] mb-10">Topic-wise Performance</h3>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={selectedSubject.topics} layout="vertical" margin={{ left: -10, right: 40 }}>
                        <XAxis type="number" domain={[0, 100]} hide />
                        <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11, fontWeight: 'bold' }} width={60} />
                        <Tooltip cursor={{ fill: 'transparent' }} />
                        <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={16}>
                          {selectedSubject.topics.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.score >= 80 ? '#22c55e' : entry.score >= 70 ? '#f59e0b' : '#ef4444'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div>
                   <h3 className="text-lg font-black text-[#1e294b] mb-10">Class Comparison</h3>
                   <div className="h-[280px]">
                     <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={selectedSubject.classComparison} margin={{ bottom: 20 }}>
                          <XAxis dataKey="grade" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: '800' }} dy={10} />
                          <YAxis hide domain={[0, 100]} />
                          <Tooltip cursor={{ fill: 'transparent' }} />
                          <Legend verticalAlign="bottom" height={36} iconType="rect" wrapperStyle={{ paddingTop: '20px', fontSize: '11px', fontWeight: 'bold' }} />
                          <Bar dataKey="main" name="Main" fill="#1e3a8a" radius={[2, 2, 0, 0]} barSize={14} />
                          <Bar dataKey="north" name="North" fill="#3b82f6" radius={[2, 2, 0, 0]} barSize={14} />
                          <Bar dataKey="south" name="South" fill="#93c5fd" radius={[2, 2, 0, 0]} barSize={14} />
                        </BarChart>
                     </ResponsiveContainer>
                   </div>
                </div>
              </div>
            </div>
          </div>

          {/* Weak Areas & Recommendations Card */}
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-10 lg:p-14">
             <h3 className="text-xl font-extrabold text-[#111827] mb-12 uppercase tracking-wide">Weak Areas & Recommendations</h3>
             <div className="space-y-8">
               {selectedSubject.weakAreas.map((area, idx) => (
                 <div key={idx} className={`p-10 rounded-[2.5rem] relative overflow-hidden transition-all hover:translate-y-[-5px] duration-500 shadow-sm ${area.status === 'Critical' ? 'bg-[#fef2f2]' : 'bg-[#fffbeb]'}`}>
                    <div className={`absolute top-0 left-0 w-2 h-full ${area.status === 'Critical' ? 'bg-red-500' : 'bg-amber-400'}`}></div>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 relative z-10">
                      <div>
                        <h4 className="text-2xl font-black text-[#1e294b] tracking-tight">{area.topic}</h4>
                        <p className="text-slate-400 font-bold text-sm mt-1">Average score: {area.avgScore} • {area.affected}</p>
                      </div>
                      <span className={`px-6 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${area.status === 'Critical' ? 'bg-[#ef4444] text-white border-red-200' : 'bg-[#eab308] text-white border-amber-200'}`}>
                        {area.status}
                      </span>
                    </div>
                    <div className="relative z-10 flex items-start gap-4">
                       <span className="text-[#1e294b] font-black text-sm whitespace-nowrap">Recommendation:</span>
                       <p className="text-slate-600 font-bold text-sm leading-relaxed">{area.recommendation}</p>
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
