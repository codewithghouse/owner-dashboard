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
import { fetchRisksOverview, RisksData, AlertItem } from "@/lib/risksService";
import { auth, db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_GOLD, GRAD_RED,
  SHADOW_SM, SHADOW_LG, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, Card3D, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";

export default function RisksAlerts() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const pageShellStyle = usePageShellStyle();
  const [selectedBranchId, setSelectedBranchId] = useState<string>("all");
  // Severity drill-down filter. Clicking a stat tile (Active Alerts /
  // Critical / Warnings / Resolved) toggles this filter — clicking the same
  // tile a second time clears it. Single-source-of-truth pattern: this one
  // string drives both card-highlighting AND list-filtering below.
  type SeverityFilter = "all" | "critical" | "warning" | "resolved";
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [branches, setBranches] = useState<{id: string, name: string}[]>([]);
  const [data, setData] = useState<RisksData | null>(null);
  const [loading, setLoading] = useState(true);
  /* refreshKey bumps on Retry click. Keeping this separate from selectedBranchId
     so a same-value retry still triggers the load useEffect. */
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const loadBranches = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        const branchesSnap = await getDocs(collection(db, "schools", uid, "branches"));
        // Dedup by normalized (name + id) — Firestore can carry duplicate
        // branch docs if the owner accidentally re-created a branch with
        // the same name, OR if a cascade write created a parallel doc.
        // Dropdown was showing the same name twice; this collapses them.
        // Time: O(n) where n = branches count (typically < 20).
        const seen = new Set<string>();
        const bList = branchesSnap.docs
          .map(d => ({
            id: (d.data().branchId || d.id) as string,
            name: (d.data().name || d.data().schoolName || "Branch") as string,
          }))
          .filter(b => {
            // Composite dedup key — case-insensitive name + id. Two docs
            // with the same name AND id collapse into one; same name but
            // different ids remain (legitimately distinct branches).
            const key = `${b.name.trim().toLowerCase()}::${b.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        // Second-pass dedup by name only — handles the case where the
        // SAME branch was created twice with different auto-ids but same
        // human-readable name (most common user-reported duplicate cause).
        const byName = new Map<string, { id: string; name: string }>();
        bList.forEach(b => {
          const nameKey = b.name.trim().toLowerCase();
          if (!byName.has(nameKey)) byName.set(nameKey, b);
        });
        setBranches(Array.from(byName.values()));
      } catch (err) {
        /* Without this catch, a permission/network failure leaves branches []
           silently — dropdown only shows "All Branches" with no diagnostic. */
        console.error("[RisksAlerts] branches fetch failed:", err);
      }
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
  }, [selectedBranchId, refreshKey]);

  /* Pick the icon from the alertId prefix — canonical source from risksService.
     Was previously matched by `title.toLowerCase().includes("...")`, which
     broke the moment a copy edit changed wording (e.g. "Attendance Drop" →
     "Roll-call Deficit" would silently lose the GraduationCap icon).
     Falls back to the old title heuristic for legacy or unknown ids so we
     don't regress on alerts created before this change. */
  const getAlertIcon = (alert: AlertItem) => {
    const id = alert.id || "";
    if (id.startsWith("crit-"))  return GraduationCap; // attendance drop
    if (id.startsWith("warn-"))  return GraduationCap; // attendance monitoring
    if (id.startsWith("score-")) return FileText;      // academic underperformance
    const t = (alert.title || "").toLowerCase();
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
        <p style={{ fontSize:10, fontWeight:800, color:T3, letterSpacing:"0.14em", textTransform:"uppercase" }}>Aggregating Global Risk Data...</p>
      </div>
    );
  }

  /* Guard: fetchRisksOverview can throw (Firestore rules deny, network blip).
     The catch on line 53 sets loading=false but leaves data=null — without
     this guard the next line's `data!` non-null assertion crashes the page
     with "Cannot read properties of null". Show a graceful retry UI instead. */
  if (!data) {
    return (
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14, padding:"40px 20px", textAlign:"center" }}>
        <div style={{ width:56, height:56, borderRadius:16, background:"rgba(255,51,85,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <AlertOctagon size={28} color={RED} strokeWidth={2.2}/>
        </div>
        <p style={{ fontSize:13, fontWeight:800, color:T1, margin:0 }}>Could not load risk data</p>
        <p style={{ fontSize:11, fontWeight:500, color:T3, margin:0, maxWidth:340 }}>
          Either Firestore is unreachable or your account lacks permission. Check your network or contact support.
        </p>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          style={{
            padding:"9px 18px", borderRadius:11,
            background:GRAD_PRIMARY, color:"#fff",
            fontSize:10, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
            border:"none", cursor:"pointer", boxShadow:SHADOW_BTN,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const activeData = data;
  const criticalCount = activeData.stats.find(s => s.label.toLowerCase().includes("critical"))?.value ?? "—";
  const totalAlerts   = activeData.alerts.filter(a => a.id !== "no-alerts").length;
  const hasCritical   = activeData.alerts.some(a => a.type === "critical");

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 16 : 24 }}>

        <PageHead
          icon={ShieldAlert}
          title="Risks & Alerts"
          subtitle="Early warning system & risk monitoring"
          right={
            <div style={{ display:"flex", alignItems:"center", gap:8, width: isMobile ? "100%" : "auto" }}>
              {!isMobile && (
                <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:10, fontWeight:800, color:T3, letterSpacing:"0.12em", textTransform:"uppercase" }}>
                  <Filter size={12}/> Branch
                </div>
              )}
              <div style={{ position:"relative", width: isMobile ? "100%" : "auto" }}>
                <Building2 size={13} color={T4} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}/>
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  style={{
                    appearance:"none", padding:"10px 34px 10px 34px",
                    borderRadius:12, border:"0.5px solid rgba(0,85,255,.12)",
                    background:"#fff", boxShadow:SHADOW_SM,
                    fontSize:12, fontWeight:700, color:T3,
                    outline:"none", fontFamily:"inherit", cursor:"pointer",
                    width: isMobile ? "100%" : "auto",
                    minWidth: isMobile ? 0 : 160,
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

        {/* Mapping issue banner — surfaced from risksService when student→branch
            attribution is broken. Risk counts are computed off this attribution,
            so a broken mapping silently distorts every metric on this page. */}
        {activeData.mappingIssue && (
          <div
            style={{
              borderRadius: isMobile ? 14 : 16,
              padding: isMobile ? "12px 14px" : "14px 18px",
              display:"flex", alignItems:"flex-start", gap:12,
              background: activeData.mappingIssue.fallbackTriggered
                ? "rgba(255,51,85,0.08)"
                : "rgba(255,170,0,0.08)",
              border: activeData.mappingIssue.fallbackTriggered
                ? "0.5px solid rgba(255,51,85,0.3)"
                : "0.5px solid rgba(255,170,0,0.3)",
            }}
          >
            <AlertTriangle
              size={isMobile ? 18 : 20}
              color={activeData.mappingIssue.fallbackTriggered ? RED : GOLD}
              style={{ flexShrink:0, marginTop:2 }}
              strokeWidth={2.2}
            />
            <div style={{ minWidth:0, flex:1 }}>
              <p style={{
                fontSize: isMobile ? 11 : 12, fontWeight:800,
                color: activeData.mappingIssue.fallbackTriggered ? "#991B1B" : "#92400E",
                margin:"0 0 4px 0",
                letterSpacing:"0.06em", textTransform:"uppercase",
              }}>
                {activeData.mappingIssue.fallbackTriggered
                  ? "Risk attribution may be incorrect"
                  : `${activeData.mappingIssue.unmapped} of ${activeData.mappingIssue.total} students unmapped`}
              </p>
              <p style={{
                fontSize: isMobile ? 10 : 11, fontWeight:500,
                color: activeData.mappingIssue.fallbackTriggered ? "#7F1D1D" : "#78350F",
                margin:0, lineHeight:1.5,
              }}>
                {activeData.mappingIssue.fallbackTriggered
                  ? `No students could be matched to any branch via branchId/schoolId, so all ${activeData.mappingIssue.total.toLocaleString()} are temporarily attributed to one branch. Risk counts shown here may not reflect reality. Update student records with valid branchId values to fix.`
                  : `These students have no branchId/schoolId field that matches a known branch — they are excluded from risk calculations. Update their records to restore accurate risk attribution.`}
              </p>
            </div>
          </div>
        )}

        {/* Bright Stat Grid */}
        <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16 }}>
          {activeData.stats.map((stat, i) => {
            const labelLower = stat.label.toLowerCase();
            // Map this stat tile to a severity filter value. The "Active
            // Alerts" tile is the umbrella → maps to "all" (clears filter).
            // The other three drill into a specific severity.
            const isAlert = labelLower.includes("critical");
            const isActive = labelLower.includes("active");
            const isWarn = labelLower.includes("warning");
            const isGood = labelLower.includes("resolved");
            const filterKey: SeverityFilter =
              isAlert ? "critical"
              : isWarn ? "warning"
              : isGood ? "resolved"
              : "all"; // Active Alerts = all
            const grad = isAlert ? GRAD_RED : isWarn ? GRAD_GOLD : isGood ? GRAD_GREEN : GRAD_BLUE;
            const iconMap = isAlert ? AlertTriangle : isWarn ? ShieldAlert : isGood ? CheckCircle2 : Activity;
            const isActiveFilter = severityFilter === filterKey && filterKey !== "all";
            const outlineColor = isAlert ? RED : isWarn ? GOLD : isGood ? GREEN : B1;
            const handleTileClick = () => {
              if (filterKey === "all") {
                setSeverityFilter("all");
              } else if (severityFilter === filterKey) {
                setSeverityFilter("all"); // toggle off
              } else {
                setSeverityFilter(filterKey);
              }
              setTimeout(() => {
                document.getElementById("risks-alerts-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }, 50);
            };
            return (
              // Wrapper div carries the active-filter visual signal because
              // StatTile doesn't expose a `style` prop. Border ring + ring
              // offset matches the standard click-affordance.
              <div
                key={i}
                style={{
                  borderRadius: isMobile ? 18 : 24,
                  padding: 2,
                  background: isActiveFilter ? outlineColor : "transparent",
                  transition: "background 160ms ease",
                }}
              >
                <StatTile
                  label={stat.label}
                  value={stat.value as any}
                  sub={isActiveFilter ? `✓ Showing only ${filterKey}` : stat.change}
                  grad={grad}
                  icon={iconMap}
                  onClick={handleTileClick}
                />
              </div>
            );
          })}
        </div>

        {/* Charts Row */}
        <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 12 : 16 }}>
          <Card3D padding={isMobile ? "16px 14px" : "22px 24px"}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 10 : 14 }}>
              <div style={{ minWidth:0 }}>
                <h3 style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Risk Distribution</h3>
                <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T3, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>By category</p>
              </div>
              <div style={{ width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius:10, background:"rgba(0,85,255,.08)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <BarChart3 size={isMobile ? 14 : 16} color={B1} strokeWidth={2.3}/>
              </div>
            </div>
            <div style={{ height: isMobile ? 220 : 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={activeData.distribution.length ? activeData.distribution : [{ name:"No Data", value:1, fill:"#e2e8f0" }]}
                    cx="50%" cy="50%"
                    innerRadius={isMobile ? 42 : 50} outerRadius={isMobile ? 66 : 80}
                    paddingAngle={3}
                    dataKey="value"
                    label={isMobile ? false : ({ cx, cy, midAngle, outerRadius, value, name }: any) => {
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
                  {isMobile && <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize:10, fontWeight:700, paddingTop:4 }}/>}
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card3D>

          <Card3D padding={isMobile ? "16px 14px" : "22px 24px"}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 10 : 14 }}>
              <div style={{ minWidth:0 }}>
                <h3 style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Risk Trend</h3>
                <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T3, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Critical vs Warning</p>
              </div>
              <div style={{ width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius:10, background:"rgba(255,51,85,.1)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <TrendingUp size={isMobile ? 14 : 16} color={RED} strokeWidth={2.3}/>
              </div>
            </div>
            <div style={{ height: isMobile ? 240 : 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activeData.trend} margin={{ left: isMobile ? -12 : -20, right: isMobile ? 10 : 10, top:5, bottom: isMobile ? 6 : 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill:T3, fontSize: isMobile ? 10 : 11, fontWeight:700 }} dy={8}/>
                  <YAxis axisLine={false} tickLine={false} tick={{ fill:T3, fontSize: isMobile ? 9 : 11, fontWeight:700 }} width={isMobile ? 30 : 40} allowDecimals={false}/>
                  <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }}/>
                  <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: isMobile ? 10 : 11, fontWeight:700, paddingTop:4 }}/>
                  <Line type="monotone" dataKey="critical" name="Critical" stroke={RED} strokeWidth={isMobile ? 2.5 : 3}
                    dot={{ r: isMobile ? 3 : 4, fill:"#fff", strokeWidth:2, stroke:RED }} activeDot={{ r:6 }}/>
                  <Line type="monotone" dataKey="warning" name="Warning" stroke={GOLD} strokeWidth={isMobile ? 2.5 : 3}
                    dot={{ r: isMobile ? 3 : 4, fill:"#fff", strokeWidth:2, stroke:GOLD }} activeDot={{ r:6 }}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card3D>

          <Card3D padding={isMobile ? "16px 14px" : "22px 24px"}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 10 : 14 }}>
              <div style={{ minWidth:0 }}>
                <h3 style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Branch-wise Risk</h3>
                <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T3, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Risk volume</p>
              </div>
              <div style={{ width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius:10, background:"rgba(0,200,83,.1)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <Building2 size={isMobile ? 14 : 16} color={GREEN} strokeWidth={2.3}/>
              </div>
            </div>
            {(() => {
              const branchCount = activeData.branchRisks.length;
              const mobileMin = Math.max(320, branchCount * 72);
              return (
                <div style={{ overflowX: isMobile ? "auto" : "visible", WebkitOverflowScrolling:"touch", paddingBottom: isMobile ? 4 : 0 }}>
                  <div style={{ height: isMobile ? 240 : 240, minWidth: isMobile ? mobileMin : "100%" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={activeData.branchRisks} margin={{ top: 8, right: isMobile ? 8 : 10, bottom: isMobile ? 20 : 10, left: isMobile ? -14 : 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill:T3, fontSize: isMobile ? 10 : 11, fontWeight:700 }} dy={8} interval={0}/>
                        <YAxis axisLine={false} tickLine={false} tick={{ fill:T3, fontSize: isMobile ? 9 : 11, fontWeight:700 }} width={isMobile ? 30 : 40} allowDecimals={false}/>
                        <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }} cursor={{ fill:"rgba(0,85,255,.04)" }}/>
                        <Bar dataKey="value" radius={[6,6,0,0]} barSize={isMobile ? 28 : 36}
                          label={{ position:"top", fill:T3, fontSize: isMobile ? 10 : 11, fontWeight:800 }}>
                          {activeData.branchRisks.map((e, i) => <Cell key={i} fill={e.color}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })()}
          </Card3D>
        </div>

        {/* Active Alerts List */}
        <div
          id="risks-alerts-list"
          style={{
            background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px" : "22px 26px",
            boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
          }}
        >
          {/* Apply severity filter from the clicked stat tile.
              Note: AlertItem.type uses "critical" | "warning" | other; we
              treat "resolved" as alerts whose status field signals resolved.
              Single source of truth for the visible alert set so the count
              chip + heading match the rendered list exactly. */}
          {(() => {
            const baseList = activeData.alerts.filter(a => a.id !== "no-alerts");
            const filteredList = severityFilter === "all"
              ? baseList
              : severityFilter === "resolved"
                ? baseList.filter(a => /resolv/i.test(String(a.status || "")))
                : baseList.filter(a => a.type === severityFilter);
            const filterLabel = severityFilter === "all" ? "All severities"
              : severityFilter === "critical" ? "Critical only"
              : severityFilter === "warning" ? "Warnings only"
              : "Resolved only";
            return (
              <>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 14 : 18, gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, minWidth:0 }}>
                    <div style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius:11, background:GRAD_PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 6px 14px rgba(0,85,255,.28)", flexShrink:0 }}>
                      <AlertOctagon size={isMobile ? 16 : 18} color="#fff" strokeWidth={2.3}/>
                    </div>
                    <div style={{ minWidth:0 }}>
                      <h3 style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>
                        Active Alerts
                      </h3>
                      <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T3, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>
                        {filteredList.length} of {totalAlerts} · {filterLabel}
                      </p>
                    </div>
                  </div>
                  {severityFilter !== "all" && (
                    <button
                      type="button"
                      onClick={() => setSeverityFilter("all")}
                      style={{
                        padding: "7px 14px", borderRadius: 999,
                        background: "rgba(0,85,255,0.08)",
                        color: B1, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                        border: "0.5px solid rgba(0,85,255,0.20)",
                        cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      Clear filter ×
                    </button>
                  )}
                </div>

                {baseList.length === 0 ? (
                  <div style={{ padding: isMobile ? "36px 0" : "48px 0", display:"flex", flexDirection:"column", alignItems:"center", gap: isMobile ? 10 : 12 }}>
                    <div style={{ width: isMobile ? 56 : 68, height: isMobile ? 56 : 68, borderRadius: isMobile ? 16 : 20, background:"rgba(0,200,83,.12)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <CheckCircle2 size={isMobile ? 28 : 34} color={GREEN} strokeWidth={2.2}/>
                    </div>
                    <p style={{ fontSize: isMobile ? 12 : 13, fontWeight:800, color:GREEN, margin:0, letterSpacing:"0.04em", textAlign:"center" }}>Great! No active alerts found</p>
                    <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:500, color:T3, margin:0, textAlign:"center", padding:"0 12px" }}>All systems healthy across branches</p>
                  </div>
                ) : filteredList.length === 0 ? (
                  <div style={{ padding: isMobile ? "30px 12px" : "40px 16px", display:"flex", flexDirection:"column", alignItems:"center", gap: 8, textAlign: "center" }}>
                    <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(0,85,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Filter size={20} color={B1} strokeWidth={2.2}/>
                    </div>
                    <p style={{ fontSize: 12, fontWeight: 700, color: T1, margin: 0 }}>No {severityFilter} alerts to show</p>
                    <p style={{ fontSize: 11, color: T3, margin: 0 }}>Tap a different stat tile above or clear the filter.</p>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap: isMobile ? 10 : 12 }}>
                    {filteredList.map(alert => {
                const Icon = getAlertIcon(alert);
                const accentGrad = alert.type === "critical" ? GRAD_RED : alert.type === "warning" ? GRAD_GOLD : GRAD_BLUE;
                const accentColor = alert.type === "critical" ? RED : alert.type === "warning" ? GOLD : B1;
                const accentBg = alert.type === "critical" ? "rgba(255,51,85,.06)" : alert.type === "warning" ? "rgba(255,170,0,.06)" : "rgba(0,85,255,.05)";
                return (
                  <div
                    key={alert.id}
                    onClick={() => navigate(`/risks/${alert.id}`)}
                    className="dash-card"
                    style={{
                      background:accentBg, borderRadius: isMobile ? 14 : 16,
                      border:`0.5px solid ${accentColor}22`,
                      padding: isMobile ? "14px 14px" : "16px 18px", cursor:"pointer",
                      position:"relative", overflow:"hidden",
                    }}
                  >
                    <div style={{ position:"absolute", left:0, top:0, bottom:0, width: isMobile ? 4 : 5, background:accentGrad }}/>
                    {isMobile ? (
                      <div style={{ paddingLeft:8, display:"flex", flexDirection:"column", gap:10 }}>
                        <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
                          <div style={{
                            width:38, height:38, borderRadius:11, background:accentGrad,
                            display:"flex", alignItems:"center", justifyContent:"center",
                            color:"#fff", flexShrink:0,
                            boxShadow:`0 6px 14px ${accentColor}33`,
                          }}>
                            <Icon size={18} strokeWidth={2.3}/>
                          </div>
                          <div style={{ minWidth:0, flex:1 }}>
                            <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:6, marginBottom:4 }}>
                              <h4 style={{ fontSize:13, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.2px" }}>{alert.title}</h4>
                              <span style={{
                                fontSize:8, fontWeight:800, padding:"3px 8px", borderRadius:999,
                                background:accentGrad, color:"#fff",
                                letterSpacing:"0.12em", textTransform:"uppercase",
                              }}>
                                {alert.status}
                              </span>
                            </div>
                            <p style={{ fontSize:11, fontWeight:500, color:T3, margin:0, lineHeight:1.5 }}>
                              {alert.desc}
                              {alert.timing && <span style={{ color:T3 }}> · {alert.timing}</span>}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/risks/${alert.id}`); }}
                          className="dash-btn"
                          style={{
                            padding:"10px 14px", borderRadius:11,
                            background:GRAD_PRIMARY, color:"#fff",
                            fontSize:10, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
                            border:"none", cursor:"pointer", fontFamily:"inherit",
                            boxShadow:SHADOW_BTN, display:"inline-flex", alignItems:"center", justifyContent:"center", gap:5,
                            width:"100%",
                          }}
                        >
                          View Details <ChevronRight size={12}/>
                        </button>
                      </div>
                    ) : (
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
                              {alert.timing && <span style={{ color:T3 }}> · {alert.timing}</span>}
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
                    )}
                  </div>
                );
              })}
                  </div>
                )}
              </>
            );
          })()}
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