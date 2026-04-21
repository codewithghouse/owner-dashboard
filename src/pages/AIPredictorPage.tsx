/**
 * AIPredictorPage.tsx
 * "AI-Powered Risk Predictor" — the standout feature.
 */
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import {
  Brain, AlertTriangle, TrendingDown, TrendingUp, Users,
  Search, ChevronDown, ChevronUp, RefreshCw, Share2,
  CheckCircle2, Check, Loader2, Minus,
  ShieldAlert, Eye, Sparkles,
} from "lucide-react";
import {
  fetchAllPredictions,
  StudentRiskPrediction,
  RiskLevel,
} from "@/lib/riskPredictorService";
import { toast } from "sonner";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD, VIOLET, ORANGE,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, GRAD_RED, GRAD_ORANGE,
  SHADOW_SM, SHADOW_LG, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, Card3D, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";

// ── Risk visual config ────────────────────────────────────────────────────────
const RISK_TIER: Record<RiskLevel, { label: string; grad: string; color: string; bg: string }> = {
  Critical: { label: "Critical Risk", grad: GRAD_RED,    color: RED,    bg: "rgba(255,51,85,.10)" },
  High:     { label: "High Risk",     grad: GRAD_ORANGE, color: ORANGE, bg: "rgba(255,136,0,.10)" },
  Watch:    { label: "Watch",         grad: GRAD_GOLD,   color: GOLD,   bg: "rgba(255,170,0,.10)" },
  Safe:     { label: "Safe",          grad: GRAD_GREEN,  color: GREEN,  bg: "rgba(0,200,83,.10)" },
};

const RISK_ICON: Record<RiskLevel, React.ElementType> = {
  Critical: ShieldAlert,
  High:     AlertTriangle,
  Watch:    Eye,
  Safe:     CheckCircle2,
};

