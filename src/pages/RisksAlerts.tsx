import { useState, useEffect } from "react";
import {
  DollarSign, GraduationCap, FileText, AlertOctagon, CheckCircle2, Filter,
  AlertTriangle, ShieldAlert, ChevronDown, ChevronRight, TrendingUp,
  BarChart3, Building2, Activity, Sparkles,
} from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, BarChart, Bar,
} from "recharts";
import { useNavigate } from "react-router-dom";
import { fetchRisksOverview, RisksData } from "@/lib/risksService";
import { auth, db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_GOLD, GRAD_RED,
  SHADOW_SM, SHADOW_LG, SHADOW_BTN, pageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, Card3D, AIInsightCard,
} from "@/lib/dashboardTokens";

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
        name: d.data().name || d.data().schoolName || "Branch",
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
    if (t.includes("attendance")) return GraduationCap;
    if (t.includes("fee") || t.includes("finance")) return DollarSign;
    if (t.includes("performance") || t.includes("score")) return FileText;
    return AlertOctagon;
  };

  if (loading && !data) {
    return (
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14 }}>
        <div style={{ width:44, height:44, borderRadius:"50%", border:`3px solid rgba(0,85,255,.2)`, borderTopColor:B1, animation:"spin 1s linear infinite" }}/>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <p style={{ fontSize:10, fontWeight:800, color:T4, letterSpacing:"0.14em", textTransform:"uppercase" }}>Aggregating Global Risk Data...</p>
      </div>
    );
  }

  const activeData = data!;
  const criticalCount = activeData.stats.find(s => s.label.toLowerCase().includes("critical"))?.value ?? "—";
  const totalAlerts   = activeData.alerts.filter(a => a.id !== "no-alerts").length;
  const hasCritical   = activeData.alerts.some(a => a.type === "critical");

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap:24 }}>

        <PageHead
          icon={ShieldAlert}
          title="Risks & Alerts"
          subtitle="Early warning system & risk monitoring"
          right={
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:10, fontWeight:800, color:T4, letterSpacing:"0.12em", textTransform:"uppercase" }}>
                <Filter size={12}/> Branch
              </div>
              <div style={{ position:"relative" }}>
                <Building2 size={13} color={T4} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}/>
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  style={{
                    appearance:"none", padding:"10px 34px 10px 34px",
                    borderRadius:12, border:"0.5px solid rgba(0,85,255,.12)",
                    background:"#fff", boxShadow:SHADOW_SM,
                    fontSize:12, fontWeight:700, color:T3,
                    outline:"none", fontFamily:"inherit", cursor:"pointer", minWidth:160,
                  }}
                >
                  <option value="all">All Branches</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <ChevronDown size={13} color={T4} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}/>
              </div>
            </div>
          }
        />

        <DarkHero
          icon={AlertOctagon}
          eyebrow={<><Sparkles size={11} style={{ display:"inline", marginRight:4 }}/> Risk Intelligence</> as any}
          title={totalAlerts.toString()}
          subtitle={`Active alert${totalAlerts!==1?"s":""} tracked across ${selectedBranchId==="all" ? branches.length + " branches" : "selected branch"} · ${hasCritical ? "Immediate attention required" : "No critical alerts"}`}
          stats={activeData.stats.slice(0, 3).map(s => ({ label: s.label, value: s.value }))}
        />

        {/* Bright Stat Grid */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:16 }}>
          {activeData.stats.map((stat, i) => {
            const isAlert = stat.label.toLowerCase().includes("critical") || stat.label.toLowerCase().includes("alert");
            const isWarn = stat.label.toLowerCase().includes("warning");
            const isGood = stat.label.toLowerCase().includes("resolved");
            const grad = isAlert ? GRAD_RED : isWarn ? GRAD_GOLD : isGood ? GRAD_GREEN : GRAD_BLUE;
            const iconMap = isAlert ? AlertTriangle : isWarn ? ShieldAlert : isGood ? CheckCircle2 : Activity;
            return (
              <StatTile
                key={i}
                label={stat.label}
                value={stat.value as any}
                sub={stat.change}
                grad={grad}
                icon={iconMap}
                onClick={() => navigate("/risks")}
              />
            );
          })}
        </div>

        {/* Charts Row */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:16 }}>
          <Card3D>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <div>
                <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Risk Distribution</h3>
                <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>By category</p>
              </div>
              <div style={{ width:32, height:32, borderRadius:10, background:"rgba(0,85,255,.08)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <BarChart3 size={16} color={B1} strokeWidth={2.3}/>
              </div>
            </div>
            <div style={{ height:240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={activeData.distribution.length ? activeData.distribution : [{ name:"No Data", value:1, fill:"#e2e8f0" }]}
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ cx, cy, midAngle, outerRadius, value, name }: any) => {
                      const R = Math.PI / 180;
                      const r = outerRadius + 18;
                      const x = cx + r * Math.cos(-midAngle * R);
                      const y = cy + r * Math.sin(-midAngle * R);
                      return (
                        <text x={x} y={y} fill={T3} fontSize={10} fontWeight={800}
                          textAnchor={x > cx ? "start" : "end"} dominantBaseline="central">
                          {name} ({value})
                        </text>
                      );
                    }}
                  >
                    {activeData.distribution.map((e, i) => <Cell key={i} fill={e.fill} stroke="none"/>)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card3D>

          <Card3D>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <div>
                <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Risk Trend</h3>
                <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Critical vs Warning</p>
              </div>
              <div style={{ width:32, height:32, borderRadius:10, background:"rgba(255,51,85,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <TrendingUp size={16} color={RED} strokeWidth={2.3}/>
              </div>
            </div>
            <div style={{ height:240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activeData.trend} margin={{ left:-20, right:10, top:5, bottom:10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill:T3, fontSize:11, fontWeight:700 }} dy={8}/>
                  <YAxis axisLine={false} tickLine={false} tick={{ fill:T3, fontSize:11, fontWeight:700 }}/>
                  <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }}/>
                  <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize:11, fontWeight:700, paddingTop:4 }}/>
                  <Line type="monotone" dataKey="critical" name="Critical" stroke={RED} strokeWidth={3}
                    dot={{ r:4, fill:"#fff", strokeWidth:2, stroke:RED }} activeDot={{ r:6 }}/>
                  <Line type="monotone" dataKey="warning" name="Warning" stroke={GOLD} strokeWidth={3}
                    dot={{ r:4, fill:"#fff", strokeWidth:2, stroke:GOLD }} activeDot={{ r:6 }}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card3D>

          <Card3D>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <div>
                <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Branch-wise Risk</h3>
                <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Risk volume</p>
              </div>
              <div style={{ width:32, height:32, borderRadius:10, background:"rgba(0,200,83,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Building2 size={16} color={GREEN} strokeWidth={2.3}/>
              </div>
            </div>
            <div style={{ height:240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activeData.branchRisks} margin={{ bottom:10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill:T3, fontSize:11, fontWeight:700 }} dy={8}/>
                  <YAxis axisLine={false} tickLine={false} tick={{ fill:T3, fontSize:11, fontWeight:700 }}/>
                  <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }} cursor={{ fill:"rgba(0,85,255,.04)" }}/>
                  <Bar dataKey="value" radius={[6,6,0,0]} barSize={36}>
                    {activeData.branchRisks.map((e, i) => <Cell key={i} fill={e.color}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card3D>
        </div>

        {/* Active Alerts List */}
        <div
          style={{
            background:"#fff", borderRadius:22, padding:"22px 26px",
            boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
          }}
        >
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ width:36, height:36, borderRadius:11, background:GRAD_PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 6px 14px rgba(0,85,255,.28)" }}>
                <AlertOctagon size={18} color="#fff" strokeWidth={2.3}/>
              </div>
              <div>
                <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Active Alerts</h3>
                <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>{totalAlerts} total</p>
              </div>
            </div>
          </div>

          {activeData.alerts.length === 0 || (activeData.alerts.length === 1 && activeData.alerts[0].id === "no-alerts") ? (
            <div style={{ padding:"48px 0", display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
              <div style={{ width:68, height:68, borderRadius:20, background:"rgba(0,200,83,.12)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <CheckCircle2 size={34} color={GREEN} strokeWidth={2.2}/>
              </div>
              <p style={{ fontSize:13, fontWeight:800, color:GREEN, margin:0, letterSpacing:"0.04em" }}>Great! No active alerts found</p>
              <p style={{ fontSize:11, fontWeight:500, color:T4, margin:0 }}>All systems healthy across branches</p>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {activeData.alerts.filter(a => a.id !== "no-alerts").map(alert => {
                const Icon = getAlertIcon(alert.title);
                const accentGrad = alert.type === "critical" ? GRAD_RED : alert.type === "warning" ? GRAD_GOLD : GRAD_BLUE;
                const accentColor = alert.type === "critical" ? RED : alert.type === "warning" ? GOLD : B1;
                const accentBg = alert.type === "critical" ? "rgba(255,51,85,.06)" : alert.type === "warning" ? "rgba(255,170,0,.06)" : "rgba(0,85,255,.05)";
                return (
                  <div
                    key={alert.id}
                    onClick={() => navigate(`/risks/${alert.id}`)}
                    className="dash-card"
                    style={{
                      background:accentBg, borderRadius:16,
                      border:`0.5px solid ${accentColor}22`,
                      padding:"16px 18px", cursor:"pointer",
                      position:"relative", overflow:"hidden",
                    }}
                  >
                    <div style={{ position:"absolute", left:0, top:0, bottom:0, width:5, background:accentGrad }}/>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, paddingLeft:8 }}>
                      <div style={{ display:"flex", alignItems:"flex-start", gap:14, flex:1, minWidth:0 }}>
                        <div style={{
                          width:42, height:42, borderRadius:12, background:accentGrad,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          color:"#fff", flexShrink:0,
                          boxShadow:`0 6px 14px ${accentColor}33`,
                        }}>
                          <Icon size={20} strokeWidth={2.3}/>
                        </div>
                        <div style={{ minWidth:0, flex:1 }}>
                          <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:8, marginBottom:4 }}>
                            <h4 style={{ fontSize:14, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.2px" }}>{alert.title}</h4>
                            <span style={{
                              fontSize:9, fontWeight:800, padding:"3px 9px", borderRadius:999,
                              background:accentGrad, color:"#fff",
                              letterSpacing:"0.12em", textTransform:"uppercase",
                            }}>
                              {alert.status}
                            </span>
                          </div>
                          <p style={{ fontSize:12, fontWeight:500, color:T3, margin:0, lineHeight:1.5 }}>
                            {alert.desc}
                            {alert.timing && <span style={{ color:T4 }}> · {alert.timing}</span>}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/risks/${alert.id}`); }}
                        className="dash-btn"
                        style={{
                          padding:"9px 16px", borderRadius:11,
                          background:GRAD_PRIMARY, color:"#fff",
                          fontSize:10, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
                          border:"none", cursor:"pointer", fontFamily:"inherit",
                          boxShadow:SHADOW_BTN, flexShrink:0, display:"inline-flex", alignItems:"center", gap:5,
                        }}
                      >
                        View <ChevronRight size={12}/>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <AIInsightCard
          title="Risk Intelligence Summary"
          items={[
            { label:"Alert Volume",    value: totalAlerts > 0 ? `${totalAlerts} active` : "All clear", sub: hasCritical ? "Critical items present" : "No critical alerts" },
            { label:"Risk Focus",      value: typeof criticalCount === "string" ? criticalCount : `${criticalCount} critical`, sub: "Needs immediate action" },
            { label:"System Health",   value: hasCritical ? "Monitor closely" : totalAlerts > 0 ? "Stable with warnings" : "Healthy", sub: `${branches.length} branch${branches.length!==1?"es":""} tracked` },
          ]}
        />
      </div>
    </>
  );
}