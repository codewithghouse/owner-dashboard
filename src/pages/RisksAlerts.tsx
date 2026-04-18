import { useState, useEffect } from "react";
import { DollarSign, GraduationCap, FileText, AlertOctagon, CheckCircle2, Filter } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, BarChart, Bar } from "recharts";
import { useNavigate } from "react-router-dom";
import { fetchRisksOverview, RisksData } from "@/lib/risksService";
import { auth, db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";

export default function RisksAlerts() {
  const navigate = useNavigate();
  const [selectedBranchId, setSelectedBranchId] = useState<string>("all");
  const [branches, setBranches] = useState<{id: string, name: string}[]>([]);
  const [data, setData] = useState<RisksData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadBranches = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const branchesSnap = await getDocs(collection(db, "schools", uid, "branches"));
      const bList = branchesSnap.docs.map(d => ({
        id: d.data().branchId || d.id,
        name: d.data().name || d.data().schoolName || "Branch"
      }));
      setBranches(bList);
    };
    loadBranches();
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const result = await fetchRisksOverview(selectedBranchId);
        setData(result);
      } catch (err) {
        console.error("Error loading risks data:", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedBranchId]);

  const getAlertIcon = (title: string) => {
    const t = title.toLowerCase();
    if (t.includes("attendance")) return <GraduationCap className="w-6 h-6" />;
    if (t.includes("fee") || t.includes("finance")) return <DollarSign className="w-6 h-6" />;
    if (t.includes("performance") || t.includes("score")) return <FileText className="w-6 h-6" />;
    return <AlertOctagon className="w-6 h-6" />;
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-slate-900 mb-4"></div>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Aggregating Global Risk Data...</p>
      </div>
    );
  }

  const activeData = data!;

  return (
    <div className="space-y-10 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">
      {/* Header & Filter */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#111827] tracking-tight">Risks & Alerts</h1>
          <p className="text-slate-400 font-medium text-xs md:text-sm">Early warning system & risk monitoring</p>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 bg-white p-2 rounded-2xl border border-slate-100 shadow-sm w-full md:w-auto overflow-hidden">
          <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 border-r border-slate-50 shrink-0">
             <Filter className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
             <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-tight whitespace-nowrap">Filter Branch</span>
          </div>
          <select 
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="flex-1 px-3 sm:px-4 py-2 bg-transparent text-xs sm:text-sm font-bold text-slate-800 outline-none cursor-pointer hover:text-[#1e3a8a] transition-colors appearance-none min-w-[120px]"
          >
            <option value="all">All Branches</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {activeData.stats.map((stat, i) => (
          <div
            key={i}
            onClick={() => navigate("/risks")}
            role="button"
            tabIndex={0}
            className="clickable-card bg-white p-6 md:p-8 rounded-[1.5rem] md:rounded-[2rem] border border-slate-100 shadow-sm transition-all hover:shadow-md"
          >
            <p className="text-slate-400 text-[10px] md:text-xs font-bold uppercase tracking-tight mb-3 md:mb-4">{stat.label}</p>
            <h3 className="text-3xl md:text-4xl font-extrabold text-[#111827] tracking-tighter mb-1 md:mb-2">{stat.value}</h3>
            <p className={`text-[10px] md:text-[11px] font-bold ${stat.col}`}>{stat.change}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Distribution */}
        <div className="bg-white rounded-[2rem] md:rounded-[2.5rem] border border-slate-100 p-6 md:p-8 shadow-sm">
           <h3 className="text-base md:text-lg font-bold text-[#111827] mb-6 md:mb-8">Risk Distribution</h3>
           <div className="h-[250px] md:h-[280px] w-full">
             <ResponsiveContainer width="100%" height="100%">
                 <PieChart>
                   <Pie
                     data={activeData.distribution}
                     cx="50%"
                     cy="50%"
                     innerRadius={60}
                     outerRadius={85}
                     paddingAngle={2}
                     dataKey="value"
                     labelLine={true}
                     label={({ cx, cy, midAngle, outerRadius, value, name }: any) => {
                       const RADIAN = Math.PI / 180;
                       const radius = outerRadius + 20;
                       const x = cx + radius * Math.cos(-midAngle * RADIAN);
                       const y = cy + radius * Math.sin(-midAngle * RADIAN);
                       return (
                         <text x={x} y={y} fill="#64748b" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" className="text-[10px] font-bold uppercase">
                           {name} ({value})
                         </text>
                       );
                     }}
                   >
                     {activeData.distribution.map((entry, index) => (
                       <Cell key={`cell-${index}`} fill={entry.fill} stroke="none" />
                     ))}
                   </Pie>
                   <Tooltip />
                 </PieChart>
             </ResponsiveContainer>
           </div>
        </div>

        {/* Risk Trend */}
        <div className="bg-white rounded-[2rem] md:rounded-[2.5rem] border border-slate-100 p-6 md:p-8 shadow-sm">
           <h3 className="text-base md:text-lg font-bold text-[#111827] mb-10 md:mb-12">Risk Trend</h3>
           <div className="h-[250px] w-full">
             <ResponsiveContainer width="100%" height="100%">
               <LineChart data={activeData.trend} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={{ stroke: '#94a3b8' }} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} />
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
        <div className="bg-white rounded-[2rem] md:rounded-[2.5rem] border border-slate-100 p-6 md:p-8 shadow-sm">
           <h3 className="text-base md:text-lg font-bold text-[#111827] mb-10 md:mb-12">Branch-wise Risk</h3>
           <div className="h-[250px] w-full">
             <ResponsiveContainer width="100%" height="100%">
               <BarChart data={activeData.branchRisks} margin={{ bottom: 10 }}>
                  <XAxis dataKey="name" axisLine={{ stroke: '#94a3b8' }} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={40}>
                    {activeData.branchRisks.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
               </BarChart>
             </ResponsiveContainer>
           </div>
        </div>
      </div>

      {/* Active Alerts List */}
      <div className="bg-white rounded-[2rem] md:rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden p-6 md:p-10 lg:p-14">
        <h3 className="text-lg md:text-xl font-extrabold text-[#111827] mb-8 md:mb-12 uppercase tracking-wide">Active Alerts</h3>
        <div className="space-y-6">
          {activeData.alerts.length === 0 || (activeData.alerts.length === 1 && activeData.alerts[0].id === 'no-alerts') ? (
            <div className="py-12 md:py-20 flex flex-col items-center justify-center text-center">
              <CheckCircle2 className="w-12 h-12 md:w-16 md:h-16 text-emerald-500 mb-4 md:mb-6 opacity-20" />
              <p className="text-[11px] md:text-sm font-black text-slate-400 uppercase tracking-widest">Great! No active alerts found</p>
            </div>
          ) : (
            activeData.alerts.filter(a => a.id !== 'no-alerts').map((alert) => {
              const accentBg    = alert.type === 'critical' ? 'bg-[#fef2f2]' : alert.type === 'warning' ? 'bg-[#fffbeb]' : 'bg-[#f0f9ff]';
              const accentBar   = alert.type === 'critical' ? 'bg-[#ef4444]' : alert.type === 'warning' ? 'bg-[#f59e0b]' : 'bg-[#0ea5e9]';
              const accentIcon  = alert.type === 'critical' ? 'bg-[#ef4444]' : alert.type === 'warning' ? 'bg-[#f59e0b]' : 'bg-[#0ea5e9]';
              const badgeBg     = alert.type === 'critical' ? 'bg-[#ef4444]' : alert.type === 'warning' ? 'bg-[#f59e0b]' : 'bg-[#0ea5e9]';

              return (
                <div
                  key={alert.id}
                  onClick={() => navigate(`/risks/${alert.id}`)}
                  role="button"
                  tabIndex={0}
                  className={`clickable-card p-5 md:p-6 rounded-2xl relative overflow-hidden transition-all hover:-translate-y-0.5 duration-300 shadow-sm border ${alert.type === 'critical' ? 'border-red-100' : alert.type === 'warning' ? 'border-amber-100' : 'border-sky-100'} ${accentBg}`}
                >
                  <div className={`absolute top-0 left-0 w-1 h-full ${accentBar}`} />
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pl-3">
                    <div className="flex items-start gap-4">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 ${accentIcon}`}>
                        {getAlertIcon(alert.title)}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h4 className="text-base font-bold text-[#1e294b] tracking-tight">{alert.title}</h4>
                          <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold text-white ${badgeBg}`}>
                            {alert.status}
                          </span>
                        </div>
                        <p className="text-slate-500 text-sm leading-snug">
                          {alert.desc}
                          {alert.timing && (
                            <span className="text-slate-400"> • {alert.timing}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/risks/${alert.id}`); }}
                      className="shrink-0 px-5 py-2 bg-[#1e294b] text-white text-xs font-bold rounded-xl hover:bg-[#1e3a8a] transition-colors shadow-sm"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
