/**
 * Principal Leaderboard — owner-dashboard
 *
 * Ranks principals by their branch's AHI (composite of attendance + pass
 * rate + fee collection). Top 3 get the gold/silver/bronze podium; the
 * rest land in a ranked list. Each row click navigates to
 * `/principal-notes?principal={id}` so the owner can immediately reach
 * out to a strong-performer to share praise or a weak-performer to plan
 * a recovery conversation.
 *
 * Service: principalLeaderboardService.fetchPrincipalLeaderboard()
 * Refresh: PrincipalLeaderboard page is a one-shot fetch (analytics cache
 *          already inside loadCoreSnapshot), Refresh button bumps a tick
 *          to re-run.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Crown, Trophy, Loader2, Search, RefreshCw, Users, GraduationCap,
  TrendingUp, TrendingDown, Minus, MessageSquare, ShieldAlert, Award,
  Building2, ChevronDown, ChevronUp, Sparkles, Target, Lightbulb,
} from "lucide-react";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD,
  SHADOW_SM, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, Card3D, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  fetchPrincipalLeaderboard, fetchPrincipalAIInsight,
  PrincipalRankRow, PrincipalInsight,
  PrincipalLeaderboardData,
} from "@/lib/principalLeaderboardService";
import { toast } from "sonner";

const initialsOf = (name?: string) => {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
};

// AHI tier colour — matches the convention used elsewhere on the dashboard.
const ahiTier = (ahi: number): { label: string; color: string; bg: string; grad: string } => {
  if (ahi >= 85) return { label: "Strong",  color: GREEN, bg: "rgba(16,185,129,.10)", grad: "linear-gradient(135deg,#10B981 0%,#059669 100%)" };
  if (ahi >= 70) return { label: "Good",    color: B1,    bg: "rgba(0,85,255,.10)",    grad: "linear-gradient(135deg,#3B82F6 0%,#0055FF 100%)" };
  if (ahi >= 50) return { label: "Average", color: GOLD,  bg: "rgba(245,158,11,.10)",  grad: "linear-gradient(135deg,#F59E0B 0%,#D97706 100%)" };
  if (ahi >  0)  return { label: "At risk", color: RED,   bg: "rgba(239,68,68,.10)",   grad: "linear-gradient(135deg,#FF3355 0%,#DC2626 100%)" };
  return            { label: "No Data", color: T4,    bg: "rgba(148,163,184,.10)",  grad: "linear-gradient(135deg,#94A3B8 0%,#64748B 100%)" };
};

const PODIUM_STYLE = [
  { medal: "🥇", border: "rgba(245,158,11,.45)", chip: "linear-gradient(135deg,#FFD700 0%,#FFAA00 100%)", chipShadow: "0 6px 14px rgba(255,170,0,.32)" },
  { medal: "🥈", border: "rgba(148,163,184,.45)", chip: "linear-gradient(135deg,#E8E8F0 0%,#A8A8B5 100%)", chipShadow: "0 6px 14px rgba(168,168,181,.30)" },
  { medal: "🥉", border: "rgba(205,127,50,.45)",  chip: "linear-gradient(135deg,#D89060 0%,#8B5A2B 100%)", chipShadow: "0 6px 14px rgba(139,90,43,.25)" },
];

export default function PrincipalLeaderboard() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const pageShellStyle = usePageShellStyle();
  const [rows, setRows]       = useState<PrincipalRankRow[]>([]);
  const [meta, setMeta]       = useState<PrincipalLeaderboardData["network"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [tick, setTick]       = useState(0);
  // Per-row insight expansion. Multiple can be open at once so the
  // owner can compare two principals side-by-side without losing state.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // AI-generated insights keyed by principalId. Populated in the background
  // after the initial fetch; each row uses the AI version when available and
  // falls back to the rule-based insight already on row.insight otherwise.
  // `aiSet` flags which principals have a confirmed AI insight (drives the
  // "GPT-4o-mini" badge).
  const [aiInsights, setAiInsights] = useState<Map<string, PrincipalInsight>>(new Map());
  const [aiLoading, setAiLoading]   = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setAiInsights(new Map());
    fetchPrincipalLeaderboard()
      .then(async d => {
        if (!alive) return;
        setRows(d.rows);
        setMeta(d.network);
        setLoading(false);

        // Fire AI fetches in parallel for principals that have data.
        // Cap at 20 to bound cost; cache + dedup happen inside the helper.
        const aiTargets = d.rows.filter(r => r.hasData).slice(0, 20);
        if (aiTargets.length === 0) return;
        setAiLoading(true);
        const top = d.rows.find(r => r.hasData) || null;
        await Promise.all(aiTargets.map(async (r, i) => {
          const insight = await fetchPrincipalAIInsight(r, i === 0 ? null : top, d.network, i + 1);
          if (!alive || !insight) return;
          setAiInsights(prev => {
            const next = new Map(prev);
            next.set(r.id, insight);
            return next;
          });
        }));
        if (alive) setAiLoading(false);
      })
      .catch(err => {
        if (!alive) return;
        console.error("[PrincipalLeaderboard] fetch failed:", err);
        toast.error("Couldn't load leaderboard");
        setLoading(false);
      });
    return () => { alive = false; };
  }, [tick]);

  // Resolve a row's insight — prefer AI if loaded, else rule-based fallback.
  const insightFor = (r: PrincipalRankRow): PrincipalInsight => aiInsights.get(r.id) || r.insight;
  const isAiInsight = (id: string) => aiInsights.has(id);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.branchName.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q)
    );
  }, [rows, search]);

  // Hero principal — top of the FULL list (not the search-filtered one),
  // so the page subtitle stays stable while the user types.
  const heroPrincipal = rows.find(r => r.hasData) || rows[0] || null;

  // Active vs no-data split for the bright stat tiles.
  const stats = useMemo(() => ({
    total:    rows.length,
    withData: rows.filter(r => r.hasData).length,
    strong:   rows.filter(r => r.hasData && r.ahi >= 85).length,
    atRisk:   rows.filter(r => r.hasData && r.ahi > 0 && r.ahi < 50).length,
  }), [rows]);

  const podium  = filtered.slice(0, 3);
  const therest = filtered.slice(3);

  const openPrincipalChat = (id: string) => {
    navigate(`/principal-notes?principal=${encodeURIComponent(id)}`);
  };

  // Mode → label + accent color for the expanded insight panel.
  const insightAccent = (mode: PrincipalRankRow["insight"]["mode"]) => {
    if (mode === "top")     return { color: GOLD,  bg: "rgba(245,158,11,.06)",  border: "rgba(245,158,11,.22)", label: "Why on top" };
    if (mode === "strong")  return { color: B1,    bg: "rgba(0,85,255,.05)",     border: "rgba(0,85,255,.18)",   label: "Why here" };
    if (mode === "behind")  return { color: GOLD,  bg: "rgba(245,158,11,.05)",   border: "rgba(245,158,11,.20)", label: "Why here" };
    if (mode === "atrisk")  return { color: RED,   bg: "rgba(239,68,68,.05)",    border: "rgba(239,68,68,.22)",  label: "Why this rank" };
    return                       { color: T4,    bg: "rgba(148,163,184,.05)", border: "rgba(148,163,184,.20)", label: "What we see" };
  };

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, overflowX: "hidden", maxWidth: "100vw", width: "100%", boxSizing: "border-box" }}>
        <PageHead
          icon={Trophy}
          title="Principal Leaderboard"
          subtitle={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {meta?.monthLabel
                ? `Ranked by branch AHI · ${meta.monthLabel} snapshot`
                : "Ranked by branch academic health index"}
              {aiLoading && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 999,
                  background: "rgba(0,85,255,.10)", color: B1, letterSpacing: "0.08em", textTransform: "uppercase",
                }}>
                  <Loader2 size={9} className="animate-spin"/> AI thinking…
                </span>
              )}
              {!aiLoading && aiInsights.size > 0 && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 999,
                  background: "rgba(0,85,255,.10)", color: B1, letterSpacing: "0.08em", textTransform: "uppercase",
                }}>
                  <Sparkles size={9}/> {aiInsights.size} AI insight{aiInsights.size === 1 ? "" : "s"}
                </span>
              )}
            </span> as any
          }
          right={
            <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 10, width: isMobile ? "100%" : "auto" }}>
              <div style={{ position: "relative", flex: isMobile ? 1 : "0 0 auto" }}>
                <Search size={isMobile ? 12 : 13} color={T4} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }}/>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={isMobile ? "Search…" : "Search by name or branch"}
                  style={{
                    width: isMobile ? "100%" : 220, padding: isMobile ? "9px 10px 9px 30px" : "10px 12px 10px 32px",
                    borderRadius: 12, border: "0.5px solid rgba(0,85,255,.12)",
                    background: "#fff", boxShadow: SHADOW_SM,
                    fontSize: isMobile ? 11 : 12, fontWeight: 700, color: T3,
                    outline: "none", fontFamily: "inherit",
                  }}
                />
              </div>
              <button
                onClick={() => setTick(t => t + 1)}
                aria-label="Refresh leaderboard"
                title="Refresh"
                className="dash-btn"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: isMobile ? "9px 12px" : "10px 14px", borderRadius: 12,
                  background: "#fff", border: "0.5px solid rgba(0,85,255,.12)",
                  fontSize: isMobile ? 10 : 11, fontWeight: 800, color: T3,
                  letterSpacing: "0.06em", textTransform: "uppercase",
                  cursor: "pointer", boxShadow: SHADOW_SM, fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                <RefreshCw size={13} className={loading ? "animate-spin" : ""}/>
                {!isMobile && <span>Refresh</span>}
              </button>
            </div>
          }
        />

        {/* ── Dark Hero ──────────────────────────────────────────────── */}
        {!loading && heroPrincipal && (
          <DarkHero
            icon={Crown}
            eyebrow="Top Principal"
            title={heroPrincipal.name}
            subtitle={`${heroPrincipal.branchName} · AHI ${heroPrincipal.ahi}%${heroPrincipal.hasData ? "" : " · awaiting data"}`}
            stats={[
              { label: "Attendance",   value: heroPrincipal.hasData ? `${heroPrincipal.attendance}%` : "—" },
              { label: "Pass Rate",    value: heroPrincipal.hasData ? `${heroPrincipal.passRate}%` : "—" },
              { label: "Students",     value: heroPrincipal.students.toLocaleString() },
            ]}
          />
        )}

        {/* ── Bright Stat Grid ───────────────────────────────────────── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
          gap: isMobile ? 10 : 16,
          marginBottom: isMobile ? 16 : 24,
        }}>
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ height: isMobile ? 110 : 140, background: "rgba(0,85,255,.04)", borderRadius: 16 }}/>
              ))
            : [
                { label: "Principals",   value: stats.total.toString(),    sub: `${stats.withData} active`,                grad: GRAD_PRIMARY, icon: Users },
                { label: "Top AHI",      value: `${meta?.topAhi ?? 0}%`,   sub: `Network avg ${meta?.networkAvgAhi ?? 0}%`, grad: GRAD_GOLD,    icon: Award },
                { label: "Strong",       value: stats.strong.toString(),   sub: "AHI ≥ 85",                                 grad: GRAD_GREEN,   icon: TrendingUp },
                { label: "At Risk",      value: stats.atRisk.toString(),   sub: "AHI below 50",                             grad: stats.atRisk > 0 ? GRAD_VIOLET : GRAD_BLUE, icon: ShieldAlert },
              ].map(s => (
                <StatTile key={s.label} label={s.label} value={s.value} sub={s.sub} icon={s.icon} grad={s.grad}/>
              ))}
        </div>

        {/* ── Loading / Empty state ──────────────────────────────────── */}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 240 }}>
            <Loader2 className="animate-spin" size={32} color={B1}/>
          </div>
        )}

        {!loading && rows.length === 0 && (
          <Card3D padding="40px 24px">
            <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, background: "rgba(0,85,255,.08)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Users size={28} color={B1} strokeWidth={2.2}/>
              </div>
              <p style={{ fontSize: 14, fontWeight: 800, color: T1, margin: 0, letterSpacing: "-0.2px" }}>
                No principals invited yet
              </p>
              <p style={{ fontSize: 12, fontWeight: 600, color: T4, margin: 0, maxWidth: 320 }}>
                Add principals from the Principal Management page — they'll appear here ranked by their branch's outcomes.
              </p>
              <button
                onClick={() => navigate("/principals")}
                className="dash-btn"
                style={{
                  marginTop: 8, padding: "10px 18px", borderRadius: 12,
                  background: GRAD_PRIMARY, color: "#fff", border: "none",
                  fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
                  cursor: "pointer", boxShadow: SHADOW_BTN, fontFamily: "inherit",
                }}
              >
                Open Principal Management
              </button>
            </div>
          </Card3D>
        )}

        {/* ── Podium (Top 3) ─────────────────────────────────────────── */}
        {!loading && podium.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : `repeat(${podium.length}, 1fr)`,
            gap: isMobile ? 10 : 14,
            marginBottom: isMobile ? 16 : 22,
          }}>
            {podium.map((p, i) => {
              const insight  = insightFor(p);
              const style    = PODIUM_STYLE[i];
              const tier     = ahiTier(p.ahi);
              const accent   = insightAccent(insight.mode);
              const expanded = expandedIds.has(p.id);
              const ai       = isAiInsight(p.id);
              return (
                <div
                  key={p.id}
                  className="dash-card"
                  style={{
                    background: "#fff", borderRadius: isMobile ? 16 : 20,
                    border: `0.5px solid ${style.border}`,
                    boxShadow: SHADOW_SM,
                    position: "relative", overflow: "hidden",
                  }}
                >
                  <div
                    onClick={() => toggleExpanded(p.id)}
                    style={{ padding: isMobile ? "14px 14px" : "18px 20px", cursor: "pointer" }}
                  >
                    <div style={{
                      position: "absolute", top: 12, right: 12,
                      width: 36, height: 36, borderRadius: 12,
                      background: style.chip, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 18, fontWeight: 900, color: "#fff",
                      boxShadow: style.chipShadow,
                    }}>
                      {i + 1}
                    </div>
                    <div style={{ fontSize: 26, marginBottom: 4 }}>{style.medal}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: 11, background: tier.grad,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontSize: 12, fontWeight: 800, flexShrink: 0,
                        boxShadow: `0 6px 14px ${tier.color}33`,
                      }}>
                        {initialsOf(p.name)}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p style={{ fontSize: 13, fontWeight: 800, color: T1, margin: 0, letterSpacing: "-0.2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {p.name}
                        </p>
                        <p style={{ fontSize: 10, fontWeight: 700, color: T4, margin: "2px 0 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {p.branchName}
                        </p>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
                      <Metric label="AHI"  value={p.hasData ? `${p.ahi}%` : "—"} color={tier.color}/>
                      <Metric label="Att." value={p.hasData ? `${p.attendance}%` : "—"} color={p.attendance < 75 && p.attendance > 0 ? RED : T1}/>
                      <Metric label="Pass" value={p.hasData ? `${p.passRate}%` : "—"} color={p.passRate < 60 && p.passRate > 0 ? RED : T1}/>
                    </div>
                    {/* AI one-liner — inline preview of the full insight */}
                    <div style={{
                      display: "flex", alignItems: "flex-start", gap: 7,
                      background: accent.bg, border: `0.5px solid ${accent.border}`,
                      borderRadius: 11, padding: "9px 11px",
                    }}>
                      <Sparkles size={12} color={accent.color} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 1 }}/>
                      <p style={{ fontSize: 11, fontWeight: 700, color: T1, margin: 0, lineHeight: 1.4, letterSpacing: "-0.1px", flex: 1 }}>
                        {insight.oneLiner}
                      </p>
                      {ai && (
                        <span style={{
                          fontSize: 8, fontWeight: 800, padding: "2px 6px", borderRadius: 999,
                          background: "rgba(0,85,255,.12)", color: B1, letterSpacing: "0.08em", textTransform: "uppercase",
                          flexShrink: 0, marginTop: 1,
                        }}>AI</span>
                      )}
                    </div>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      marginTop: 10, fontSize: 10, fontWeight: 800, color: T3,
                      letterSpacing: "0.10em", textTransform: "uppercase",
                    }}>
                      <span>{expanded ? "Hide analysis" : "See full analysis"}</span>
                      {expanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                    </div>
                  </div>
                  {expanded && (
                    <InsightPanel
                      principal={p}
                      insight={insight}
                      isAi={ai}
                      accent={accent}
                      isMobile={isMobile}
                      onOpenChat={() => openPrincipalChat(p.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Ranked list (4+) ──────────────────────────────────────── */}
        {!loading && therest.length > 0 && (
          <Card3D padding={isMobile ? "8px 8px 12px 8px" : "10px 10px 14px 10px"}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {therest.map((p, i) => {
                const rank      = i + 4;
                const insight   = insightFor(p);
                const tier      = ahiTier(p.ahi);
                const accent    = insightAccent(insight.mode);
                const expanded  = expandedIds.has(p.id);
                const ai        = isAiInsight(p.id);
                const TrendIcon = p.trend === "up" ? TrendingUp : p.trend === "down" ? TrendingDown : Minus;
                return (
                  <div
                    key={p.id}
                    style={{
                      borderRadius: 14, overflow: "hidden",
                      background: expanded ? "rgba(0,85,255,.02)" : "transparent",
                    }}
                  >
                    <div
                      onClick={() => toggleExpanded(p.id)}
                      className="dash-row"
                      style={{
                        display: "flex", alignItems: "center", gap: isMobile ? 10 : 14,
                        padding: isMobile ? "10px 12px" : "12px 16px",
                        cursor: "pointer", transition: "background .15s",
                      }}
                    >
                      <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 800, color: T4, width: 26, flexShrink: 0 }}>
                        #{rank}
                      </span>
                      <div style={{
                        width: isMobile ? 34 : 38, height: isMobile ? 34 : 38, borderRadius: isMobile ? 10 : 12,
                        background: tier.grad,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontSize: isMobile ? 10 : 11, fontWeight: 800, flexShrink: 0,
                        boxShadow: `0 4px 10px ${tier.color}26`,
                      }}>
                        {initialsOf(p.name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: isMobile ? 12 : 13, fontWeight: 800, color: T1, margin: 0, letterSpacing: "-0.2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {p.name}
                        </p>
                        <p style={{ fontSize: isMobile ? 9 : 10, fontWeight: 700, color: T4, margin: "2px 0 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          <Building2 size={9} style={{ display: "inline", marginRight: 3, verticalAlign: "middle" }}/>
                          {p.branchName} · {p.students} students · {p.teachers} teachers
                        </p>
                      </div>
                      {!isMobile && (
                        <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                          <Metric label="Att."  value={p.hasData ? `${p.attendance}%` : "—"} color={p.attendance < 75 && p.attendance > 0 ? RED : T1}/>
                          <Metric label="Pass"  value={p.hasData ? `${p.passRate}%` : "—"} color={p.passRate < 60 && p.passRate > 0 ? RED : T1}/>
                          <Metric label="Fee"   value={p.hasData ? `${p.feeCollection}%` : "—"} color={p.feeCollection < 80 && p.feeCollection > 0 ? RED : T1}/>
                        </div>
                      )}
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        fontSize: isMobile ? 11 : 13, fontWeight: 800, color: tier.color,
                        flexShrink: 0,
                      }}>
                        {p.hasData ? `${p.ahi}%` : (
                          <span style={{
                            fontSize: 9, fontWeight: 800, padding: "3px 7px", borderRadius: 999,
                            background: tier.bg, color: tier.color, letterSpacing: "0.10em", textTransform: "uppercase",
                          }}>No Data</span>
                        )}
                        {p.hasData && p.weekChange !== 0 && (
                          <TrendIcon size={12} color={p.trend === "up" ? GREEN : p.trend === "down" ? RED : T4} strokeWidth={2.4}/>
                        )}
                      </span>
                      <span style={{
                        width: 24, height: 24, borderRadius: 8, background: accent.bg,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: accent.color, flexShrink: 0,
                      }}>
                        {expanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                      </span>
                    </div>
                    {expanded && (
                      <InsightPanel
                        principal={p}
                        insight={insight}
                        isAi={ai}
                        accent={accent}
                        isMobile={isMobile}
                        onOpenChat={() => openPrincipalChat(p.id)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </Card3D>
        )}

        {/* ── AI Insights footer ────────────────────────────────────── */}
        {!loading && stats.withData > 0 && (
          <AIInsightCard
            title="Leadership Intelligence Summary"
            items={[
              {
                label: "Network Health",
                value: meta && meta.networkAvgAhi > 0 ? `AHI ${meta.networkAvgAhi}` : "Awaiting data",
                sub: stats.strong > 0 ? `${stats.strong} strong principal${stats.strong === 1 ? "" : "s"}` : "Build momentum",
              },
              {
                label: "Top Performer",
                value: heroPrincipal ? heroPrincipal.name.split(" ")[0] : "—",
                sub: heroPrincipal ? `${heroPrincipal.branchName} · ${heroPrincipal.ahi}% AHI` : "—",
              },
              {
                label: "Watch List",
                value: stats.atRisk > 0 ? `${stats.atRisk} principal${stats.atRisk === 1 ? "" : "s"}` : "All under control",
                sub: stats.atRisk > 0 ? "AHI < 50 — schedule a recovery chat" : "Keep monitoring",
              },
            ]}
          />
        )}
      </div>
    </>
  );
}

// ── Tiny inline metric block — used in both podium + ranked row ─────────────
function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <p style={{ fontSize: 12, fontWeight: 800, color, margin: 0, letterSpacing: "-0.2px" }}>{value}</p>
      <p style={{ fontSize: 8, fontWeight: 700, color: T4, margin: "2px 0 0 0", letterSpacing: "0.10em", textTransform: "uppercase" }}>{label}</p>
    </div>
  );
}

// ── Expanded analysis panel — the "AI" diagnosis surface ────────────────────
// Renders the data-grounded reasons + concrete actions computed by the
// service. Each principal sees a panel customised to their actual numbers
// (attendance vs network avg, gap to #1, etc.) — no boilerplate.
function InsightPanel({
  principal,
  insight,
  isAi,
  accent,
  isMobile,
  onOpenChat,
}: {
  principal: PrincipalRankRow;
  insight: PrincipalInsight;
  isAi: boolean;
  accent: { color: string; bg: string; border: string; label: string };
  isMobile: boolean;
  onOpenChat: () => void;
}) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        borderTop: `0.5px solid ${accent.border}`,
        background: accent.bg,
        padding: isMobile ? "14px 14px" : "16px 20px",
        display: "flex", flexDirection: "column", gap: isMobile ? 14 : 16,
        cursor: "default",
      }}
    >
      {/* Reasons block */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <Target size={12} color={accent.color} strokeWidth={2.4}/>
          <p style={{ fontSize: 9, fontWeight: 800, color: accent.color, margin: 0, letterSpacing: "0.14em", textTransform: "uppercase" }}>
            {accent.label}
          </p>
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {insight.reasons.map((r, i) => (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{
                width: 6, height: 6, borderRadius: 999, background: accent.color,
                marginTop: 6, flexShrink: 0,
              }}/>
              <p style={{ fontSize: isMobile ? 12 : 13, fontWeight: 600, color: T1, margin: 0, lineHeight: 1.45, letterSpacing: "-0.1px" }}>
                {r}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {/* Actions block */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <Lightbulb size={12} color={B1} strokeWidth={2.4}/>
          <p style={{ fontSize: 9, fontWeight: 800, color: B1, margin: 0, letterSpacing: "0.14em", textTransform: "uppercase" }}>
            {insight.actionsLabel}
          </p>
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {insight.actions.map((a, i) => (
            <li key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              background: "#fff", borderRadius: 11,
              border: "0.5px solid rgba(0,85,255,.10)",
              padding: isMobile ? "9px 11px" : "10px 13px",
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: 999,
                background: "rgba(0,85,255,.10)", color: B1,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 800, flexShrink: 0, marginTop: 1,
              }}>
                {i + 1}
              </span>
              <p style={{ fontSize: isMobile ? 12 : 13, fontWeight: 600, color: T1, margin: 0, lineHeight: 1.45, letterSpacing: "-0.1px" }}>
                {a}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {/* Open chat CTA */}
      <button
        onClick={onOpenChat}
        className="dash-btn"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
          alignSelf: isMobile ? "stretch" : "flex-start",
          padding: isMobile ? "11px 16px" : "10px 18px", borderRadius: 12,
          background: GRAD_PRIMARY, color: "#fff", border: "none",
          fontSize: isMobile ? 11 : 11, fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase",
          cursor: "pointer", boxShadow: SHADOW_BTN, fontFamily: "inherit",
        }}
      >
        <MessageSquare size={13}/>
        {insight.mode === "top" ? "Send a note of recognition" : "Open chat thread"}
      </button>

      {/* Footnote: data source disclosure */}
      <p style={{ fontSize: 9, fontWeight: 600, color: T4, margin: 0, letterSpacing: "0.04em", fontStyle: "italic" }}>
        <Sparkles size={9} style={{ display: "inline", marginRight: 3, verticalAlign: "middle" }}/>
        {isAi
          ? `Generated by GPT-4o-mini from ${principal.branchName}'s last 6 months of attendance, exam results and fee records.`
          : `Analysis generated from ${principal.branchName}'s last 6 months of attendance, exam results and fee records.`}
      </p>
    </div>
  );
}
