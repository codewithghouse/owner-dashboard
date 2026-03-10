import { StatCard, PageHeader } from "@/components/shared/StatCard";
import { dashboardStats, branches, riskDistribution, revenueTrend, criticalAlerts } from "@/data/dummyData";
import { Heart, Users, Percent, AlertTriangle, Download, Mail, Calendar, Settings } from "lucide-react";
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function Dashboard() {
  return (
    <div className="space-y-6 lg:space-y-10 max-w-[1600px] mx-auto animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
            <h1 className="text-2xl lg:text-3xl font-bold text-slate-800 text-center sm:text-left">Executive Dashboard</h1>
            <p className="text-slate-500 text-sm text-center sm:text-left">Real-time overview of all school operations</p>
        </div>
        <div className="flex items-center justify-center sm:justify-start gap-4">
            <div className="flex -space-x-2 overflow-hidden">
                {[1,2,3,4].map(i => (
                    <div key={i} className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-medium text-slate-400">{i}</div>
                ))}
            </div>
            <p className="text-xs font-medium text-slate-400">Security Nodes Active</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        {[
          { title: "Academic Health Index", value: dashboardStats.academicHealthIndex.value, change: dashboardStats.academicHealthIndex.change, icon: <Heart className="w-5 h-5" />, color: "text-green-600", bg: "bg-green-50" },
          { title: "Total Students", value: dashboardStats.totalStudents.value.toLocaleString(), change: dashboardStats.totalStudents.change, icon: <Users className="w-5 h-5" />, color: "text-blue-600", bg: "bg-blue-50" },
          { title: "Fee Collection Rate", value: dashboardStats.feeCollectionRate.value, change: dashboardStats.feeCollectionRate.change, icon: <Percent className="w-5 h-5" />, color: "text-green-600", bg: "bg-green-50" },
          { title: "Active Alerts", value: dashboardStats.activeAlerts.value, change: dashboardStats.activeAlerts.change, icon: <AlertTriangle className="w-5 h-5" />, color: "text-red-600", bg: "bg-red-50" },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm transition-all hover:shadow-md group">
            <p className="text-slate-500 text-sm font-medium mb-4 group-hover:text-blue-600 transition-colors">{stat.title}</p>
            <div className="flex items-center justify-between">
              <h2 className="text-2xl lg:text-3xl font-bold text-slate-800">{stat.value}</h2>
              <div className={`p-3 rounded-xl ${stat.bg} ${stat.color} shadow-sm`}>
                {stat.icon}
              </div>
            </div>
            <p className={`${stat.color} text-xs font-semibold mt-4 flex items-center gap-2`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current"></span> {stat.change}
            </p>
          </div>
        ))}
      </div>

      {/* Middle Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        {/* Branch Overview */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 lg:p-8 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-6">Branch Overview</h3>
          <div className="space-y-4">
            {branches.map((b) => (
              <div key={b.name} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-all group cursor-pointer border border-transparent hover:border-slate-100">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-800 text-white flex items-center justify-center text-xs font-bold">{b.name[0]}</div>
                    <div>
                        <p className="font-bold text-sm text-slate-800 group-hover:text-blue-600 transition-colors">{b.name}</p>
                        <p className="text-[11px] text-slate-500 font-medium">{b.students.toLocaleString()} students</p>
                    </div>
                </div>
                <span className={`text-[10px] font-bold px-3 py-1 rounded-lg ${
                b.ahi >= 90 ? "bg-green-50 text-green-600" : b.ahi >= 85 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"
                }`}>
                {b.ahi}% AHI
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Risk Distribution */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 lg:p-8 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-6">Risk Analysis</h3>
          <div className="h-[200px] lg:h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={riskDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={80} dataKey="value" paddingAngle={4} stroke="none">
                  {riskDistribution.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} className="hover:opacity-80 transition-opacity" />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                  itemStyle={{ fontWeight: 'bold', fontSize: '12px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-4">
            {riskDistribution.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: r.fill }}></div>
                <span className="text-[10px] font-bold text-slate-500">{r.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Revenue Trend */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 lg:p-8 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-6">Revenue Flow</h3>
          <div className="h-[200px] lg:h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueTrend} margin={{ left: -20, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis hide />
                <Tooltip />
                <Line type="monotone" dataKey="revenue" stroke="#1e3a8a" strokeWidth={3} dot={{ r: 4, fill: "#1e3a8a", strokeWidth: 2, stroke: "#fff" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 pb-10">
        {/* Critical Alerts */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 lg:p-8 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-6">Priority Alerts</h3>
          <div className="space-y-3">
            {criticalAlerts.map((a) => (
              <div key={a.id} className={`flex items-start gap-4 p-4 rounded-xl border-l-4 transition-all hover:bg-slate-50 cursor-pointer ${
                a.severity === "critical" ? "border-l-red-500 bg-red-50/20" : "border-l-amber-500 bg-amber-50/20"
              }`}>
                <div className={`p-2 rounded-lg shrink-0 ${a.severity === "critical" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800 leading-tight">{a.message}</p>
                  <p className="text-[11px] text-slate-400 font-medium mt-1">{a.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 lg:p-8 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-6">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:gap-4">
            {[
              { label: "Generate Report", icon: Download, variant: "primary" },
              { label: "Relay Message", icon: Mail, variant: "primary" },
              { label: "Sync Schedule", icon: Calendar, variant: "secondary" },
              { label: "Core Config", icon: Settings, variant: "secondary" },
            ].map((action) => (
              <button
                key={action.label}
                className={`flex items-center gap-4 px-6 py-4 rounded-xl text-xs font-bold transition-all group ${
                  action.variant === "primary"
                    ? "bg-[#1e3a8a] text-white hover:bg-[#152a6a] shadow-lg shadow-blue-900/15"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-100"
                }`}
              >
                <action.icon className={`w-4 h-4 transition-transform group-hover:scale-110 ${action.variant === 'primary' ? 'text-blue-100' : 'text-slate-400'}`} />
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>

  );
}