function getInitials(name: string) {
  return (name || "?").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AIPredictorPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const pageShellStyle = usePageShellStyle();
  const [predictions, setPredictions] = useState<StudentRiskPrediction[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState("");
  const [filterLevel, setFilterLevel] = useState<RiskLevel | "All">("All");
  const [expanded,    setExpanded]    = useState<string | null>(null);
  const [copiedId,    setCopiedId]    = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const data = await fetchAllPredictions();
    setPredictions(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => ({
    total:    predictions.length,
    critical: predictions.filter(p => p.riskLevel === "Critical").length,
    high:     predictions.filter(p => p.riskLevel === "High").length,
    watch:    predictions.filter(p => p.riskLevel === "Watch").length,
    safe:     predictions.filter(p => p.riskLevel === "Safe").length,
  }), [predictions]);

  const filtered = useMemo(() => {
    let list = predictions;
    if (filterLevel !== "All") list = list.filter(p => p.riskLevel === filterLevel);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.studentName.toLowerCase().includes(q) ||
        p.branch.toLowerCase().includes(q) ||
        p.grade.toLowerCase().includes(q)
      );
    }
    return list;
  }, [predictions, filterLevel, search]);

  const generateParentLink = async (p: StudentRiskPrediction) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      const token  = crypto.randomUUID();
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);

      await addDoc(collection(db, "parent_tokens"), {
        token,
        studentId:   p.studentId,
        studentName: p.studentName,
        schoolId:    uid,
        branch:      p.branch,
        grade:       p.grade,
        attendance:  p.attendance,
        avgScore:    p.avgScore,
        recentScores: p.recentScores,
        feeDefaulted: p.feeDefaulted,
        failProbability: p.failProbability,
        riskLevel:   p.riskLevel,
        riskFactors: p.riskFactors,
        recommendation: p.recommendation,
        expiresAt:   expiry.toISOString(),
        createdAt:   serverTimestamp(),
      });

      const link = `${window.location.origin}/parent-portal?token=${token}`;
      await navigator.clipboard.writeText(link);
      setCopiedId(p.studentId);
      toast.success("Parent link copied to clipboard!");
      setTimeout(() => setCopiedId(null), 3000);
    } catch (err: any) {
      toast.error("Failed to generate link: " + err.message);
    }
  };

  if (loading) {
    return (
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14 }}>
        <div style={{ width: isMobile ? 48 : 56, height: isMobile ? 48 : 56, borderRadius: isMobile ? 14 : 16, background:"linear-gradient(135deg,#7B3FF4 0%,#0055FF 100%)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 10px 28px rgba(123,63,244,.32)" }}>
          <Brain size={isMobile ? 24 : 28} color="#fff" strokeWidth={2.2} className="animate-pulse"/>
        </div>
        <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:800, color:T3, letterSpacing:"0.12em", textTransform:"uppercase", textAlign:"center" }}>Analysing student data...</p>
      </div>
    );
  }

  const criticalSafe = stats.total > 0 ? Math.round((stats.safe / stats.total) * 100) : 0;
  const atRiskTotal = stats.critical + stats.high;

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 16 : 24 }}>

        <PageHead
          icon={Brain}
          title="AI Risk Predictor"
          subtitle="Probability of failing this semester · with explanations"
          right={
            <button
              onClick={load}
              className="dash-btn"
              style={{
                display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                padding: isMobile ? "10px 14px" : "10px 16px", borderRadius:12,
                background:"#fff", color:T3, border:"0.5px solid rgba(0,85,255,.12)",
                fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                cursor:"pointer", boxShadow:SHADOW_SM, fontFamily:"inherit",
                width: isMobile ? "100%" : "auto",
              }}
            >
              <RefreshCw size={13}/> Refresh
            </button>
          }
        />

        <DarkHero
          icon={Brain}
          eyebrow={<><Sparkles size={11} style={{ display:"inline", marginRight:4 }}/> AI-Powered Intelligence</> as any}
          title={stats.total.toString()}
          subtitle={`Student${stats.total!==1?"s":""} analysed · ${atRiskTotal} at risk · ${criticalSafe}% currently safe`}
          stats={[
            { label:"Critical", value: stats.critical.toString() },
            { label:"High",     value: stats.high.toString() },
            { label:"Safe",     value: stats.safe.toString() },
          ]}
        />

        {/* Bright Stat Grid — each is a filter */}
        <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16 }}>
          <StatTile label="Critical Risk" value={stats.critical.toString()} sub="≥70% fail probability" grad={GRAD_RED}    icon={ShieldAlert}    onClick={() => setFilterLevel(filterLevel === "Critical" ? "All" : "Critical")} />
          <StatTile label="High Risk"     value={stats.high.toString()}     sub="50-69%"                 grad={GRAD_ORANGE} icon={AlertTriangle}  onClick={() => setFilterLevel(filterLevel === "High" ? "All" : "High")} />
          <StatTile label="Watch List"    value={stats.watch.toString()}    sub="30-49%"                 grad={GRAD_GOLD}   icon={Eye}            onClick={() => setFilterLevel(filterLevel === "Watch" ? "All" : "Watch")} />
          <StatTile label="Safe"          value={stats.safe.toString()}     sub="<30%"                   grad={GRAD_GREEN}  icon={CheckCircle2}   onClick={() => setFilterLevel(filterLevel === "Safe" ? "All" : "Safe")} />
        </div>

        {/* Filters */}
        <Card3D padding={isMobile ? "12px 14px" : "14px 18px"}>
          <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, flexWrap:"wrap" }}>
            <div style={{ position:"relative", flex:1, minWidth: isMobile ? "100%" : 220 }}>
              <Search size={14} color={T4} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}/>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={isMobile ? "Search students…" : "Search students, branch, grade…"}
                style={{
                  width:"100%", padding: isMobile ? "9px 12px 9px 34px" : "10px 12px 10px 36px", borderRadius:12,
                  border:"0.5px solid rgba(0,85,255,.14)", background:"#F5F9FF",
                  fontSize: isMobile ? 12 : 13, fontWeight:500, color:T1, outline:"none", fontFamily:"inherit",
                }}
              />
            </div>
            <div style={{
              display:"flex",
              gap: isMobile ? 5 : 6,
              flexWrap: isMobile ? "nowrap" : "wrap",
              overflowX: isMobile ? "auto" : "visible",
              WebkitOverflowScrolling:"touch",
              marginLeft: isMobile ? -14 : 0,
              marginRight: isMobile ? -14 : 0,
              paddingLeft: isMobile ? 14 : 0,
              paddingRight: isMobile ? 14 : 0,
              width: isMobile ? "calc(100% + 28px)" : undefined,
            }}>
              {(["All", "Critical", "High", "Watch", "Safe"] as const).map(lvl => {
                const active = filterLevel === lvl;
                const tierGrad = lvl === "All" ? GRAD_PRIMARY :
                                 lvl === "Critical" ? GRAD_RED :
                                 lvl === "High" ? GRAD_ORANGE :
                                 lvl === "Watch" ? GRAD_GOLD : GRAD_GREEN;
                return (
                  <button
                    key={lvl}
                    onClick={() => setFilterLevel(lvl)}
                    className="dash-btn"
                    style={{
                      padding: isMobile ? "7px 12px" : "8px 14px", borderRadius: isMobile ? 999 : 11,
                      background: active ? tierGrad : "#F5F9FF",
                      color: active ? "#fff" : T3,
                      fontSize: isMobile ? 9 : 10, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
                      border: active ? "none" : "0.5px solid rgba(0,85,255,.12)",
                      cursor:"pointer", fontFamily:"inherit",
                      boxShadow: active ? SHADOW_BTN : "none",
                      whiteSpace:"nowrap", flexShrink:0,
                    }}
                  >
                    {lvl}
                  </button>
                );
              })}
            </div>
          </div>
        </Card3D>

        {/* Student Cards */}
        {filtered.length === 0 ? (
          <Card3D padding={isMobile ? "36px 16px" : "48px 24px"}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
              <div style={{ width: isMobile ? 52 : 60, height: isMobile ? 52 : 60, borderRadius:18, background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Brain size={isMobile ? 24 : 28} color={T4}/>
              </div>
              <p style={{ fontSize: isMobile ? 12 : 13, fontWeight:800, color:T3, margin:0, textAlign:"center" }}>
                {predictions.length === 0 ? "No student data found" : "No students match the filter"}
              </p>
            </div>
          </Card3D>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap: isMobile ? 10 : 12 }}>
            {filtered.map(p => {
              const tier = RISK_TIER[p.riskLevel];
              const Icon = RISK_ICON[p.riskLevel];
              const isExpanded = expanded === p.studentId;

              return (
                <div
                  key={p.studentId}
                  className="dash-card"
                  style={{
                    background:"#fff", borderRadius: isMobile ? 14 : 18,
                    border:`0.5px solid ${tier.color}33`,
                    boxShadow:SHADOW_SM, overflow:"hidden",
                    position:"relative",
                  }}
                >
                  <div style={{ position:"absolute", left:0, top:0, bottom:0, width: isMobile ? 3 : 4, background:tier.grad }}/>

                  {isMobile ? (
                    /* Mobile: two-row layout — header + compact stats strip */
                    <div style={{ padding: "12px 14px 12px 16px" }}>
                      {/* Row 1: avatar + name/meta + actions */}
                      <div style={{ display:"flex", alignItems:"center", gap:11 }}>
                        <div style={{
                          width:38, height:38, borderRadius:11, background:tier.grad,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          color:"#fff", fontSize:11, fontWeight:800, flexShrink:0,
                          boxShadow:`0 6px 14px ${tier.color}33`,
                        }}>
                          {getInitials(p.studentName)}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <p style={{ fontSize:13, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.2px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.studentName}</p>
                          <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"2px 0 0 0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                            {p.grade} · {p.branch}
                          </p>
                        </div>
                        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); generateParentLink(p); }}
                            aria-label="Copy parent share link"
                            className="dash-btn"
                            style={{
                              width:34, height:34, borderRadius:10,
                              background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                              display:"flex", alignItems:"center", justifyContent:"center",
                              cursor:"pointer",
                            }}
                          >
                            {copiedId === p.studentId ? <Check size={14} color={GREEN}/> : <Share2 size={13} color={T3}/>}
                          </button>
                          <button
                            onClick={() => setExpanded(isExpanded ? null : p.studentId)}
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                            className="dash-btn"
                            style={{
                              width:34, height:34, borderRadius:10,
                              background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                              display:"flex", alignItems:"center", justifyContent:"center",
                              cursor:"pointer",
                            }}
                          >
                            {isExpanded ? <ChevronUp size={14} color={T3}/> : <ChevronDown size={14} color={T3}/>}
                          </button>
                        </div>
                      </div>

                      {/* Row 2: tier badge + 3-metric compact strip */}
                      <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                        <span style={{
                          display:"inline-flex", alignItems:"center", gap:4,
                          fontSize:9, fontWeight:800, padding:"3px 8px", borderRadius:999,
                          background:tier.bg, color:tier.color,
                          letterSpacing:"0.10em", textTransform:"uppercase",
                        }}>
                          <Icon size={10} strokeWidth={2.4}/> {tier.label}
                        </span>
                      </div>

                      {/* Row 3: fail risk bar with metrics */}
                      <div style={{ marginTop:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                          <span style={{ fontSize:9, fontWeight:700, color:T4, letterSpacing:"0.08em", textTransform:"uppercase" }}>Fail Risk</span>
                          <span style={{ fontSize:12, fontWeight:800, color:tier.color }}>{p.failProbability}%</span>
                        </div>
                        <div style={{ height:6, background:"#F5F9FF", borderRadius:999, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${p.failProbability}%`, background:tier.grad, borderRadius:999 }}/>
                        </div>
                      </div>

                      {/* Row 4: Attendance / Avg / Trend mini-grid */}
                      <div style={{ marginTop:10, display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8, borderTop:"0.5px solid rgba(0,85,255,.06)", paddingTop:10 }}>
                        <div>
                          <p style={{ fontSize:8, fontWeight:800, color:T4, letterSpacing:"0.10em", textTransform:"uppercase", margin:0 }}>Attendance</p>
                          <p style={{ fontSize:12, fontWeight:800, margin:"2px 0 0 0", color: p.attendance < 75 ? RED : T1 }}>{p.attendance}%</p>
                        </div>
                        <div>
                          <p style={{ fontSize:8, fontWeight:800, color:T4, letterSpacing:"0.10em", textTransform:"uppercase", margin:0 }}>Avg Score</p>
                          <p style={{ fontSize:12, fontWeight:800, margin:"2px 0 0 0", color: p.avgScore < 50 ? RED : T1 }}>{p.avgScore}%</p>
                        </div>
                        <div>
                          <p style={{ fontSize:8, fontWeight:800, color:T4, letterSpacing:"0.10em", textTransform:"uppercase", margin:0 }}>Trend</p>
                          <div style={{ display:"flex", alignItems:"center", gap:3, marginTop:2 }}>
                            {p.scoreTrend > 0 ? <TrendingUp size={12} color={GREEN}/> :
                              p.scoreTrend < 0 ? <TrendingDown size={12} color={RED}/> :
                              <Minus size={12} color={T4}/>}
                            <p style={{ fontSize:12, fontWeight:800, margin:0, color: p.scoreTrend > 0 ? GREEN : p.scoreTrend < 0 ? RED : T4 }}>
                              {p.scoreTrend > 0 ? "+" : ""}{p.scoreTrend}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 18px 14px 22px" }}>
                    <div style={{
                      width:40, height:40, borderRadius:12, background:tier.grad,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      color:"#fff", fontSize:11, fontWeight:800, flexShrink:0,
                      boxShadow:`0 6px 14px ${tier.color}33`,
                    }}>
                      {getInitials(p.studentName)}
                    </div>

                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:3 }}>
                        <p style={{ fontSize:13, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.2px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:180 }}>{p.studentName}</p>
                        <span style={{
                          display:"inline-flex", alignItems:"center", gap:4,
                          fontSize:9, fontWeight:800, padding:"3px 8px", borderRadius:999,
                          background:tier.bg, color:tier.color,
                          letterSpacing:"0.12em", textTransform:"uppercase",
                        }}>
                          <Icon size={10} strokeWidth={2.4}/> {tier.label}
                        </span>
                      </div>
                      <p style={{ fontSize:11, fontWeight:600, color:T4, margin:0 }}>
                        {p.grade} · {p.branch}
                      </p>
                    </div>

                    {/* Probability bar */}
                    <div style={{ width:140, flexShrink:0 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                        <span style={{ fontSize:9, fontWeight:700, color:T4, letterSpacing:"0.08em", textTransform:"uppercase" }}>Fail Risk</span>
                        <span style={{ fontSize:13, fontWeight:800, color:tier.color }}>{p.failProbability}%</span>
                      </div>
                      <div style={{ height:6, background:"#F5F9FF", borderRadius:999, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${p.failProbability}%`, background:tier.grad, borderRadius:999 }}/>
                      </div>
                    </div>

                    {/* Quick stats */}
                    <div style={{ display:"flex", gap:12, flexShrink:0 }}>
                      <div style={{ textAlign:"center" }}>
                        <p style={{ fontSize:13, fontWeight:800, margin:0, color: p.attendance < 75 ? RED : T1 }}>{p.attendance}%</p>
                        <p style={{ fontSize:9, fontWeight:700, color:T4, margin:"2px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Att.</p>
                      </div>
                      <div style={{ textAlign:"center" }}>
                        <p style={{ fontSize:13, fontWeight:800, margin:0, color: p.avgScore < 50 ? RED : T1 }}>{p.avgScore}%</p>
                        <p style={{ fontSize:9, fontWeight:700, color:T4, margin:"2px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Avg</p>
                      </div>
                      <div style={{ textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:2 }}>
                          {p.scoreTrend > 0 ? <TrendingUp size={12} color={GREEN}/> :
                            p.scoreTrend < 0 ? <TrendingDown size={12} color={RED}/> :
                            <Minus size={12} color={T4}/>}
                          <p style={{ fontSize:13, fontWeight:800, margin:0, color: p.scoreTrend > 0 ? GREEN : p.scoreTrend < 0 ? RED : T4 }}>
                            {p.scoreTrend > 0 ? "+" : ""}{p.scoreTrend}
                          </p>
                        </div>
                        <p style={{ fontSize:9, fontWeight:700, color:T4, margin:"2px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Trend</p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); generateParentLink(p); }}
                        title="Copy parent share link"
                        className="dash-btn"
                        style={{
                          width:34, height:34, borderRadius:10,
                          background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          cursor:"pointer",
                        }}
                      >
                        {copiedId === p.studentId ? <Check size={14} color={GREEN}/> : <Share2 size={13} color={T3}/>}
                      </button>
                      <button
                        onClick={() => setExpanded(isExpanded ? null : p.studentId)}
                        className="dash-btn"
                        style={{
                          width:34, height:34, borderRadius:10,
                          background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          cursor:"pointer",
                        }}
                      >
                        {isExpanded ? <ChevronUp size={14} color={T3}/> : <ChevronDown size={14} color={T3}/>}
                      </button>
                    </div>
                  </div>
                  )}

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div
                      style={{
                        borderTop:`0.5px solid ${tier.color}22`,
                        background:tier.bg, padding: isMobile ? "14px 14px 14px 16px" : "16px 22px",
                        display:"flex", flexDirection:"column", gap: isMobile ? 12 : 14,
                      }}
                    >
                      <div>
                        <p style={{ fontSize:9, fontWeight:800, color:T3, letterSpacing:"0.14em", textTransform:"uppercase", margin:"0 0 8px 0" }}>
                          Why this prediction?
                        </p>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                          {p.riskFactors.map((f, i) => (
                            <span
                              key={i}
                              style={{
                                fontSize: isMobile ? 10 : 10, fontWeight:700, padding: isMobile ? "4px 9px" : "4px 10px", borderRadius:999,
                                background:"#fff", color:tier.color,
                                border:`0.5px solid ${tier.color}33`,
                              }}
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>

                      {p.recentScores.length > 0 && (
                        <div>
                          <p style={{ fontSize:9, fontWeight:800, color:T3, letterSpacing:"0.14em", textTransform:"uppercase", margin:"0 0 8px 0" }}>
                            Last {p.recentScores.length} test scores
                          </p>
                          <div style={{
                            display:"flex", alignItems:"center", gap: isMobile ? 6 : 8,
                            overflowX: isMobile ? "auto" : "visible",
                            WebkitOverflowScrolling:"touch",
                            paddingBottom: isMobile ? 2 : 0,
                          }}>
                            {[...p.recentScores].reverse().map((s, i) => {
                              const scoreGrad = s >= 75 ? GRAD_GREEN : s >= 50 ? GRAD_GOLD : GRAD_RED;
                              return (
                                <div key={i} style={{ textAlign:"center", flexShrink:0 }}>
                                  <div style={{
                                    width: isMobile ? 36 : 40, height: isMobile ? 36 : 40, borderRadius: isMobile ? 11 : 12, background:scoreGrad,
                                    display:"flex", alignItems:"center", justifyContent:"center",
                                    color:"#fff", fontSize: isMobile ? 11 : 12, fontWeight:800,
                                    boxShadow:"0 4px 10px rgba(0,0,0,.12)",
                                  }}>
                                    {s}
                                  </div>
                                  <p style={{ fontSize:9, fontWeight:700, color:T4, margin:"4px 0 0 0" }}>#{i + 1}</p>
                                </div>
                              );
                            })}
                            {p.scoreTrend !== 0 && (
                              <div style={{ marginLeft: isMobile ? 4 : 8, display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                                {p.scoreTrend > 0 ? <TrendingUp size={14} color={GREEN}/> : <TrendingDown size={14} color={RED}/>}
                                <span style={{ fontSize: isMobile ? 10 : 11, fontWeight:800, color: p.scoreTrend > 0 ? GREEN : RED, whiteSpace:"nowrap" }}>
                                  {p.scoreTrend > 0 ? "+" : ""}{p.scoreTrend} pts
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Recommendation */}
                      <div
                        style={{
                          background:"#fff", borderRadius:12, padding: isMobile ? "11px 13px" : "12px 14px",
                          border:"0.5px solid rgba(0,85,255,.08)",
                        }}
                      >
                        <p style={{ fontSize:9, fontWeight:800, color:T4, letterSpacing:"0.14em", textTransform:"uppercase", margin:"0 0 4px 0" }}>
                          Recommended Action
                        </p>
                        <p style={{ fontSize: isMobile ? 12 : 13, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.2px", lineHeight:1.4 }}>{p.recommendation}</p>
                      </div>

                      <button
                        onClick={() => generateParentLink(p)}
                        className="dash-btn"
                        style={{
                          display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6, alignSelf: isMobile ? "stretch" : "flex-start",
                          padding: isMobile ? "10px 14px" : "8px 14px", borderRadius:11,
                          background:GRAD_PRIMARY, color:"#fff",
                          fontSize: isMobile ? 10 : 10, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
                          border:"none", cursor:"pointer", boxShadow:SHADOW_BTN, fontFamily:"inherit",
                          width: isMobile ? "100%" : "auto",
                        }}
                      >
                        <Share2 size={12}/> {isMobile ? "Parent Link (30-day)" : "Generate parent link (30-day)"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* How it works banner */}
        <div
          style={{
            background:"linear-gradient(135deg,#7B3FF4 0%,#0055FF 100%)",
            borderRadius: isMobile ? 14 : 18, padding: isMobile ? "14px 14px" : "16px 18px", color:"#fff",
            display:"flex", alignItems:"flex-start", gap: isMobile ? 10 : 12,
            boxShadow:"0 14px 38px rgba(123,63,244,.26)",
          }}
        >
          <div style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: isMobile ? 10 : 11, background:"rgba(255,255,255,.16)", border:"0.5px solid rgba(255,255,255,.26)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Brain size={isMobile ? 16 : 18} color="#fff" strokeWidth={2.3}/>
          </div>
          <div style={{ minWidth:0 }}>
            <p style={{ fontSize: isMobile ? 12 : 13, fontWeight:800, color:"#fff", margin:0, letterSpacing:"-0.2px" }}>How it works</p>
            <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:500, color:"rgba(255,255,255,.85)", margin:"4px 0 0 0", lineHeight:1.55 }}>
              Fail probability is computed using a weighted formula — attendance trend (40%), score average (35%),
              score trajectory (15%), and fee signals (10%). Students with ≥70% probability are flagged Critical
              and need immediate intervention.
            </p>
          </div>
        </div>

        <AIInsightCard
          title="Risk Predictor Intelligence"
          items={[
            { label:"Critical Watch", value: stats.critical > 0 ? `${stats.critical} urgent` : "None critical", sub: stats.critical > 0 ? "Intervention needed" : "All tracked students stable" },
            { label:"Overall Health", value: `${criticalSafe}% safe`, sub: stats.total > 0 ? `${stats.total} students analysed` : "No data yet" },
            { label:"Parent Outreach", value: atRiskTotal > 0 ? `${atRiskTotal} at-risk` : "None at risk", sub: atRiskTotal > 0 ? "Share parent links" : "Maintain engagement" },
          ]}
        />
      </div>
    </>
  );
}