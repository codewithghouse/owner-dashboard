import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, Cell,
} from "recharts";
import {
  X, BookOpen, Loader2, Sparkles, GraduationCap, Award, Target,
  AlertTriangle, TrendingUp, Users, BarChart3, Building2, ChevronDown,
  ChevronRight, Layers,
} from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAcademicsOverview, useSubjectDetail } from "@/hooks/useAcademics";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD, VIOLET,
  GRAD_PRIMARY, GRAD_HERO, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, GRAD_RED,
  SHADOW_SM, SHADOW_LG, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, Card3D, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";

// ── mobile-only hardening: neutralise 3D hover transforms on touch devices
//     (they stay "stuck" after tap and cause the card to overflow horizontally,
//     which surfaces as the page sliding left/right on mobile)
function MobileHarden() {
  return (
    <style>{`
      @media (hover: none) and (pointer: coarse) {
        .dash3d:hover, .dash-tile:hover, .dash-card:hover, .dash-btn:hover, .dash-row:hover {
          transform: none !important;
          box-shadow: inherit !important;
        }
      }
      @media (max-width: 767px) {
        .academics-shell {
          overflow-x: hidden !important;
          max-width: 100vw;
          width: 100%;
          box-sizing: border-box;
          -webkit-overflow-scrolling: touch;
        }
        .academics-shell .recharts-responsive-container { max-width: 100%; }
      }
    `}</style>
  );
}

// ── skeleton ──────────────────────────────────────────────────────────────────
function Skeleton({ height = 120 }: { height?: number }) {
  return (
    <div
      style={{
        background:"#F5F9FF", borderRadius:22, height,
        border:"0.5px solid rgba(0,85,255,.08)",
      }}
      className="dash-tile"
    />
  );
}

// ── grade cell colour ─────────────────────────────────────────────────────────
const getMatrixColor = (value: number) => {
  if (!value) return "rgba(0,85,255,.06)";
  if (value >= 90) return GREEN;
  if (value >= 80) return "#33DD77";
  if (value >= 70) return GOLD;
  if (value >= 60) return "#FF8800";
  return RED;
};

const getMatrixText = (value: number) => value >= 60 ? "#fff" : value > 0 ? "#fff" : T4;

