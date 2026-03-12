import { dashboardStats, branches, riskDistribution, revenueTrend, criticalAlerts } from "@/data/dummyData";
import { Heart, Users, Percent, Bell, Download, Mail, Calendar, Settings, ChevronRight, AlertCircle, Info } from "lucide-react";
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";

const COLORS = ['#22c55e', '#f59e0b', '#ef4444'];

export default function Dashboard() {
  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-10">
      {/* Header Section */}
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold text-[#1e294b] tracking-tight">Executive Dashboard</h1>
        <p className="text-slate-500 font-medium">Real-time overview of all school operations</p>
      </div>

      {/* Stat Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { 
            title: "Academic Health Index", 
            value: "87.4", 
            change: "+2.3% vs last month", 
            icon: Heart, 
            color: "text-green-500", 
            iconBg: "bg-green-50" 
          },
          { 
            title: "Total Students", 
            value: "4,286", 
            change: "+124 new this term", 
            icon: Users, 
            color: "text-blue-500", 
            iconBg: "bg-blue-50" 
          },
          { 
            title: "Fee Collection Rate", 
            value: "94.2%", 
            change: "+1.8% vs last term", 
            icon: Percent, 
            color: "text-green-500", 
            iconBg: "bg-green-50" 
          },
          { 
            title: "Active Alerts", 
            value: "12", 
            change: "+3 since yesterday", 
            icon: Bell, 
            color: "text-red-500", 
            iconBg: "bg-red-50" 
          },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-start justify-between mb-4">
              <span className="text-slate-500 text-sm font-semibold tracking-tight">{stat.title}</span>
              <div className={`p-2 rounded-lg ${stat.iconBg}`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-4xl font-bold text-[#1e294b] tracking-tight">{stat.value}</span>
              <div className="flex items-center gap-1 mt-2">
                <span className={`text-xs font-bold ${stat.color === 'text-red-500' ? 'text-red-500' : 'text-green-500'}`}>
                  {stat.change.split(' ')[0]}
                </span>
                <span className="text-slate-400 text-xs font-medium">{stat.change.split(' ').slice(1).join(' ')}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Middle Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Branch Overview */}
        <div className="lg:col-span-4 bg-white rounded-3xl border border-slate-100 p-8 shadow-sm">
          <h3 className="text-lg font-bold text-[#1e294b] mb-8">Branch Overview</h3>
          <div className="flex flex-col gap-6">
            {branches.map((branch, i) => (
              <div key={i} className="flex items-center justify-between group cursor-pointer">
                <div>
                  <h4 className="text-[15px] font-bold text-[#1e294b] group-hover:text-blue-600 transition-colors">{branch.name}</h4>
                  <p className="text-slate-400 text-xs font-medium">{branch.students.toLocaleString()} students</p>
                </div>
                <div className={`px-4 py-1.5 rounded-lg text-xs font-bold ${
                  branch.ahi >= 90 ? 'bg-green-500 text-white' : 
                  branch.ahi >= 85 ? 'bg-emerald-500 text-white' : 'bg-orange-500 text-white'
                }`}>
                  {branch.ahi}% AHI
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Risk Distribution */}
        <div className="lg:col-span-4 bg-white rounded-3xl border border-slate-100 p-8 shadow-sm">
          <h3 className="text-lg font-bold text-[#1e294b] mb-6">Risk Distribution</h3>
          <div className="h-[240px] relative flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: "Safe", value: 70, fill: "#22c55e" },
                    { name: "Warning", value: 18, fill: "#f59e0b" },
                    { name: "Critical", value: 12, fill: "#ef4444" },
                  ]}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={10}
                  cornerRadius={12}
                  dataKey="value"
                  stroke="none"
                  startAngle={90}
                  endAngle={-270}
                >
                  <Cell fill="#22c55e" />
                  <Cell fill="#f59e0b" />
                  <Cell fill="#ef4444" />
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    borderRadius: '20px', 
                    border: 'none', 
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                    padding: '12px'
                  }}
                  itemStyle={{ fontWeight: 'bold', fontSize: '12px' }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center Text for Realism */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mt-6">
              <span className="text-3xl font-bold text-[#1e294b]">92%</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AHI Score</span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-6 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
              <span className="text-[11px] font-bold text-slate-500">Low Risk</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
              <span className="text-[11px] font-bold text-slate-500">Moderate</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
              <span className="text-[11px] font-bold text-slate-500">Critical</span>
            </div>
          </div>
        </div>

        {/* Revenue Trend */}
        <div className="lg:col-span-4 bg-white rounded-3xl border border-slate-100 p-8 shadow-sm">
          <h3 className="text-lg font-bold text-[#1e294b] mb-6">Revenue Trend</h3>
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1e3a8a" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="month" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 500 }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 500 }}
                  domain={[0, 600]}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                  itemStyle={{ fontWeight: 'bold', fontSize: '12px' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="revenue" 
                  stroke="#1e3a8a" 
                  strokeWidth={3} 
                  fillOpacity={1} 
                  fill="url(#revenueGradient)" 
                  dot={{ r: 4, fill: "#1e3a8a", strokeWidth: 2, stroke: "#fff" }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Critical Alerts */}
        <div className="bg-white rounded-3xl border border-slate-100 p-8 shadow-sm">
          <h3 className="text-lg font-bold text-[#1e294b] mb-6">Critical Alerts</h3>
          <div className="space-y-4">
            {[
              { 
                id: 1, 
                message: "Attendance drop in Grade 8 - North Branch", 
                time: "2 hours ago", 
                type: "danger",
                icon: AlertCircle,
                bg: "bg-red-50",
                border: "border-l-red-500"
              },
              { 
                id: 2, 
                message: "Fee defaulters exceeding 30 days", 
                time: "5 hours ago", 
                type: "warning",
                icon: AlertCircle,
                bg: "bg-amber-50",
                border: "border-l-amber-500"
              },
              { 
                id: 3, 
                message: "Teacher performance variance detected", 
                time: "1 day ago", 
                type: "warning",
                icon: AlertCircle,
                bg: "bg-amber-50",
                border: "border-l-amber-500"
              },
            ].map((alert) => (
              <div 
                key={alert.id} 
                className={`flex items-start gap-4 p-5 rounded-2xl border-l-4 ${alert.border} ${alert.bg} transition-all hover:scale-[1.01] cursor-pointer`}
              >
                <div className={`p-2 rounded-xl bg-white shadow-sm`}>
                  <alert.icon className={`w-5 h-5 ${alert.type === 'danger' ? 'text-red-500' : 'text-amber-500'}`} />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-[#1e294b] leading-tight">{alert.message}</h4>
                  <p className="text-slate-400 text-xs font-semibold mt-1">{alert.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-3xl border border-slate-100 p-8 shadow-sm">
          <h3 className="text-lg font-bold text-[#1e294b] mb-6">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button className="flex items-center gap-4 bg-[#1e294b] text-white p-5 rounded-2xl shadow-lg shadow-blue-900/20 hover:bg-[#151d36] transition-all group">
              <div className="p-2.5 rounded-xl bg-white/10 group-hover:scale-110 transition-transform">
                <Download className="w-5 h-5" />
              </div>
              <span className="text-sm font-bold">Export Report</span>
            </button>
            <button className="flex items-center gap-4 bg-white border border-slate-100 text-[#1e294b] p-5 rounded-2xl shadow-sm hover:bg-slate-50 transition-all group">
              <div className="p-2.5 rounded-xl bg-slate-50 group-hover:scale-110 transition-transform">
                <Mail className="w-5 h-5 text-slate-400" />
              </div>
              <span className="text-sm font-bold">Message Branches</span>
            </button>
            <button className="flex items-center gap-4 bg-white border border-slate-100 text-[#1e294b] p-5 rounded-2xl shadow-sm hover:bg-slate-50 transition-all group">
              <div className="p-2.5 rounded-xl bg-slate-50 group-hover:scale-110 transition-transform">
                <Calendar className="w-5 h-5 text-slate-400" />
              </div>
              <span className="text-sm font-bold">Schedule Meeting</span>
            </button>
            <button className="flex items-center gap-4 bg-white border border-slate-100 text-[#1e294b] p-5 rounded-2xl shadow-sm hover:bg-slate-50 transition-all group">
              <div className="p-2.5 rounded-xl bg-slate-50 group-hover:scale-110 transition-transform">
                <Settings className="w-5 h-5 text-slate-400" />
              </div>
              <span className="text-sm font-bold">System Settings</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
