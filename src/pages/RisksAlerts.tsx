import { StatCard, PageHeader } from "@/components/shared/StatCard";
import { risksStats, riskDistribution, riskTrend, branchRisk, activeAlertsList } from "@/data/dummyData";
import { 
  AlertTriangle, DollarSign, GraduationCap, Presentation, FileText,
  ChevronRight, Info, AlertOctagon, CheckCircle2
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, BarChart, Bar } from "recharts";
import { Link, useNavigate } from "react-router-dom";

export default function RisksAlerts() {
  const navigate = useNavigate();

  return (
    <div className="space-y-10 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold text-[#111827] tracking-tight">Risks & Alerts</h1>
        <p className="text-slate-400 font-medium text-sm">Early warning system & risk monitoring</p>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: "Active Alerts", value: "12", change: "+3 since yesterday", col: "text-rose-500" },
          { label: "Critical", value: "4", change: "Immediate action", col: "text-rose-500" },
          { label: "Warning", value: "6", change: "Monitor closely", col: "text-amber-500" },
          { label: "Resolved (30d)", value: "28", change: "92% resolution rate", col: "text-emerald-500" },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm transition-all hover:shadow-md">
            <p className="text-slate-400 text-xs font-bold uppercase tracking-tight mb-4">{stat.label}</p>
            <h3 className="text-4xl font-extrabold text-[#111827] tracking-tighter mb-2">{stat.value}</h3>
            <p className={`text-[11px] font-bold ${stat.col}`}>{stat.change}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Distribution */}
        <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
           <h3 className="text-lg font-bold text-[#111827] mb-8">Risk Distribution</h3>
           <div className="h-[280px] w-full">
             <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Info', value: 20, fill: '#3b82f6' },
                      { name: 'Critical', value: 35, fill: '#ef4444' },
                      { name: 'Warning', value: 45, fill: '#f59e0b' }
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="value"
                    labelLine={true}
                    label={({ cx, cy, midAngle, innerRadius, outerRadius, value, name }: any) => {
                      const RADIAN = Math.PI / 180;
                      const radius = outerRadius + 20;
                      const x = cx + radius * Math.cos(-midAngle * RADIAN);
                      const y = cy + radius * Math.sin(-midAngle * RADIAN);
                      return (
                        <text x={x} y={y} fill="#64748b" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" className="text-[10px] font-bold uppercase">
                          {name}
                        </text>
                      );
                    }}
                  >
                    <Cell fill="#3b82f6" stroke="none" />
                    <Cell fill="#ef4444" stroke="none" />
                    <Cell fill="#f59e0b" stroke="none" />
                  </Pie>
                  <Tooltip />
                </PieChart>
             </ResponsiveContainer>
           </div>
        </div>

        {/* Risk Trend */}
        <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
           <h3 className="text-lg font-bold text-[#111827] mb-12">Risk Trend</h3>
           <div className="h-[250px] w-full">
             <ResponsiveContainer width="100%" height="100%">
               <LineChart data={[
                 { name: 'W1', critical: 2, warning: 4 },
                 { name: 'W2', critical: 3, warning: 5 },
                 { name: 'W3', critical: 3, warning: 5 },
                 { name: 'W4', critical: 4, warning: 6 },
               ]} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={{ stroke: '#94a3b8' }} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} domain={[0, 6]} ticks={[0, 1, 2, 3, 4, 5, 6]} />
                  <Tooltip />
                  <Legend 
                    verticalAlign="bottom" 
                    align="center" 
                    wrapperStyle={{ paddingTop: '20px' }}
                    content={({ payload }) => (
                      <div className="flex justify-center gap-6">
                        {payload?.map((entry: any, index: number) => (
                          <div key={index} className="flex items-center gap-2">
                             <div className="w-4 h-4 rounded-full border-[2.5px] bg-white" style={{ borderColor: entry.color }}></div>
                             <span className="text-[11px] font-black text-slate-500 uppercase tracking-tight">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  />
                  <Line type="monotone" dataKey="critical" name="Critical" stroke="#ef4444" strokeWidth={3} dot={{ r: 5, fill: "#fff", strokeWidth: 2, stroke: "#ef4444" }} activeDot={{ r: 7 }} />
                  <Line type="monotone" dataKey="warning" name="Warning" stroke="#f59e0b" strokeWidth={3} dot={{ r: 5, fill: "#fff", strokeWidth: 2, stroke: "#f59e0b" }} activeDot={{ r: 7 }} />
               </LineChart>
             </ResponsiveContainer>
           </div>
        </div>

        {/* Branch-wise Risk */}
        <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
           <h3 className="text-lg font-bold text-[#111827] mb-12">Branch-wise Risk</h3>
           <div className="h-[250px] w-full">
             <ResponsiveContainer width="100%" height="100%">
               <BarChart data={[
                 { name: 'Main', value: 3, color: '#22c55e' },
                 { name: 'North', value: 4, color: '#f59e0b' },
                 { name: 'South', value: 5, color: '#ef4444' },
               ]} margin={{ bottom: 10 }}>
                  <XAxis dataKey="name" axisLine={{ stroke: '#94a3b8' }} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={40}>
                    {[
                      { fill: '#22c55e' },
                      { fill: '#f59e0b' },
                      { fill: '#ef4444' }
                    ].map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
               </BarChart>
             </ResponsiveContainer>
           </div>
        </div>
      </div>

      {/* Active Alerts List */}
      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden p-10 lg:p-14">
        <h3 className="text-xl font-extrabold text-[#111827] mb-12 uppercase tracking-wide">Active Alerts</h3>
        <div className="space-y-6">
          {[
            { 
              id: 'alert-1',
              title: 'Attendance Drop - Grade 8 North', 
              status: 'Critical', 
              desc: 'Average attendance dropped to 78% • 42 students affected • Started 5 days ago',
              icon: <GraduationCap className="w-6 h-6" />,
              type: 'critical'
            },
            { 
              id: 'alert-2',
              title: 'Fee Defaulters Exceeding 60 Days', 
              status: 'Critical', 
              desc: '28 students • $52K outstanding • South Branch most affected',
              icon: <DollarSign className="w-6 h-6" />,
              type: 'critical'
            },
            { 
              id: 'alert-3',
              title: 'Teacher Performance Variance', 
              status: 'Warning', 
              desc: '3 teachers below branch average • Mathematics department • Action plan needed',
              icon: <Presentation className="w-6 h-6" />,
              type: 'warning'
            },
            { 
              id: 'alert-4',
              title: 'Academic Performance Decline', 
              status: 'Warning', 
              desc: 'Grade 11 Math scores dropped 8% • 86 students • Requires intervention',
              icon: <FileText className="w-6 h-6" />,
              type: 'warning'
            }
          ].map((alert, i) => (
            <div key={i} className={`p-8 rounded-[2.5rem] relative overflow-hidden transition-all hover:translate-y-[-5px] duration-500 shadow-sm ${alert.type === 'critical' ? 'bg-[#fef2f2]' : 'bg-[#fffbeb]'}`}>
              <div className={`absolute top-0 left-0 w-2 h-full ${alert.type === 'critical' ? 'bg-[#ef4444]' : 'bg-[#f59e0b]'}`}></div>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 relative z-10">
                <div className="flex items-start gap-8">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white shrink-0 ${alert.type === 'critical' ? 'bg-[#ef4444]' : 'bg-[#f59e0b]'}`}>
                     {alert.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-4 mb-3">
                      <h4 className="text-xl font-extrabold text-[#1e294b] tracking-tight">{alert.title}</h4>
                      <span className={`px-4 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${alert.type === 'critical' ? 'bg-[#ef4444] text-white' : 'bg-[#f59e0b] text-white'}`}>
                        {alert.status}
                      </span>
                    </div>
                    <p className="text-slate-500 font-bold text-sm tracking-tight leading-relaxed">{alert.desc}</p>
                  </div>
                </div>
                <button 
                  onClick={() => navigate(`/risks/${alert.id}`)}
                  className="px-8 py-3 bg-[#1e294b] text-white text-[11px] font-black rounded-2xl uppercase tracking-widest hover:bg-[#1e3a8a] transition-all shrink-0 shadow-lg shadow-blue-900/10"
                >
                  View Details
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
