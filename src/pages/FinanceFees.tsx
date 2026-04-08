import { useState } from "react";
import { financeStats, branchRevenue, monthlyCollection, paymentModes, recentTransactions, defaultersList } from "@/data/dummyData";
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
      <div className="flex flex-col gap-1 px-1">
        <div className="flex items-center gap-2 text-xs md:text-sm font-black text-slate-400 uppercase tracking-widest">
           <span>Finance & Fees</span>
           <span className="text-slate-300 font-light">/</span>
           <span className="text-[#1e3a8a]">{activeTab}</span>
        </div>
      </div>

      {/* Tabs Row */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar px-1">
         {["Structure", "Defaulters", "History", "Projections"].map(tab => (
           <button
             key={tab}
             onClick={() => setActiveTab(tab as any)}
             className={`whitespace-nowrap px-6 md:px-8 py-2 md:py-2.5 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all shadow-sm ${
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            <div className="bg-white p-6 md:p-8 rounded-2xl md:rounded-[2rem] border border-slate-100 shadow-sm">
                <p className="text-slate-400 text-[10px] md:text-xs font-black uppercase mb-3 md:mb-4 tracking-widest">Total Defaulters</p>
                <h3 className="text-3xl md:text-4xl font-black text-[#111827] tracking-tighter mb-1 md:mb-2">142</h3>
                <p className="text-rose-500 text-[10px] md:text-[11px] font-black uppercase tracking-tight">$168K outstanding</p>
            </div>
            <div className="bg-white p-6 md:p-8 rounded-2xl md:rounded-[2rem] border border-slate-100 shadow-sm">
                <p className="text-slate-400 text-[10px] md:text-xs font-black uppercase mb-3 md:mb-4 tracking-widest">Critical ({'>'}60 days)</p>
                <h3 className="text-3xl md:text-4xl font-black text-[#111827] tracking-tighter mb-1 md:mb-2">28</h3>
                <p className="text-rose-500 text-[10px] md:text-[11px] font-black uppercase tracking-tight">$52K at risk</p>
            </div>
            <div className="bg-white p-6 md:p-8 rounded-2xl md:rounded-[2rem] border border-slate-100 shadow-sm sm:col-span-2 lg:col-span-1">
                <p className="text-slate-400 text-[10px] md:text-xs font-black uppercase mb-3 md:mb-4 tracking-widest">Reminder Sent</p>
                <h3 className="text-3xl md:text-4xl font-black text-[#111827] tracking-tighter mb-1 md:mb-2">98</h3>
                <p className="text-amber-500 text-[10px] md:text-[11px] font-black uppercase tracking-tight">44 pending action</p>
            </div>
          </div>

          {/* Search & Filters Row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 md:gap-4 px-1">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                className="h-11 md:h-12 pl-12 pr-6 bg-white border-slate-100 rounded-xl md:rounded-2xl shadow-sm focus:ring-blue-900/5 transition-all text-xs font-black uppercase tracking-tight"
                placeholder="Search by name or student ID..."
              />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="flex-1 sm:w-auto h-11 md:h-12 rounded-xl border-slate-100 bg-white text-[10px] font-black uppercase tracking-widest text-slate-500">
                <Filter className="w-4 h-4 mr-2" /> Filter
              </Button>
              <Button variant="outline" className="w-11 md:w-12 h-11 md:h-12 rounded-xl border-slate-100 bg-white p-0">
                <MoreVertical className="w-4 h-4 text-slate-400" />
              </Button>
            </div>
          </div>

          {/* Defaulters Detailed Table */}
          <div className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[700px]">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Student</th>
                    <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest hidden md:table-cell">Branch</th>
                    <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Due</th>
                    <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Days</th>
                    <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest hidden sm:table-cell">Reminder</th>
                    <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                   {[
                     { initials: 'RV', name: 'Rahul Verma', grade: 'Grade 11', branch: 'South Branch', amount: '$2,400', days: '78d', date: 'Jan 10', status: 'Critical', color: 'text-rose-500' },
                     { initials: 'AK', name: 'Anita Kumar', grade: 'Grade 9', branch: 'North Branch', amount: '$1,800', days: '45d', date: 'Jan 12', status: 'Warning', color: 'text-amber-500' },
                     { initials: 'MC', name: 'Michael Chen', grade: 'Grade 12', branch: 'Main Campus', amount: '$1,200', days: '32d', date: 'Jan 14', status: 'Warning', color: 'text-amber-500' }
                   ].map((d, i) => (
                     <tr key={i} className="group hover:bg-slate-50/30 transition-colors">
                        <td className="py-5 px-6 md:px-10">
                           <div className="flex gap-3 md:gap-4 items-center">
                              <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-black text-[10px] shrink-0">{d.initials}</div>
                              <div className="min-w-0">
                                 <p className="font-black text-[#111827] text-xs md:text-sm tracking-tight group-hover:text-blue-600 transition-colors truncate">{d.name}</p>
                                 <p className="text-slate-400 text-[10px] font-bold uppercase tracking-tighter truncate">{d.grade}</p>
                              </div>
                           </div>
                        </td>
                        <td className="py-5 px-6 md:px-10 text-slate-500 font-bold text-xs hidden md:table-cell uppercase tracking-tight">{d.branch}</td>
                        <td className="py-5 px-6 md:px-10 font-black text-[#111827] text-xs md:text-sm">{d.amount}</td>
                        <td className={`py-5 px-6 md:px-10 font-black text-xs md:text-sm ${d.color}`}>{d.days}</td>
                        <td className="py-5 px-6 md:px-10 text-slate-500 font-bold text-[11px] hidden sm:table-cell uppercase tracking-tighter">{d.date}</td>
                        <td className="py-5 px-6 md:px-10">
                           <button className="text-[#111827] font-black text-[10px] md:text-xs tracking-widest uppercase hover:text-blue-600 transition-colors">Action</button>
                        </td>
                     </tr>
                   ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fee Structure Overview Card */}
          <div className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm p-6 md:p-10 mt-10">
             <h3 className="text-base md:text-lg font-black text-[#111827] mb-8 md:mb-10 uppercase tracking-widest">Fee Structure Overview</h3>
             <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
                {[
                  { label: 'G6-8', price: '$1,000', note: 'per term' },
                  { label: 'G9-10', price: '$1,200', note: 'per term' },
                  { label: 'G11-12', price: '$1,500', note: 'per term' },
                  { label: 'Extras', price: '$200+', note: 'varies' },
                ].map((s, i) => (
                  <div key={i} className="p-5 md:p-8 rounded-xl md:rounded-[1.5rem] bg-[#f8fafc]/50 border border-slate-100 transition-all hover:bg-white hover:shadow-lg">
                     <p className="text-slate-400 text-[9px] md:text-[11px] font-black uppercase tracking-widest mb-3 md:mb-4 opacity-70">{s.label}</p>
                     <h4 className="text-xl md:text-3xl font-black text-[#1e3a8a] tracking-tight mb-1 md:mb-2">{s.price}</h4>
                     <p className="text-slate-400 text-[10px] font-bold tracking-tight uppercase">{s.note}</p>
                  </div>
                ))}
             </div>
          </div>
        </div>
      ) : (
        /* Original Dashboard Content */
        <div className="animate-in slide-in-from-bottom-5 duration-700 space-y-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {[
              { label: "Total Revenue", value: "$2.84M", change: "+8.4%", col: "text-emerald-500" },
              { label: "Collection Rate", value: "94.2%", change: "+1.8%", col: "text-emerald-500" },
              { label: "Outstanding", value: "$242K", change: "5.9%", col: "text-rose-500" },
              { label: "Defaulters", value: "142", change: "3.3%", col: "text-amber-500" },
            ].map((stat, i) => (
              <div key={i} className="bg-white p-6 md:p-8 rounded-2xl md:rounded-[2rem] border border-slate-100 shadow-sm transition-all hover:shadow-md">
                <p className="text-slate-400 text-[10px] md:text-xs font-black uppercase tracking-widest mb-3 md:mb-4">{stat.label}</p>
                <h3 className="text-3xl md:text-4xl font-black text-[#111827] tracking-tighter mb-1 md:mb-2">{stat.value}</h3>
                <p className={`text-[10px] md:text-[11px] font-black uppercase ${stat.col}`}>{stat.change} trend</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 p-6 md:p-8 shadow-sm">
               <h3 className="text-sm md:text-base font-black text-[#111827] mb-8 md:mb-12 uppercase tracking-widest">Branch Revenue</h3>
               <div className="h-[220px] md:h-[250px] w-full">
                 <ResponsiveContainer width="100%" height="100%">
                   <BarChart data={branchRevenue} layout="vertical" margin={{ left: -10, right: 30 }}>
                      <XAxis type="number" domain={[0, 1500]} hide />
                      <YAxis type="category" dataKey="branch" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10, fontWeight: 'bold' }} width={70} />
                      <Tooltip cursor={{ fill: '#f8fafc' }} />
                      <Bar dataKey="revenue" radius={[0, 4, 4, 0]} barSize={16}>
                        {branchRevenue.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={index === 0 ? '#1e3a8a' : index === 1 ? '#3b82f6' : '#93c5fd'} />
                        ))}
                      </Bar>
                   </BarChart>
                 </ResponsiveContainer>
               </div>
            </div>

            <div className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 p-6 md:p-8 shadow-sm">
               <h3 className="text-sm md:text-base font-black text-[#111827] mb-8 md:mb-12 uppercase tracking-widest">Monthly Trend</h3>
               <div className="h-[220px] md:h-[250px] w-full">
                 <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyCollection} margin={{ left: -25, right: 10 }}>
                      <defs>
                        <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#1e3a8a" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#1e3a8a" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} domain={[0, 600]} ticks={[0, 200, 400, 600]} tickFormatter={(val) => `$${val}k`} />
                      <Tooltip />
                      <Area type="monotone" dataKey="amount" stroke="#1e3a8a" strokeWidth={2.5} fillOpacity={1} fill="url(#colorAmount)" dot={{ r: 4, fill: "#1e3a8a", strokeWidth: 2, stroke: "#fff" }} />
                    </AreaChart>
                 </ResponsiveContainer>
               </div>
            </div>

            <div className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 p-6 md:p-8 shadow-sm">
               <h3 className="text-sm md:text-base font-black text-[#111827] mb-8 uppercase tracking-widest text-center md:text-left">Modes</h3>
               <div className="h-[220px] md:h-[280px] w-full">
                 <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={paymentModes}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={2}
                        dataKey="value"
                        labelLine={false}
                        label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
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

          <div className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 md:p-10 border-b border-slate-50 flex items-center justify-between">
              <h3 className="text-base md:text-xl font-black text-[#111827] uppercase tracking-widest">Recent Transactions</h3>
              <Button variant="ghost" onClick={() => setActiveTab("History")} className="h-9 md:h-10 text-blue-600 font-black text-[10px] md:text-xs uppercase tracking-widest hover:bg-blue-50">View All</Button>
            </div>
            <div className="overflow-x-auto pb-4">
              <table className="w-full text-left min-w-[700px]">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                    <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Student</th>
                    <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest hidden md:table-cell">Branch</th>
                    <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</th>
                    <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest hidden sm:table-cell">Mode</th>
                    <th className="py-5 px-6 md:px-10 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {recentTransactions.map((t, i) => (
                    <tr key={i} className="hover:bg-slate-50/30 transition-colors group cursor-pointer">
                      <td className="py-5 px-6 md:px-10 text-slate-500 font-bold text-[11px] md:text-xs uppercase tabular-nums">{t.date}</td>
                      <td className="py-5 px-6 md:px-10">
                        <p className="font-black text-[#111827] text-xs md:text-sm tracking-tight group-hover:text-blue-600 transition-colors">{t.student}</p>
                      </td>
                      <td className="py-5 px-6 md:px-10 text-slate-500 text-[11px] md:text-xs font-bold hidden md:table-cell uppercase tabular-nums">{t.branch}</td>
                      <td className="py-5 px-6 md:px-10 font-black text-[#111827] text-xs md:text-sm tabular-nums">{t.amount}</td>
                      <td className="py-5 px-6 md:px-10 text-slate-500 text-[11px] md:text-xs font-bold hidden sm:table-cell uppercase tabular-nums">{t.mode}</td>
                      <td className="py-5 px-6 md:px-10">
                        <span className={`text-[10px] md:text-xs font-black uppercase tracking-widest ${
                          t.status === "Paid" ? "text-slate-800" : "text-amber-600"
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
