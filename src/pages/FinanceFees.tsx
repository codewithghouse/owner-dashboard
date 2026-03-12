import { useState } from "react";
import { financeStats, branchRevenue, monthlyCollection, paymentModes, recentTransactions, defaultersList, defecitStats } from "@/data/dummyData";
import { 
  TrendingUp, Search, Filter, MoreVertical, X,
  DollarSign, PieChart as PieChartIcon, BarChart3, Clock, ArrowLeft, ChevronRight
} from "lucide-react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, Legend 
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function FinanceFees() {
  const [activeTab, setActiveTab] = useState<"Structure" | "Defaulters" | "History" | "Projections">("Defaulters");

  return (
    <div className="space-y-10 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">
      {/* Header with Breadcrumb-style */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-400">
           <span>Finance & Fees</span>
           <span className="text-slate-300 font-light">/</span>
           <span className="text-blue-900">{activeTab}</span>
        </div>
      </div>

      {/* Tabs Row */}
      <div className="flex items-center gap-3">
         {["Structure", "Defaulters", "History", "Projections"].map(tab => (
           <button
             key={tab}
             onClick={() => setActiveTab(tab as any)}
             className={`px-8 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm ${
               activeTab === tab ? "bg-[#1e3a8a] text-white shadow-[#1e3a8a]/20" : "bg-white text-slate-500 hover:bg-slate-50 border border-slate-100"
             }`}
           >
             {tab}
           </button>
         ))}
      </div>

      {activeTab === "Defaulters" ? (
        <div className="space-y-10 animate-in slide-in-from-bottom-5 duration-700">
          {/* Defaulter Specific Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                <p className="text-slate-400 text-xs font-bold uppercase mb-4 tracking-tight">Total Defaulters</p>
                <h3 className="text-4xl font-extrabold text-[#111827] tracking-tighter mb-2">142</h3>
                <p className="text-rose-500 text-[11px] font-bold tracking-tight">$168K outstanding</p>
            </div>
            <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                <p className="text-slate-400 text-xs font-bold uppercase mb-4 tracking-tight">Critical ({'>'}60 days)</p>
                <h3 className="text-4xl font-extrabold text-[#111827] tracking-tighter mb-2">28</h3>
                <p className="text-rose-500 text-[11px] font-bold tracking-tight">$52K at risk</p>
            </div>
            <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                <p className="text-slate-400 text-xs font-bold uppercase mb-4 tracking-tight">Reminder Sent</p>
                <h3 className="text-4xl font-extrabold text-[#111827] tracking-tighter mb-2">98</h3>
                <p className="text-amber-500 text-[11px] font-bold tracking-tight">44 pending</p>
            </div>
          </div>

          {/* Search & Filters Row */}
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="relative flex-1 w-full md:w-auto">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                className="h-14 pl-14 pr-6 bg-white border-slate-100 rounded-2xl shadow-sm focus:ring-blue-900/5 transition-all text-sm font-medium"
                placeholder="Search by student name or ID..."
              />
            </div>
            <div className="w-24 h-14 bg-white border border-slate-100 rounded-2xl shadow-sm"></div>
            <div className="w-24 h-14 bg-white border border-slate-100 rounded-2xl shadow-sm"></div>
          </div>

          {/* Defaulters Detailed Table */}
          <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[1000px]">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="py-7 px-10 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Student</th>
                    <th className="py-7 px-10 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Branch</th>
                    <th className="py-7 px-10 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Amount Due</th>
                    <th className="py-7 px-10 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Days Overdue</th>
                    <th className="py-7 px-10 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Last Reminder</th>
                    <th className="py-7 px-10 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Status</th>
                    <th className="py-7 px-10 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                   {[
                     { initials: 'RV', name: 'Rahul Verma', grade: 'Grade 11', branch: 'South Branch', amount: '$2,400', days: '78 days', date: 'Jan 10, 2025', status: 'Critical', color: 'text-rose-500' },
                     { initials: 'AK', name: 'Anita Kumar', grade: 'Grade 9', branch: 'North Branch', amount: '$1,800', days: '45 days', date: 'Jan 12, 2025', status: 'Warning', color: 'text-amber-500' },
                     { initials: 'MC', name: 'Michael Chen', grade: 'Grade 12', branch: 'Main Campus', amount: '$1,200', days: '32 days', date: 'Jan 14, 2025', status: 'Warning', color: 'text-amber-500' }
                   ].map((d, i) => (
                     <tr key={i} className="group hover:bg-slate-50/30 transition-colors">
                        <td className="py-8 px-10">
                           <div className="flex gap-4">
                              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-xs shrink-0">{d.initials}</div>
                              <div>
                                 <p className="font-extrabold text-[#111827] tracking-tight group-hover:text-blue-600 transition-colors">{d.name}</p>
                                 <p className="text-slate-400 text-xs font-medium">{d.grade}</p>
                              </div>
                           </div>
                        </td>
                        <td className="py-8 px-10 text-slate-500 font-bold text-[13px]">{d.branch}</td>
                        <td className="py-8 px-10 font-bold text-[#111827] text-[15px]">{d.amount}</td>
                        <td className={`py-8 px-10 font-black text-[13px] ${d.color}`}>{d.days}</td>
                        <td className="py-8 px-10 text-slate-500 font-bold text-[13px]">{d.date}</td>
                        <td className="py-8 px-10">
                           <span className="text-[13px] font-black text-slate-800">{d.status}</span>
                        </td>
                        <td className="py-8 px-10">
                           <button className="text-[#111827] font-bold text-[13px] tracking-tight hover:underline underline-offset-4">Contact</button>
                        </td>
                     </tr>
                   ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fee Structure Overview Card */}
          <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-10 mt-10">
             <h3 className="text-lg font-bold text-[#111827] mb-10">Fee Structure Overview</h3>
             <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[
                  { label: 'Grade 6-8', price: '$1,000', note: 'per term' },
                  { label: 'Grade 9-10', price: '$1,200', note: 'per term' },
                  { label: 'Grade 11-12', price: '$1,500', note: 'per term' },
                  { label: 'Additional', price: '$200-500', note: 'activities & labs' },
                ].map((s, i) => (
                  <div key={i} className="p-8 rounded-[1.5rem] bg-[#f8fafc]/50 border border-slate-100 transition-all hover:bg-white hover:shadow-lg">
                     <p className="text-slate-400 text-[11px] font-black uppercase tracking-widest mb-4 opacity-70">{s.label}</p>
                     <h4 className="text-3xl font-black text-[#1e3a8a] tracking-tight mb-2">{s.price}</h4>
                     <p className="text-slate-400 text-[11px] font-bold tracking-tight">{s.note}</p>
                  </div>
                ))}
             </div>
          </div>
        </div>
      ) : (
        /* Original Dashboard Content */
        <div className="animate-in slide-in-from-bottom-5 duration-700 space-y-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { label: "Total Revenue", value: "$2.84M", change: "+8.4% vs last term", col: "text-emerald-500" },
              { label: "Collection Rate", value: "94.2%", change: "+1.8% improvement", col: "text-emerald-500" },
              { label: "Outstanding", value: "$242K", change: "5.9% of total", col: "text-rose-500" },
              { label: "Defaulters", value: "142", change: "3.3% of students", col: "text-amber-500" },
            ].map((stat, i) => (
              <div key={i} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm transition-all hover:shadow-md">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-tight mb-4">{stat.label}</p>
                <h3 className="text-4xl font-extrabold text-[#111827] tracking-tighter mb-2">{stat.value}</h3>
                <p className={`text-[11px] font-bold ${stat.col}`}>{stat.change}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
               <h3 className="text-lg font-bold text-[#111827] mb-12">Branch-wise Revenue</h3>
               <div className="h-[250px] w-full">
                 <ResponsiveContainer width="100%" height="100%">
                   <BarChart data={branchRevenue} layout="vertical" margin={{ left: -20, right: 30 }}>
                      <XAxis type="number" domain={[0, 1500]} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} ticks={[0, 300, 600, 900, 1200, 1500]} tickFormatter={(val) => `$${val}K`} />
                      <YAxis type="category" dataKey="branch" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11, fontWeight: 'bold' }} width={80} />
                      <Tooltip cursor={{ fill: '#f8fafc' }} />
                      <Bar dataKey="revenue" radius={[0, 4, 4, 0]} barSize={20}>
                        {branchRevenue.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={index === 0 ? '#1e3a8a' : index === 1 ? '#3b82f6' : '#93c5fd'} />
                        ))}
                      </Bar>
                   </BarChart>
                 </ResponsiveContainer>
               </div>
            </div>

            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
               <h3 className="text-lg font-bold text-[#111827] mb-12">Monthly Collection Trend</h3>
               <div className="h-[250px] w-full">
                 <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyCollection} margin={{ left: -20, right: 10 }}>
                      <defs>
                        <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#1e3a8a" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} domain={[0, 600]} ticks={[0, 100, 200, 300, 400, 500, 600]} tickFormatter={(val) => `$${val}K`} />
                      <Tooltip />
                      <Area type="monotone" dataKey="amount" stroke="#1e3a8a" strokeWidth={3} fillOpacity={1} fill="url(#colorAmount)" dot={{ r: 4, fill: "#1e3a8a", strokeWidth: 2, stroke: "#fff" }} />
                    </AreaChart>
                 </ResponsiveContainer>
               </div>
            </div>

            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm relative">
               <h3 className="text-lg font-bold text-[#111827] mb-8">Payment Mode Distribution</h3>
               <div className="h-[280px] w-full">
                 <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={paymentModes}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={85}
                        paddingAngle={2}
                        dataKey="value"
                        labelLine={true}
                        label={({ cx, cy, midAngle, innerRadius, outerRadius, value, name, fill }: any) => {
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
                        {paymentModes.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                 </ResponsiveContainer>
               </div>
            </div>
          </div>

          <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-10 border-b border-slate-50 flex items-center justify-between">
              <h3 className="text-xl font-bold text-[#111827]">Recent Transactions</h3>
              <Button variant="ghost" onClick={() => setActiveTab("History")} className="h-10 text-blue-600 font-extrabold text-xs uppercase tracking-widest hover:bg-blue-50">Explore All</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[1000px]">
                <thead>
                  <tr className="bg-slate-50/50">
                    {["Date", "Student", "Branch", "Amount", "Mode", "Status"].map((h) => (
                      <th key={h} className="py-6 px-10 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {recentTransactions.map((t, i) => (
                    <tr key={i} className="hover:bg-slate-50/30 transition-colors group cursor-pointer">
                      <td className="py-7 px-10 text-slate-500 font-bold text-[13px]">{t.date}</td>
                      <td className="py-7 px-10">
                        <p className="font-extrabold text-[#111827] text-[15px] tracking-tight group-hover:text-blue-600 transition-colors">{t.student}</p>
                      </td>
                      <td className="py-7 px-10 text-slate-500 text-[13px] font-bold">{t.branch}</td>
                      <td className="py-7 px-10 font-black text-[#111827] text-[15px]">{t.amount}</td>
                      <td className="py-7 px-10 text-slate-500 text-[13px] font-bold">{t.mode}</td>
                      <td className="py-7 px-10">
                        <span className={`text-[13px] font-black ${
                          t.status === "Paid" ? "text-slate-800" : "text-amber-600 font-bold"
                        }`}>{t.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
