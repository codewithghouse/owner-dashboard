import { performanceRanking, comparativeTrends } from "@/data/dummyData";
import { useState, useEffect, useMemo } from "react";
import { db, auth } from "@/lib/firebase";
import { collection, onSnapshot } from "firebase/firestore";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, BarChart, Bar, Cell
} from "recharts";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, CheckCircle, AlertTriangle, Building2,
  ChevronRight, X
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function BranchesComparison() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [branches, setBranches] = useState<any[]>([]);

  useEffect(() => {
    if (!auth.currentUser) return;
    const branchesRef = collection(db, "schools", auth.currentUser.uid, "branches");
    const unsubscribe = onSnapshot(branchesRef, (snapshot) => {
      const branchList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setBranches(branchList);
    });
    return () => unsubscribe();
  }, []);

  const selectedBranch = useMemo(() => {
    if (!id || branches.length === 0) return null;
    return branches.find(b => b.name.toLowerCase().replace(/\s+/g, '-') === id.toLowerCase()) || null;
  }, [id, branches]);

  const branchesArray = branches;

  const getMetricColor = (value: number) => {
    if (value >= 94) return 'text-[#22c55e]';
    if (value >= 90) return 'text-[#f59e0b]';
    return 'text-[#ef4444]';
  };

  // Get status config based on branch status
  const getStatusConfig = (status: string) => {
    if (status === 'Strong') return { bg: 'bg-emerald-500', text: 'text-white' };
    if (status === 'Good') return { bg: 'bg-blue-500', text: 'text-white' };
    return { bg: 'bg-[#ef4444]', text: 'text-white' };
  };

  // Generate action plan details based on branch
  const getActionPlanDetails = (branch: any) => {
    if (branch.name === 'South Branch') {
      return [
        { task: 'Implement Math Remediation Program', sub: 'Target: 150 students • Timeline: 6 weeks • Budget: $8,000', priority: 'High Priority', prColor: 'bg-[#ef4444]' },
        { task: 'Attendance Improvement Initiative', sub: 'Parent meetings • Incentive program • Transport review', priority: 'Medium Priority', prColor: 'bg-[#f59e0b]' },
        { task: 'Fee Collection Drive', sub: 'Automated reminders • Payment plans • Follow-up calls', priority: 'Medium Priority', prColor: 'bg-[#f59e0b]' },
      ];
    }
    if (branch.name === 'North Branch') {
      return [
        { task: 'Upgrade Primary Science Labs', sub: 'Equipment procurement • Lab renovation • Safety protocols', priority: 'High Priority', prColor: 'bg-[#ef4444]' },
        { task: 'Optimize Teacher-Student Ratio', sub: 'New hires for G6-G8 • Schedule revision • Resource allocation', priority: 'Medium Priority', prColor: 'bg-[#f59e0b]' },
      ];
    }
    return [
      { task: 'Expand Chemistry Lab Capacity', sub: 'Additional workstations • Safety upgrades • Equipment install', priority: 'Medium Priority', prColor: 'bg-[#f59e0b]' },
      { task: 'Launch Faculty Research Grant', sub: 'Budget allocation • Application process • Review committee', priority: 'Low Priority', prColor: 'bg-slate-400' },
    ];
  };

  // KPI notes based on branch
  const getKPINotes = (branch: any) => {
    return [
      { label: 'Academic Health Index', value: `${branch.ahi || 0}%`, note: 'Live data', color: `text-[${branch.color}]` },
      { label: 'Fee Collection', value: `${branch.feeCollection || 0}%`, note: 'Target check', color: `text-[${branch.color}]` },
      { label: 'Pass Rate', value: `${branch.passRate || 0}%`, note: 'Academic status', color: `text-[${branch.color}]` },
      { label: 'Active Alerts', value: `0`, note: 'No active risks', color: 'text-[#22c55e]' },
    ];
  };

  return (
    <div className="space-y-10 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">

      {!selectedBranch ? (
        <div className="space-y-10">
          {/* Header */}
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-extrabold text-[#111827] tracking-tight">Branches Comparison</h1>
            <p className="text-slate-400 font-medium text-sm">Side-by-side performance analysis</p>
          </div>

          {/* Three Branch Cards Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {branchesArray.map((b) => (
              <div
                key={b.name}
                className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-lg transition-all cursor-pointer group"
                onClick={() => navigate(`/branches/${b.name.toLowerCase().replace(/\s+/g, '-')}`)}
              >
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0" style={{ backgroundColor: b.color }}>
                    <Building2 className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[#111827] group-hover:text-blue-600 transition-colors">{b.name}</h3>
                    <p className="text-xs font-bold text-slate-400">{b.students.toLocaleString()} students</p>
                  </div>
                </div>
                <div className="space-y-0 divide-y divide-slate-50">
                  {[
                    { label: "AHI", value: b.ahi },
                    { label: "Fee Collection", value: b.feeCollection },
                    { label: "Pass Rate", value: b.passRate },
                    { label: "Attendance", value: b.attendance },
                  ].map((metric) => (
                    <div key={metric.label} className="flex justify-between items-center py-5">
                      <span className="text-sm font-medium text-slate-500">{metric.label}</span>
                      <span className={`text-sm font-black ${getMetricColor(metric.value)}`}>{metric.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
              <h3 className="text-lg font-bold text-[#111827] mb-12">Performance Ranking</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={performanceRanking} layout="vertical" barGap={4} margin={{ left: 0, right: 20 }}>
                    <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} ticks={[0, 20, 40, 60, 80, 100]} />
                    <YAxis dataKey="metric" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11, fontWeight: 'bold' }} width={80} />
                    <Tooltip cursor={{ fill: '#f8fafc' }} />
                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: '20px' }}
                      content={({ payload }) => (
                        <div className="flex justify-center gap-6 mt-6">
                          {payload?.map((entry: any, index: number) => (
                            <div key={index} className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: entry.color }}></div>
                              <span className="text-[11px] font-bold text-slate-500">{entry.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    />
                    <Bar dataKey="main" name="Main" fill="#1e3a8a" radius={[0, 2, 2, 0]} barSize={10} />
                    <Bar dataKey="north" name="North" fill="#3b82f6" radius={[0, 2, 2, 0]} barSize={10} />
                    <Bar dataKey="south" name="South" fill="#f59e0b" radius={[0, 2, 2, 0]} barSize={10} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
              <h3 className="text-lg font-bold text-[#111827] mb-12">Comparative Trends</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={comparativeTrends} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} />
                    <Tooltip />
                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: '20px' }}
                      content={({ payload }) => (
                        <div className="flex justify-center gap-6 mt-6">
                          {payload?.map((entry: any, index: number) => (
                            <div key={index} className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-full border-[2.5px] bg-white" style={{ borderColor: entry.color }}></div>
                              <span className="text-[11px] font-bold text-slate-500">{entry.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    />
                    <Line type="monotone" dataKey="main" name="Main" stroke="#1e3a8a" strokeWidth={3} dot={{ r: 5, fill: "#fff", strokeWidth: 2.5, stroke: "#1e3a8a" }} />
                    <Line type="monotone" dataKey="north" name="North" stroke="#3b82f6" strokeWidth={3} dot={{ r: 5, fill: "#fff", strokeWidth: 2.5, stroke: "#3b82f6" }} />
                    <Line type="monotone" dataKey="south" name="South" stroke="#f59e0b" strokeWidth={3} dot={{ r: 5, fill: "#fff", strokeWidth: 2.5, stroke: "#f59e0b" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Efficiency Metrics */}
          <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-10">
            <h3 className="text-xl font-bold text-[#111827] mb-10">Efficiency Metrics</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[
                { label: "Revenue/Student", value: "$1,324", note: "Main leads", col: "text-[#1e3a8a]" },
                { label: "Teacher Ratio", value: "1:18", note: "Main optimal", col: "text-[#1e3a8a]" },
                { label: "Resource Util.", value: "87%", note: "Main highest", col: "text-[#1e3a8a]" },
                { label: "Growth Rate", value: "+12%", note: "North fastest", col: "text-[#22c55e]" },
              ].map((m, i) => (
                <div key={i} className="bg-[#f8fafc]/50 border border-slate-100 p-8 rounded-[1.5rem] text-center transition-all hover:bg-white hover:shadow-lg">
                  <p className="text-slate-400 text-[11px] font-bold uppercase tracking-tight mb-4">{m.label}</p>
                  <h3 className={`text-3xl font-black ${m.col} tracking-tighter mb-2`}>{m.value}</h3>
                  <p className="text-[#22c55e] text-[11px] font-bold">{m.note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* ==================== INDIVIDUAL BRANCH DETAIL ==================== */
        <div className="animate-in fade-in duration-700 space-y-8 pb-10">
          {/* Main Profile Card */}
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-8 lg:p-12">
              {/* Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-10">
                <div className="flex items-center gap-6">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0" style={{ backgroundColor: selectedBranch.color }}>
                    <Building2 className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-2xl lg:text-3xl font-bold text-[#111827] tracking-tight">{selectedBranch.name}</h2>
                    <p className="text-slate-400 font-medium text-sm mt-1">
                      {selectedBranch.students.toLocaleString()} students • {selectedBranch.teachers} teachers • Established {selectedBranch.established}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-5 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest ${getStatusConfig(selectedBranch.status).bg} ${getStatusConfig(selectedBranch.status).text}`}>
                    {selectedBranch.status}
                  </span>
                  <Button className="h-10 px-5 rounded-lg bg-[#1e294b] text-white text-[11px] font-bold hover:bg-[#1e3a8a] shadow-lg">
                    Generate Report
                  </Button>
                  <button onClick={() => navigate('/branches')} className="p-2 rounded-lg bg-slate-50 text-slate-400 hover:bg-slate-100 transition-all">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-12">
                {getKPINotes(selectedBranch).map((kpi, i) => (
                  <div key={i} className="p-6 rounded-[1.2rem] border border-slate-100 bg-[#fffbeb]/30 transition-all hover:bg-white hover:shadow-lg">
                    <p className="text-slate-400 text-[11px] font-bold uppercase tracking-tight mb-3">{kpi.label}</p>
                    <h3 className="text-3xl font-black tracking-tighter mb-1.5" style={{ color: i === 3 ? '#ef4444' : selectedBranch.color }}>{kpi.value}</h3>
                    <p className="text-[11px] font-bold" style={{ color: i === 3 ? '#ef4444' : selectedBranch.color }}>{kpi.note}</p>
                  </div>
                ))}
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12">
                {/* Historical Performance */}
                <div>
                  <h3 className="text-base font-bold text-[#111827] mb-10">Historical Performance</h3>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={[{ year: "2024", score: 0, schoolAvg: 0 }, { year: "2025", score: selectedBranch.ahi || 0, schoolAvg: 85 }]} margin={{ left: -20, right: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} domain={[0, 100]} />
                        <Tooltip />
                        <Line type="monotone" dataKey="schoolAvg" name="School Avg" stroke="#22c55e" strokeWidth={2} strokeDasharray="6 6" dot={false} />
                        <Line type="monotone" dataKey="score" name={selectedBranch.name} stroke={selectedBranch.color} strokeWidth={3} dot={{ r: 5, fill: "#fff", strokeWidth: 2.5, stroke: selectedBranch.color }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Benchmark Comparison */}
                <div>
                  <h3 className="text-base font-bold text-[#111827] mb-10">Benchmark Comparison</h3>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { metric: "AHI", branch: selectedBranch.ahi, avg: 88 },
                        { metric: "Fee Coll.", branch: selectedBranch.feeCollection, avg: 94 },
                        { metric: "Pass Rate", branch: selectedBranch.passRate, avg: 93 },
                        { metric: "Attendance", branch: selectedBranch.attendance, avg: 92 },
                        { metric: "Growth", branch: selectedBranch.ahi - 7, avg: selectedBranch.ahi - 5 },
                      ]} barGap={6} margin={{ bottom: 20 }}>
                        <XAxis dataKey="metric" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} domain={[0, 100]} ticks={[0, 20, 40, 60, 80]} />
                        <Tooltip cursor={{ fill: '#f8fafc' }} />
                        <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: '10px' }}
                          content={({ payload }) => (
                            <div className="flex justify-center gap-6 mt-4">
                              {payload?.map((entry: any, index: number) => (
                                <div key={index} className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: entry.color }}></div>
                                  <span className="text-[10px] font-bold text-slate-500">{entry.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        />
                        <Bar dataKey="branch" name={selectedBranch.name.split(' ')[0]} fill={selectedBranch.color} radius={[3, 3, 0, 0]} barSize={18} />
                        <Bar dataKey="avg" name="School Avg" fill="#d1d5db" radius={[3, 3, 0, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Strengths & Improvements */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Strengths */}
                <div className="p-8 rounded-[1.5rem] border border-emerald-100 bg-[#f0fdf4]/50">
                  <h4 className="text-base font-bold text-[#22c55e] mb-6 flex items-center gap-2.5">
                    <CheckCircle className="w-5 h-5 text-[#22c55e]" /> Strengths
                  </h4>
                  <ul className="space-y-3">
                    <li className="text-slate-700 font-medium text-sm leading-relaxed">• Branch successfully established in {selectedBranch.location}</li>
                    <li className="text-slate-700 font-medium text-sm leading-relaxed">• System configuration complete</li>
                  </ul>
                </div>
                {/* Areas for Improvement */}
                <div className="p-8 rounded-[1.5rem] border border-rose-100 bg-[#fef2f2]/50">
                  <h4 className="text-base font-bold text-[#ef4444] mb-6 flex items-center gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-[#ef4444]" /> Areas for Improvement
                  </h4>
                  <ul className="space-y-3">
                    <li className="text-slate-700 font-medium text-sm leading-relaxed">• Initial student enrollment drive needed</li>
                    <li className="text-slate-700 font-medium text-sm leading-relaxed">• Staff recruitment process to be started</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Recommended Action Plan */}
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-10">
            <h3 className="text-xl font-bold text-[#111827] mb-10">Recommended Action Plan</h3>
            <div className="space-y-0 divide-y divide-slate-50">
              {[
                { task: 'Launch Enrollment Campaign', sub: 'Target: First 100 students', priority: 'High Priority', prColor: 'bg-[#ef4444]' },
                { task: 'Faculty Onboarding', sub: 'Recruit Core Subject Teachers', priority: 'Medium Priority', prColor: 'bg-[#f59e0b]' },
              ].map((plan, idx) => (
                <div key={idx} className="flex items-center justify-between py-7 gap-8 group">
                  <div className="flex items-center gap-6">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm shrink-0" style={{ backgroundColor: selectedBranch.color }}>
                      {idx + 1}
                    </div>
                    <div>
                      <h4 className="text-[15px] font-bold text-[#111827] mb-1 group-hover:text-blue-600 transition-colors">{plan.task}</h4>
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
      )}
    </div>
  );
}