// ── main component ────────────────────────────────────────────────────────────
export default function AcademicsOverview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const pageShellStyle = usePageShellStyle();
  const [activeTab, setActiveTab] = useState("Performance");

  const { data: overview, loading: overviewLoading, error } = useAcademicsOverview();
  const { subject, loading: subjectLoading } = useSubjectDetail(id);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("all");

  // ══════════════════════════════════════════════════════════════════════
  //  SUBJECT DETAIL VIEW
  // ══════════════════════════════════════════════════════════════════════
  if (id) {
    if (subjectLoading) {
      return (
        <div style={{ ...pageShellStyle, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Loader2 className="animate-spin" size={32} color={B1}/>
        </div>
      );
    }
    if (!subject) return null;

    const statusGrad =
      subject.status === "Strong" ? GRAD_GREEN :
      subject.status === "Good" ? GRAD_BLUE :
      subject.status === "No Data" ? "linear-gradient(135deg,#99AACC,#5070B0)" : GRAD_GOLD;

    return (
      <>
        <DashGlobalStyles />
        <MobileHarden />
        <div style={{ ...pageShellStyle, overflowX: "hidden", maxWidth: "100vw", width: "100%", boxSizing: "border-box" }}>
          {/* Back nav */}
          <button
            onClick={()=>navigate("/academics")}
            className="dash-btn"
            style={{
              display:"inline-flex", alignItems:"center", gap:7,
              padding: isMobile ? "7px 12px" : "8px 14px", borderRadius:12,
              background:"#fff", border:"0.5px solid rgba(0,85,255,.12)",
              fontSize: isMobile ? 10 : 11, fontWeight:700, color:T3,
              letterSpacing:"0.06em", textTransform:"uppercase",
              cursor:"pointer", marginBottom: isMobile ? 14 : 18, boxShadow:SHADOW_SM, fontFamily:"inherit",
            }}
          >
            <ChevronRight size={isMobile ? 12 : 14} style={{ transform:"rotate(180deg)" }}/> Back to Academics
          </button>

          <DarkHero
            icon={BookOpen}
            eyebrow={<><Sparkles size={11} style={{ display:"inline", marginRight:4 }}/> Subject Intelligence</> as any}
            title={subject.name}
            subtitle={`${subject.teachers} Teachers · ${subject.students.toLocaleString()} Students`}
            stats={[
              { label:"Status", value:subject.status },
            ]}
          />

          {/* Tabs */}
          <div style={{ display:"flex", gap: isMobile ? 6 : 8, marginBottom: isMobile ? 14 : 20, overflowX:"auto", paddingBottom:2, WebkitOverflowScrolling: "touch" }}>
            {["Performance", "Topics", "Resources"].map(tab => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={()=>setActiveTab(tab)}
                  className="dash-btn"
                  style={{
                    padding: isMobile ? "9px 14px" : "10px 20px", borderRadius: isMobile ? 12 : 14,
                    background: active ? GRAD_PRIMARY : "#fff",
                    color: active ? "#fff" : T3,
                    fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
                    border: active ? "none" : "0.5px solid rgba(0,85,255,.12)",
                    boxShadow: active ? SHADOW_BTN : SHADOW_SM,
                    cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap",
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          {/* Metric Tiles */}
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 16 : 24 }}>
            {[
              { label:"Average Score", value:subject.metrics.avgScore.value, note:subject.metrics.avgScore.note, icon:Award, grad:GRAD_GREEN, route:"/academics" },
              { label:"Pass Rate", value:subject.metrics.passRate.value, note:subject.metrics.passRate.note, icon:Target, grad:GRAD_BLUE, route:"/academics" },
              { label:"Top Performers", value:subject.metrics.topPerformers.value, note:subject.metrics.topPerformers.note, icon:TrendingUp, grad:GRAD_VIOLET, route:"/students" },
              { label:"Focus Areas", value:subject.metrics.focusAreas.value, note:subject.metrics.focusAreas.note, icon:AlertTriangle, grad:GRAD_GOLD, route:"/risks" },
            ].map(m=>(
              <StatTile key={m.label} label={m.label} value={m.value as any} sub={m.note as string} icon={m.icon} grad={m.grad} onClick={()=>navigate(m.route)} />
            ))}
          </div>

          {/* Charts: Topic-wise + Branch Comparison */}
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: isMobile ? 12 : 16, marginBottom: isMobile ? 16 : 24 }}>
            <Card3D padding={isMobile ? "16px 14px" : "22px 24px"}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 10 : 14 }}>
                <div style={{ minWidth:0 }}>
                  <h3 style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Topic-wise Performance</h3>
                  <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Per topic averages</p>
                </div>
                <div style={{ width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius:10, background:"rgba(0,85,255,.08)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <BarChart3 size={isMobile ? 14 : 16} color={B1} strokeWidth={2.3}/>
                </div>
              </div>
              {subject.topics.length === 0 ? (
                <div style={{ height: isMobile ? 200 : 260, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:T4 }}>No topic data available</div>
              ) : (
                <div style={{ height: isMobile ? Math.max(220, subject.topics.length * 32 + 40) : 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={subject.topics} layout="vertical"
                      margin={{ top: 4, bottom: 4, left: isMobile ? 0 : -10, right: isMobile ? 34 : 40 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,85,255,.07)"/>
                      <XAxis type="number" domain={[0,100]} hide/>
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false}
                        tick={{ fill:T3, fontSize: isMobile ? 10 : 11, fontWeight:700 }}
                        width={isMobile ? 92 : 90}
                        tickFormatter={(v: string) => v.length > 12 ? v.slice(0, 11) + "…" : v}/>
                      <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }} cursor={{ fill:"rgba(0,85,255,.04)" }}/>
                      <Bar dataKey="score" radius={[0,6,6,0]} barSize={isMobile ? 16 : 18}
                        label={{ position:"right", fill:T3, fontSize: isMobile ? 10 : 11, fontWeight:800, formatter:(v:any)=>`${v}%` }}>
                        {subject.topics.map((e,i)=>(
                          <Cell key={`c-${i}`} fill={e.score >= 80 ? GREEN : e.score >= 65 ? GOLD : RED}/>
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card3D>

            <Card3D padding={isMobile ? "16px 14px" : "22px 24px"}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 10 : 14 }}>
                <div style={{ minWidth:0 }}>
                  <h3 style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Branch Comparison</h3>
                  <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Grade × branch scores</p>
                </div>
                <div style={{ width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius:10, background:"rgba(0,200,83,.1)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <Building2 size={isMobile ? 14 : 16} color={GREEN} strokeWidth={2.3}/>
                </div>
              </div>
              {subject.classComparison.length === 0 ? (
                <div style={{ height: isMobile ? 200 : 260, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:T4 }}>No branch data available</div>
              ) : (() => {
                const branchKeys = Object.keys(subject.classComparison[0] || {}).filter(k => k !== "grade");
                const groupCount = subject.classComparison.length;
                const mobileMin = Math.max(320, groupCount * 64);
                return (
                  <div style={{ overflowX: isMobile ? "auto" : "visible", WebkitOverflowScrolling:"touch", paddingBottom: isMobile ? 4 : 0 }}>
                    <div style={{ height: isMobile ? 240 : 260, minWidth: isMobile ? mobileMin : "100%" }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={subject.classComparison} margin={{ top:8, right: isMobile ? 8 : 10, bottom: isMobile ? 30 : 20, left: isMobile ? -20 : 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                          <XAxis dataKey="grade" axisLine={false} tickLine={false}
                            tick={{ fill:T3, fontSize: isMobile ? 10 : 11, fontWeight:700 }}
                            dy={8} interval={0}/>
                          <YAxis axisLine={false} tickLine={false}
                            tick={{ fill:T3, fontSize: isMobile ? 9 : 11, fontWeight:600 }}
                            domain={[0,100]} width={isMobile ? 28 : 40}/>
                          <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }} cursor={{ fill:"rgba(0,85,255,.04)" }}/>
                          <Legend verticalAlign="bottom" iconType="circle"
                            wrapperStyle={{ fontSize: isMobile ? 10 : 11, fontWeight:700, paddingTop: 4 }}/>
                          {branchKeys.map((key, i) => (
                            <Bar key={key} dataKey={key} name={key}
                              fill={[B1, "#2277FF", GREEN, GOLD, VIOLET][i % 5]}
                              radius={[4,4,0,0]} barSize={isMobile ? 12 : 20}/>
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })()}
            </Card3D>
          </div>

          {/* Weak Areas */}
          {subject.weakAreas.length > 0 && (
            <div style={{ marginBottom: isMobile ? 16 : 24 }}>
              <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, marginBottom: isMobile ? 10 : 14 }}>
                <div style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius:11, background:"linear-gradient(135deg,#FF3355 0%,#DC2626 100%)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 6px 14px rgba(255,51,85,.28)", flexShrink:0 }}>
                  <AlertTriangle size={isMobile ? 16 : 18} color="#fff" strokeWidth={2.3}/>
                </div>
                <div style={{ minWidth:0 }}>
                  <h3 style={{ fontSize: isMobile ? 14 : 16, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Weak Areas &amp; Recommendations</h3>
                  <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>{subject.weakAreas.length} flagged topics</p>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))", gap: isMobile ? 10 : 14 }}>
                {subject.weakAreas.map((area, idx) => {
                  const critical = area.status === "Critical";
                  return (
                    <div key={idx}
                      className="dash-card"
                      style={{
                        background:"#fff", borderRadius: isMobile ? 14 : 18, padding: isMobile ? "14px 16px" : "18px 20px",
                        border:"0.5px solid rgba(0,85,255,.08)", boxShadow:SHADOW_SM,
                        position:"relative", overflow:"hidden",
                      }}
                    >
                      <div style={{ position:"absolute", left:0, top:0, bottom:0, width: isMobile ? 4 : 5, background: critical ? GRAD_RED : GRAD_GOLD }}/>
                      <div style={{ paddingLeft: isMobile ? 6 : 8 }}>
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:8 }}>
                          <h4 style={{ fontSize: isMobile ? 13 : 15, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.3px", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{area.topic}</h4>
                          <span style={{
                            fontSize:9, fontWeight:800, padding:"3px 9px", borderRadius:999,
                            background: critical ? GRAD_RED : GRAD_GOLD,
                            color:"#fff", letterSpacing:"0.10em", textTransform:"uppercase",
                            flexShrink:0,
                          }}>
                            {area.status}
                          </span>
                        </div>
                        <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:T3, margin:"0 0 10px 0", letterSpacing:"0.04em" }}>
                          Avg: {area.avgScore} · {area.affected}
                        </p>
                        <div style={{ paddingTop:10, borderTop:"0.5px solid rgba(0,85,255,.08)" }}>
                          <p style={{ fontSize:9, fontWeight:800, color:critical?RED:GOLD, margin:"0 0 4px 0", letterSpacing:"0.14em", textTransform:"uppercase" }}>Recommendation</p>
                          <p style={{ fontSize: isMobile ? 11 : 12, fontWeight:500, color:T1, margin:0, lineHeight:1.5 }}>{area.recommendation}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  OVERVIEW PAGE
  // ══════════════════════════════════════════════════════════════════════

  const branches = overview?.branches ?? [];
  const activeData = selectedBranchId === "all"
    ? overview
    : overview?.perBranch[selectedBranchId] != null
      ? { ...overview, ...overview.perBranch[selectedBranchId] }
      : overview;
  const gradeColumns = activeData?.gradeColumns ?? ["G6","G7","G8","G9","G10","G11","G12"];
  const hasData = (activeData?.gradeMatrix?.length ?? 0) > 0;

  const overallPassRate = activeData?.stats.overallPassRate.value ?? "—";
  const averageScore = activeData?.stats.averageScore.value ?? "—";
  const distinctionRate = activeData?.stats.distinctionRate.value ?? "—";
  const totalStudents = activeData?.stats.totalStudents.value ?? "—";

  return (
    <>
      <DashGlobalStyles />
      <MobileHarden />
      <div style={{ ...pageShellStyle, overflowX: "hidden", maxWidth: "100vw", width: "100%", boxSizing: "border-box" }}>
        <PageHead
          icon={GraduationCap}
          title="Academics Overview"
          subtitle={hasData ? "Branch-wise performance & learning outcomes" : "Grade-wise performance & learning outcomes"}
          right={
            overviewLoading ? (
              <div style={{ width: isMobile ? "100%" : 200, height: isMobile ? 38 : 42, borderRadius:14, background:"#F5F9FF" }}/>
            ) : (
              <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 8 : 10, width: isMobile ? "100%" : "auto" }}>
                <div style={{ position:"relative", flex: isMobile ? 1 : "0 0 auto" }}>
                  <select
                    value={selectedBranchId}
                    onChange={e => setSelectedBranchId(e.target.value)}
                    disabled={branches.length === 0}
                    style={{
                      appearance:"none", padding: isMobile ? "9px 34px 9px 32px" : "11px 40px 11px 38px",
                      borderRadius:14, border:"0.5px solid rgba(0,85,255,.12)",
                      background:"#fff", boxShadow:SHADOW_SM,
                      fontSize: isMobile ? 11 : 12, fontWeight:700, color:T3, letterSpacing:"0.04em",
                      outline:"none", fontFamily:"inherit", cursor:"pointer",
                      minWidth: isMobile ? 0 : 180, width: isMobile ? "100%" : undefined,
                    }}
                  >
                    <option value="all">All Branches</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <span
                    style={{
                      position:"absolute", left: isMobile ? 12 : 14, top:"50%", transform:"translateY(-50%)",
                      width: isMobile ? 8 : 10, height: isMobile ? 8 : 10, borderRadius:"50%",
                      background: selectedBranchId === "all"
                        ? B1
                        : branches.find(b => b.id === selectedBranchId)?.color ?? B1,
                      pointerEvents:"none",
                    }}
                  />
                  <ChevronDown size={14} color={T4} style={{ position:"absolute", right: isMobile ? 12 : 14, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}/>
                </div>
                {selectedBranchId !== "all" && (
                  <button
                    onClick={()=>setSelectedBranchId("all")}
                    className="dash-btn"
                    style={{
                      padding: isMobile ? "9px 12px" : "10px 14px", borderRadius:12,
                      background:"#fff", border:"0.5px solid rgba(0,85,255,.12)",
                      fontSize:11, fontWeight:700, color:T3, cursor:"pointer",
                      letterSpacing:"0.06em", textTransform:"uppercase", fontFamily:"inherit",
                      flexShrink:0,
                    }}
                  >
                    <X size={13}/>
                  </button>
                )}
              </div>
            )
          }
        />

        {/* Dark Hero with highlights */}
        {!overviewLoading && (
          <DarkHero
            icon={BookOpen}
            eyebrow="Academic Intelligence"
            title={typeof averageScore === "string" ? averageScore : `${averageScore}%`}
            subtitle={`Average score across ${typeof totalStudents === "number" ? totalStudents.toLocaleString() : totalStudents} students · ${branches.length} branch${branches.length !== 1 ? "es" : ""}`}
            stats={[
              { label:"Pass Rate", value: typeof overallPassRate === "string" ? overallPassRate : `${overallPassRate}%` },
              { label:"Distinction", value: typeof distinctionRate === "string" ? distinctionRate : `${distinctionRate}%` },
              { label:"Subjects", value:(activeData?.gradeMatrix?.length ?? 0).toString() },
            ]}
          />
        )}

        {error && (
          <div
            style={{
              background:"rgba(255,51,85,.08)", border:"0.5px solid rgba(255,51,85,.22)",
              borderRadius:16, padding: isMobile ? "10px 14px" : "12px 16px", color:RED, fontSize: isMobile ? 11 : 12, fontWeight:700,
              marginBottom: isMobile ? 14 : 20,
            }}
          >
            Error loading data: {error}
          </div>
        )}

        {/* Bright Stat Grid */}
        <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 16 : 24 }}>
          {overviewLoading
            ? Array.from({ length:4 }).map((_,i) => <Skeleton key={i} height={isMobile ? 110 : 140}/>)
            : [
                { label:"Overall Pass Rate", value:`${activeData!.stats.overallPassRate.value}${typeof activeData!.stats.overallPassRate.value === "number" ? "%" : ""}`, sub:activeData!.stats.overallPassRate.change, grad:GRAD_GREEN, icon:Target, route:"/academics" },
                { label:"Average Score", value:`${activeData!.stats.averageScore.value}${typeof activeData!.stats.averageScore.value === "number" ? "%" : ""}`, sub:activeData!.stats.averageScore.change, grad:GRAD_BLUE, icon:Award, route:"/academics" },
                { label:"Distinction Rate", value:`${activeData!.stats.distinctionRate.value}${typeof activeData!.stats.distinctionRate.value === "number" ? "%" : ""}`, sub:activeData!.stats.distinctionRate.change, grad:GRAD_VIOLET, icon:TrendingUp, route:"/academics" },
                { label:"Total Students", value:activeData!.stats.totalStudents.value as any, sub:activeData!.stats.totalStudents.change, grad:GRAD_GOLD, icon:Users, route:"/students" },
              ].map(s=>(
                <StatTile key={s.label} label={s.label} value={s.value as any} sub={s.sub} icon={s.icon} grad={s.grad} onClick={()=>navigate(s.route)}/>
              ))}
        </div>

        {/* Grade Matrix + Subject Comparison */}
        <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: isMobile ? 12 : 16, marginBottom: isMobile ? 16 : 24 }}>
          <Card3D padding={isMobile ? "16px 14px" : "22px 24px"}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 10 : 14 }}>
              <div style={{ minWidth:0 }}>
                <h3 style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Performance Matrix</h3>
                <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Grade-wise subject performance</p>
              </div>
              <div style={{ width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius:10, background:"rgba(0,85,255,.08)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <Layers size={isMobile ? 14 : 16} color={B1} strokeWidth={2.3}/>
              </div>
            </div>
            {overviewLoading ? (
              <div style={{ height: isMobile ? 220 : 260, background:"rgba(0,85,255,.04)", borderRadius:12 }}/>
            ) : !hasData ? (
              <div style={{ height: isMobile ? 220 : 260, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:T4 }}>No results found yet</div>
            ) : (() => {
              const cellMin = isMobile ? 42 : 0;
              const labelWidth = isMobile ? 56 : 56;
              const scrollMin = isMobile ? (labelWidth + gradeColumns.length * cellMin + gradeColumns.length * 4 + 12) : 460;
              return (
                <div style={{ overflowX:"auto", paddingBottom:4, WebkitOverflowScrolling:"touch" }}>
                  <div style={{ minWidth: scrollMin }}>
                    <div style={{ display:"flex", gap: isMobile ? 4 : 4, marginBottom:4, marginLeft: labelWidth }}>
                      {gradeColumns.map(g => (
                        <div key={g} style={{ flex:1, minWidth: cellMin, height: isMobile ? 22 : 26, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:800, color:T4, letterSpacing:"0.14em", textTransform:"uppercase" }}>
                          {g}
                        </div>
                      ))}
                    </div>
                    {activeData!.gradeMatrix.map(row => (
                      <div key={row.subject as string} style={{ display:"flex", gap: isMobile ? 4 : 4, marginBottom: isMobile ? 4 : 4, alignItems:"center" }}>
                        <div style={{ width: labelWidth, flexShrink:0, textAlign:"right", paddingRight: isMobile ? 6 : 8, fontSize: isMobile ? 9 : 10, fontWeight:800, color:T3, letterSpacing:"-0.02em", overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis", textTransform:"uppercase" }}>
                          {(row.subject as string).slice(0,7)}
                        </div>
                        {gradeColumns.map(g => {
                          const val = (row[g] as number) || 0;
                          return (
                            <div
                              key={g}
                              onClick={()=>navigate(`/academics/${(row.subject as string).toLowerCase()}`)}
                              className="dash-btn"
                              style={{
                                flex:1, minWidth: cellMin, height: isMobile ? 40 : 44, borderRadius: isMobile ? 8 : 10,
                                display:"flex", alignItems:"center", justifyContent:"center",
                                fontSize: isMobile ? 11 : 11, fontWeight:800,
                                background: getMatrixColor(val),
                                color: getMatrixText(val),
                                cursor:"pointer",
                                boxShadow: val>0 ? "0 3px 8px rgba(0,0,0,.08)" : "none",
                              }}
                            >
                              {val > 0 ? val : "—"}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </Card3D>

          {/* Subject Performance Comparison */}
          {(() => {
            const subjPerf = activeData?.subjectPerformance ?? [];
            const hasBranchData = branches.length > 0 && subjPerf.some(row =>
              branches.some(b => (row[b.name] as number) > 0)
            );
            const chartBranches: { id: string; name: string; color: string }[] = hasBranchData
              ? branches
              : [{ id:"overall", name:"Overall", color:B1 }];

            return (
              <Card3D padding={isMobile ? "16px 14px" : "22px 24px"}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 10 : 14 }}>
                  <div style={{ minWidth:0 }}>
                    <h3 style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Subject Comparison</h3>
                    <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>
                      {hasBranchData ? "By branch" : "All branches combined"}
                    </p>
                  </div>
                  <div style={{ width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius:10, background:"rgba(123,63,244,.1)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <BarChart3 size={isMobile ? 14 : 16} color={VIOLET} strokeWidth={2.3}/>
                  </div>
                </div>
                {overviewLoading ? (
                  <div style={{ height: isMobile ? 240 : 300, background:"rgba(0,85,255,.04)", borderRadius:12 }}/>
                ) : subjPerf.length === 0 ? (
                  <div style={{ height: isMobile ? 240 : 300, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, fontSize:12, fontWeight:700, color:T4 }}>
                    <p style={{ margin:0 }}>No subject data yet</p>
                    <p style={{ margin:0, fontSize:11, color:T4, fontWeight:500 }}>Data appears once teachers record results</p>
                  </div>
                ) : (() => {
                  const perSubjectWidth = Math.max(70, chartBranches.length * 16 + 36);
                  const mobileMin = Math.max(340, subjPerf.length * perSubjectWidth);
                  return (
                    <div style={{ overflowX: isMobile ? "auto" : "visible", WebkitOverflowScrolling:"touch", paddingBottom: isMobile ? 4 : 0 }}>
                      <div style={{ height: isMobile ? 290 : 300, minWidth: isMobile ? mobileMin : "100%" }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={subjPerf} margin={{ top:8, right: isMobile ? 8 : 10, bottom: isMobile ? 36 : 20, left: isMobile ? -18 : 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                            <XAxis dataKey="subject" axisLine={false} tickLine={false}
                              tick={{ fill:T3, fontSize: isMobile ? 10 : 10, fontWeight:700 }}
                              dy={8} interval={0}
                              angle={isMobile ? -28 : 0}
                              textAnchor={isMobile ? "end" : "middle"}
                              height={isMobile ? 54 : 30}/>
                            <YAxis axisLine={false} tickLine={false} tick={{ fill:T3, fontSize: isMobile ? 9 : 11, fontWeight:700 }} domain={[0,100]} width={isMobile ? 28 : 40}/>
                            <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }} cursor={{ fill:"rgba(0,85,255,.04)" }}/>
                            <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ paddingTop:6, fontSize: isMobile ? 10 : 11, fontWeight:700 }}/>
                            {chartBranches.map((b,i) => (
                              <Bar key={b.id} dataKey={b.name} name={b.name}
                                fill={[B1, GREEN, GOLD, RED, VIOLET, "#2277FF"][i % 6]}
                                radius={[4,4,0,0]} barSize={isMobile ? 12 : 18}/>
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })()}
              </Card3D>
            );
          })()}
        </div>

        {/* Exam Distribution + Learning Outcomes */}
        <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: isMobile ? 12 : 16, marginBottom: isMobile ? 16 : 24 }}>
          <Card3D padding={isMobile ? "16px 14px" : "22px 24px"}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 10 : 14 }}>
              <div style={{ minWidth:0 }}>
                <h3 style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Exam Results Distribution</h3>
                <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>By score range</p>
              </div>
              <div style={{ width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius:10, background:"rgba(255,170,0,.12)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <Award size={isMobile ? 14 : 16} color={GOLD} strokeWidth={2.3}/>
              </div>
            </div>
            {overviewLoading ? (
              <div style={{ height: isMobile ? 240 : 300, background:"rgba(0,85,255,.04)", borderRadius:12 }}/>
            ) : (
              <div style={{ height: isMobile ? 260 : 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activeData!.examDistribution} margin={{ top:8, right: isMobile ? 8 : 10, bottom: isMobile ? 20 : 10, left: isMobile ? -14 : 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                    <XAxis dataKey="range" axisLine={false} tickLine={false}
                      tick={{ fill:T3, fontSize: isMobile ? 10 : 11, fontWeight:700 }}
                      dy={8} interval={0}/>
                    <YAxis axisLine={false} tickLine={false} tick={{ fill:T3, fontSize: isMobile ? 9 : 11, fontWeight:700 }} width={isMobile ? 30 : 40}/>
                    <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }} cursor={{ fill:"rgba(0,85,255,.04)" }}/>
                    <Bar dataKey="count" name="Students" radius={[6,6,0,0]} barSize={isMobile ? 28 : 36}
                      label={{ position:"top", fill:T3, fontSize: isMobile ? 10 : 11, fontWeight:800 }}>
                      {activeData!.examDistribution.map((_,i)=>(
                        <Cell key={`c-${i}`} fill={[GREEN, B1, "#2277FF", GOLD, RED][i % 5]}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card3D>

          <Card3D padding={isMobile ? "16px 14px" : "22px 24px"}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 10 : 14 }}>
              <div style={{ minWidth:0 }}>
                <h3 style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Learning Outcomes</h3>
                <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Quarterly trend</p>
              </div>
              <div style={{ width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius:10, background:"rgba(0,200,83,.1)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <TrendingUp size={isMobile ? 14 : 16} color={GREEN} strokeWidth={2.3}/>
              </div>
            </div>
            {overviewLoading ? (
              <div style={{ height: isMobile ? 240 : 300, background:"rgba(0,85,255,.04)", borderRadius:12 }}/>
            ) : !activeData!.learningOutcomes.some(o => o.knowledge > 0 || o.skills > 0 || o.application > 0) ? (
              <div style={{ height: isMobile ? 240 : 300, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, fontSize:12, fontWeight:700, color:T4 }}>
                <p style={{ margin:0 }}>No quarterly trend data yet</p>
                <p style={{ margin:0, fontSize:11, color:T4, fontWeight:500 }}>Trends appear as results are recorded over time</p>
              </div>
            ) : (
              <div style={{ height: isMobile ? 270 : 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activeData!.learningOutcomes} margin={{ top:10, right: isMobile ? 16 : 30, left: isMobile ? -10 : -10, bottom: isMobile ? 8 : 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                    <XAxis dataKey="q" axisLine={false} tickLine={false} tick={{ fill:T3, fontSize: isMobile ? 10 : 12, fontWeight:800 }} dy={10}/>
                    <YAxis axisLine={false} tickLine={false} tick={{ fill:T3, fontSize: isMobile ? 9 : 11, fontWeight:700 }} domain={[0,100]} ticks={isMobile ? [0,25,50,75,100] : [0,20,40,60,80,100]} width={isMobile ? 34 : 40}/>
                    <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }}/>
                    <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ paddingTop:6, fontSize: isMobile ? 10 : 11, fontWeight:700 }}/>
                    <Line type="monotone" dataKey="knowledge" name="Knowledge" stroke={B1} strokeWidth={isMobile ? 2.5 : 3}
                      dot={{ r: isMobile ? 4 : 5, fill:"#fff", strokeWidth:2, stroke:B1 }} activeDot={{ r:7 }}/>
                    <Line type="monotone" dataKey="skills" name="Skills" stroke={GREEN} strokeWidth={isMobile ? 2.5 : 3}
                      dot={{ r: isMobile ? 4 : 5, fill:"#fff", strokeWidth:2, stroke:GREEN }} activeDot={{ r:7 }}/>
                    <Line type="monotone" dataKey="application" name="Application" stroke={GOLD} strokeWidth={isMobile ? 2.5 : 3}
                      dot={{ r: isMobile ? 4 : 5, fill:"#fff", strokeWidth:2, stroke:GOLD }} activeDot={{ r:7 }}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card3D>
        </div>

        {/* Branch Performance Cards */}
        {!overviewLoading && branches.length > 0 && (
          <div style={{ marginBottom: isMobile ? 16 : 24 }}>
            <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, marginBottom: isMobile ? 10 : 14 }}>
              <div style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius:11, background:GRAD_PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 6px 14px rgba(0,85,255,.28)", flexShrink:0 }}>
                <Building2 size={isMobile ? 16 : 18} color="#fff" strokeWidth={2.3}/>
              </div>
              <div style={{ minWidth:0 }}>
                <h2 style={{ fontSize: isMobile ? 14 : 16, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Branch-wise Breakdown</h2>
                <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>{branches.length} branches</p>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(300px, 1fr))", gap: isMobile ? 10 : 14 }}>
              {branches.map(b => {
                const statusGrad = b.passRate >= 80 ? GRAD_GREEN : b.passRate >= 60 ? GRAD_GOLD : b.passRate > 0 ? GRAD_RED : "linear-gradient(135deg,#99AACC,#5070B0)";
                const statusLabel = b.passRate >= 80 ? "Strong" : b.passRate >= 60 ? "Average" : b.passRate > 0 ? "Weak" : "No Data";
                return (
                  <div
                    key={b.id}
                    onClick={()=>navigate(`/branches/${b.id}`)}
                    className="dash-card"
                    style={{
                      background:"#fff", borderRadius: isMobile ? 16 : 20, padding: isMobile ? "16px 16px" : "20px 22px",
                      border:"0.5px solid rgba(0,85,255,.08)", boxShadow:SHADOW_SM,
                      cursor:"pointer", position:"relative", overflow:"hidden",
                    }}
                  >
                    <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, marginBottom: isMobile ? 12 : 16 }}>
                      <div style={{
                        width: isMobile ? 38 : 44, height: isMobile ? 38 : 44, borderRadius: isMobile ? 11 : 13,
                        background:b.color || GRAD_PRIMARY,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        color:"#fff", fontSize: isMobile ? 13 : 15, fontWeight:800,
                        boxShadow:"0 6px 14px rgba(0,85,255,.2)", flexShrink:0,
                      }}>
                        {b.name.charAt(0)}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <h3 style={{ fontSize: isMobile ? 13 : 15, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.3px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{b.name}</h3>
                        <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:T4, margin:"2px 0 0 0" }}>{b.students.toLocaleString()} students</p>
                      </div>
                      <span style={{
                        fontSize:9, fontWeight:800, padding:"4px 10px", borderRadius:999,
                        background:statusGrad, color:"#fff",
                        letterSpacing:"0.12em", textTransform:"uppercase",
                        flexShrink:0, boxShadow:"0 4px 10px rgba(0,0,0,.1)",
                      }}>
                        {statusLabel}
                      </span>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap: isMobile ? 6 : 8 }}>
                      {[
                        { label:"Avg Score", value:b.avgScore>0?`${b.avgScore}%`:"—", color: b.avgScore>=75?GREEN:GOLD },
                        { label:"Pass Rate", value:b.passRate>0?`${b.passRate}%`:"—", color: b.passRate>=80?GREEN:GOLD },
                        { label:"Distinction", value:b.distinctionRate>0?`${b.distinctionRate}%`:"—", color:B1 },
                        { label:"Attendance", value:b.avgAttendance>0?`${b.avgAttendance}%`:"—", color: b.avgAttendance>=85?GREEN:RED },
                      ].map(m => (
                        <div key={m.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingBottom: isMobile ? 5 : 6, borderBottom:"0.5px solid rgba(0,85,255,.06)" }}>
                          <span style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:T3 }}>{m.label}</span>
                          <span style={{ fontSize: isMobile ? 12 : 13, fontWeight:800, color:m.color }}>{m.value}</span>
                        </div>
                      ))}
                    </div>
                    {Object.keys(b.subjectScores).length > 0 && (
                      <div style={{ marginTop: isMobile ? 10 : 14, paddingTop:10, borderTop:"0.5px solid rgba(0,85,255,.06)" }}>
                        <p style={{ fontSize:9, fontWeight:800, color:T4, letterSpacing:"0.12em", textTransform:"uppercase", margin:"0 0 8px 0" }}>Top Subjects</p>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                          {Object.entries(b.subjectScores)
                            .sort(([, a], [, bv]) => bv - a)
                            .slice(0, 3)
                            .map(([subj, score]) => (
                              <span key={subj}
                                className="dash-btn"
                                onClick={(e) => { e.stopPropagation(); navigate(`/academics/${subj.toLowerCase()}`); }}
                                style={{
                                  fontSize:10, fontWeight:800, padding:"4px 10px", borderRadius:999,
                                  background: b.color || GRAD_PRIMARY, color:"#fff",
                                  cursor:"pointer", letterSpacing:"0.04em",
                                }}
                              >
                                {subj.slice(0,8)} {score}%
                              </span>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* AI Insights */}
        {!overviewLoading && hasData && (
          <AIInsightCard
            title="Academic Intelligence Summary"
            items={[
              {
                label:"Performance Pulse",
                value: typeof averageScore === "number" ? `${averageScore}% avg` : "Collecting",
                sub: typeof overallPassRate === "number" && overallPassRate >= 80 ? "Healthy" : "Monitor closely",
              },
              {
                label:"Subject Focus",
                value: (activeData?.gradeMatrix?.length ?? 0) + " tracked subjects",
                sub: subject ? subject.name : `${branches.length} branches active`,
              },
              {
                label:"Student Reach",
                value: typeof totalStudents === "number" ? totalStudents.toLocaleString() : totalStudents as string,
                sub: "Across all branches",
              },
            ]}
          />
        )}
      </div>
    </>
  );
}
