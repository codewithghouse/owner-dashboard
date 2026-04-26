/**
 * OwnerDashboardDesktop.tsx
 *
 * Desktop-native layout for the Owner Branch Leaderboard (≥ 1024px).
 *
 * Layout:
 *   1. Hero strip — school + month + 5 KPI tiles
 *   2. Two-up charts — composite ranking (clickable bars) + 6-month trend
 *   3. 3-col branch grid — quick-glance cards
 *   4. Full-width analysis panel — selected branch's AI insight
 */
import React, { useMemo } from "react";
import { AlertTriangle, ArrowUpRight, ArrowDownRight, Minus, Sparkles } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell,
  Tooltip, CartesianGrid, LineChart, Line, Legend,
} from "recharts";
import { FONT, T } from "../ownerDashboardTokens";
import type {
  OwnerBranchRanking, OwnerBranchInsight, OwnerNetworkSummary,
  OwnerLeaderboardData,
} from "@/lib/ownerTypes";
import type { AISourceLabel } from "@/hooks/useOwnerBranchLeaderboard";

interface Props {
  data: OwnerLeaderboardData;
  selectedId: string | null;
  onSelect: (b: OwnerBranchRanking) => void;
  aiSources: Record<string, AISourceLabel>;
}

// ── Small atoms ─────────────────────────────────────────────────────────────
const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = T.T4 }) => (
  <p style={{
    fontSize: 10, fontWeight: 800, letterSpacing: "1.6px", color,
    margin: 0, textTransform: "uppercase", fontFamily: FONT,
  }}>{children}</p>
);

const KpiTile: React.FC<{
  label: string; value: string | number; sub?: string; tone?: "default" | "good" | "warn" | "bad";
}> = ({ label, value, sub, tone = "default" }) => {
  const color = tone === "good" ? T.GREEN
              : tone === "warn" ? T.ORANGE
              : tone === "bad"  ? T.RED
              : "#FFFFFF";
  return (
    <div style={{
      flex: 1, padding: "16px 20px", borderRadius: 16,
      background: "rgba(255,255,255,0.06)",
      border: "0.5px solid rgba(255,255,255,0.12)",
      backdropFilter: "blur(4px)",
    }}>
      <p style={{
        fontSize: 9, fontWeight: 800, letterSpacing: "1.4px",
        color: "rgba(255,255,255,0.55)", margin: "0 0 6px",
        textTransform: "uppercase", fontFamily: FONT,
      }}>{label}</p>
      <p style={{
        fontSize: 28, fontWeight: 800, color, margin: 0,
        letterSpacing: "-0.8px", lineHeight: 1, fontFamily: FONT,
      }}>{value}</p>
      {sub && <p style={{
        fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)",
        margin: "4px 0 0", fontFamily: FONT,
      }}>{sub}</p>}
    </div>
  );
};

const SectionTitle: React.FC<{ eyebrow: string; title: string }> = ({ eyebrow, title }) => (
  <div style={{ marginBottom: 14 }}>
    <Eyebrow>{eyebrow}</Eyebrow>
    <h3 style={{
      fontSize: 18, fontWeight: 800, letterSpacing: "-0.5px",
      color: T.T1, margin: "4px 0 0", fontFamily: FONT,
    }}>{title}</h3>
  </div>
);

const Card: React.FC<{ children: React.ReactNode; padding?: number; style?: React.CSSProperties }> = ({
  children, padding = 22, style,
}) => (
  <div style={{
    background: T.cardBg, border: T.BORDER, borderRadius: 20,
    padding, boxShadow: T.SH_LG, ...style,
  }}>{children}</div>
);

// ── Hero strip ──────────────────────────────────────────────────────────────
const HeroStrip: React.FC<{ network: OwnerNetworkSummary }> = ({ network }) => (
  <div style={{
    background: "linear-gradient(135deg, #000A33 0%, #001A66 35%, #0044CC 75%, #0055FF 100%)",
    borderRadius: 24, padding: "28px 32px", marginBottom: 24,
    boxShadow: T.SH_HERO, position: "relative", overflow: "hidden",
  }}>
    <div style={{
      position: "absolute", top: "-50%", right: "-10%", width: "60%", height: "200%",
      background: "radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 60%)",
      pointerEvents: "none",
    }} />
    <div style={{ position: "relative" }}>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "5px 12px", borderRadius: 999,
        background: "rgba(255,255,255,0.08)",
        border: "0.5px solid rgba(255,255,255,0.18)",
      }}>
        <Sparkles size={12} color="#FFD700" />
        <span style={{
          fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.85)",
          letterSpacing: "1.4px", textTransform: "uppercase", fontFamily: FONT,
        }}>
          {network.name} · {network.monthLabel || "Live"}
        </span>
      </div>
      <h1 style={{
        fontSize: 32, fontWeight: 800, letterSpacing: "-1.2px",
        color: "#FFFFFF", margin: "10px 0 4px", lineHeight: 1.05, fontFamily: FONT,
      }}>
        Branch Leaderboard
      </h1>
      <p style={{
        fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.7)",
        margin: 0, fontFamily: FONT,
      }}>
        Composite-ranked across attendance, academic results, and fee collection.
      </p>

      <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
        <KpiTile label="Branches"     value={network.totalBranches} />
        <KpiTile label="Students"     value={network.totalStudents.toLocaleString()} />
        <KpiTile label="Teachers"     value={network.totalTeachers} />
        <KpiTile label="Network avg"  value={network.networkAvg.toFixed(1)} sub={`Top ${network.topScore.toFixed(1)}`} tone="good" />
        <KpiTile label="At-risk"      value={network.totalAtRisk} sub="across the network" tone={network.totalAtRisk > 0 ? "warn" : "default"} />
      </div>
    </div>
  </div>
);

// ── Composite ranking bar chart ─────────────────────────────────────────────
const RankingChart: React.FC<{
  branches: OwnerBranchRanking[]; selectedId: string | null;
  onSelect: (b: OwnerBranchRanking) => void; networkAvg: number;
}> = ({ branches, selectedId, onSelect, networkAvg }) => {
  const data = useMemo(() => branches.map(b => ({
    id: b.id, name: b.name.length > 18 ? b.name.slice(0, 17) + "…" : b.name,
    composite: b.composite, rank: b.rank,
  })), [branches]);

  const colorFor = (rank: number, isSelected: boolean) => {
    if (isSelected) return T.B1;
    if (rank === 1) return "#FFAA00";
    if (rank === 2) return "#A8A8B5";
    if (rank === 3) return "#8B5A2B";
    if (rank === branches.length) return T.RED;
    return T.B2;
  };

  return (
    <Card>
      <SectionTitle eyebrow="Composite ranking" title="Where each branch stands this month" />
      <div style={{ width: "100%", height: 320, fontFamily: FONT }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 6, right: 24, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,85,255,0.06)" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: T.T3, fontWeight: 600 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12, fill: T.T1, fontWeight: 700 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(0,85,255,0.04)" }}
              contentStyle={{
                background: T.cardBg, border: T.BORDER, borderRadius: 12,
                boxShadow: T.SH, fontFamily: FONT, fontSize: 12, padding: "8px 12px",
              }}
              formatter={(v: number) => [v.toFixed(1), "Composite"]}
              labelStyle={{ fontWeight: 800, color: T.T1 }}
            />
            <Bar
              dataKey="composite"
              radius={[0, 8, 8, 0]}
              onClick={(e: { id?: string }) => {
                const b = branches.find(x => x.id === e.id);
                if (b) onSelect(b);
              }}
              cursor="pointer"
            >
              {data.map(d => (
                <Cell key={d.id} fill={colorFor(d.rank, d.id === selectedId)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p style={{
        fontSize: 11, fontWeight: 600, color: T.T3,
        margin: "8px 0 0", fontFamily: FONT, textAlign: "center",
      }}>
        Click any bar to load its analysis below · Network average {networkAvg.toFixed(1)}
      </p>
    </Card>
  );
};

// ── 6-month attendance trend chart (top 3 branches by composite) ────────────
const TrendChart: React.FC<{
  data: OwnerLeaderboardData; selectedId: string | null;
}> = ({ data, selectedId }) => {
  const top3 = data.branches.slice(0, 3);
  const focus = data.branches.find(b => b.id === selectedId);

  // Build chart-friendly data: one row per month, columns per branch.
  const chartData = useMemo(() => {
    return data.trendMonths.map((label, i) => {
      const row: Record<string, string | number> = { month: label };
      top3.forEach(b => { row[b.name] = data.trendByBranch[b.id]?.[i] || 0; });
      if (focus && !top3.find(b => b.id === focus.id)) {
        row[focus.name] = data.trendByBranch[focus.id]?.[i] || 0;
      }
      return row;
    });
  }, [data, top3, focus]);

  const lines = useMemo(() => {
    const palette = ["#FFAA00", "#7B3FF4", "#0055FF", T.RED];
    const set = [...top3];
    if (focus && !top3.find(b => b.id === focus.id)) set.push(focus);
    return set.map((b, i) => ({ name: b.name, color: palette[i] || T.T3 }));
  }, [top3, focus]);

  return (
    <Card>
      <SectionTitle eyebrow="6-month attendance trend" title="Top branches over time" />
      <div style={{ width: "100%", height: 320, fontFamily: FONT }}>
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,85,255,0.06)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: T.T3, fontWeight: 600 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: T.T3, fontWeight: 600 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{
                background: T.cardBg, border: T.BORDER, borderRadius: 12,
                boxShadow: T.SH, fontFamily: FONT, fontSize: 12, padding: "8px 12px",
              }}
              labelStyle={{ fontWeight: 800, color: T.T1 }}
            />
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: FONT, fontWeight: 700 }} iconType="circle" />
            {lines.map(l => (
              <Line
                key={l.name} type="monotone" dataKey={l.name}
                stroke={l.color} strokeWidth={2.5}
                dot={{ r: 3, strokeWidth: 0, fill: l.color }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
};

// ── Branch quick-glance card ────────────────────────────────────────────────
const BranchCard: React.FC<{
  branch: OwnerBranchRanking; insight: OwnerBranchInsight | undefined;
  isSelected: boolean; onClick: () => void;
}> = ({ branch, insight, isSelected, onClick }) => {
  const style = insight?.style;
  const trendIcon = branch.trend === "up" ? <ArrowUpRight size={14} color={T.GREEN} />
                  : branch.trend === "down" ? <ArrowDownRight size={14} color={T.RED} />
                  : <Minus size={14} color={T.T4} />;
  const trendColor = branch.trend === "up" ? T.GREEN : branch.trend === "down" ? T.RED : T.T4;

  return (
    <button
      onClick={onClick}
      style={{
        background: T.cardBg, border: isSelected ? `2px solid ${T.B1}` : T.BORDER,
        borderRadius: 20, padding: 20, boxShadow: isSelected ? T.SH_LG : T.SH,
        cursor: "pointer", textAlign: "left", fontFamily: FONT,
        transition: "transform 0.15s, box-shadow 0.15s",
        position: "relative", overflow: "hidden",
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = T.SH_LG; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = isSelected ? T.SH_LG : T.SH; }}
    >
      {/* Top: rank badge + branch */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 36, height: 36, borderRadius: 12,
          background: style?.rankBg || "rgba(0,85,255,0.12)",
          boxShadow: style?.rankShadow || "none",
          color: "#FFFFFF", fontSize: 13, fontWeight: 800,
        }}>
          #{branch.rank}
        </div>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "3px 8px", borderRadius: 999,
          background: branch.trend === "up" ? "rgba(52,199,89,0.10)"
                    : branch.trend === "down" ? "rgba(255,69,58,0.10)"
                    : "rgba(153,170,204,0.10)",
        }}>
          {trendIcon}
          <span style={{ fontSize: 10, fontWeight: 800, color: trendColor }}>
            {branch.trend === "same" ? "0.0" : `${branch.weekChange > 0 ? "+" : ""}${branch.weekChange.toFixed(1)}`}
          </span>
        </div>
      </div>

      <p style={{
        fontSize: 16, fontWeight: 800, color: T.T1, margin: 0,
        letterSpacing: "-0.3px", lineHeight: 1.2,
      }}>{branch.name}</p>
      <p style={{
        fontSize: 11, fontWeight: 600, color: T.T3, margin: "2px 0 14px",
      }}>{branch.city || "—"}</p>

      {/* Composite */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <span style={{
          fontSize: 36, fontWeight: 800, color: T.T1,
          letterSpacing: "-1.4px", lineHeight: 1,
        }}>
          {branch.composite.toFixed(1)}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.T4 }}>composite</span>
      </div>

      {/* Quick stats */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
        paddingTop: 12, borderTop: T.BORDER_SOFT,
      }}>
        {[
          { label: "Students",  value: branch.students.toLocaleString() },
          { label: "Teachers",  value: branch.teachers },
        ].map(s => (
          <div key={s.label}>
            <p style={{
              fontSize: 9, fontWeight: 800, letterSpacing: "1px",
              color: T.T4, margin: 0, textTransform: "uppercase",
            }}>{s.label}</p>
            <p style={{ fontSize: 14, fontWeight: 800, color: T.T1, margin: "1px 0 0" }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <p style={{
        fontSize: 11, fontWeight: 600, color: branch.contextColor,
        margin: "12px 0 0", lineHeight: 1.45,
      }}>
        {branch.contextLine}
      </p>
    </button>
  );
};

// ── Selected-branch deep analysis (full width) ──────────────────────────────
const AnalysisPanel: React.FC<{
  branch: OwnerBranchRanking; insight: OwnerBranchInsight | undefined;
  trend: number[]; trendMonths: string[]; aiSource: AISourceLabel | undefined;
  network: OwnerNetworkSummary;
}> = ({ branch, insight, trend, trendMonths, aiSource, network }) => {
  const style = insight?.style;
  const headerGradient = style?.headerGradient
    || "linear-gradient(135deg, #001A66 0%, #0055FF 100%)";

  const trendData = trendMonths.map((label, i) => ({
    month: label, attendance: trend[i] || 0,
  }));

  const sourceBadge = !insight ? null : (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 999,
      background: aiSource === "ai" ? "rgba(123,63,244,0.10)"
                : aiSource === "cache" ? "rgba(0,200,83,0.10)"
                : "rgba(153,170,204,0.12)",
      border: aiSource === "ai" ? "0.5px solid rgba(123,63,244,0.25)"
            : aiSource === "cache" ? "0.5px solid rgba(0,200,83,0.25)"
            : "0.5px solid rgba(153,170,204,0.25)",
    }}>
      <Sparkles size={11} color={aiSource === "ai" ? T.VIOLET : aiSource === "cache" ? "#00833A" : T.T3} />
      <span style={{
        fontSize: 9, fontWeight: 800,
        color: aiSource === "ai" ? T.VIOLET : aiSource === "cache" ? "#00833A" : T.T3,
        letterSpacing: "1px", textTransform: "uppercase", fontFamily: FONT,
      }}>
        {aiSource === "ai" ? "Edullent AI · Fresh"
         : aiSource === "cache" ? "Edullent AI · Cached"
         : "Rule-based fallback"}
      </span>
    </div>
  );

  return (
    <Card padding={0} style={{ overflow: "hidden" }}>
      {/* Hero strip */}
      <div style={{
        background: headerGradient, padding: "22px 28px",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: "-50%", right: "-15%", width: "60%", height: "200%",
          background: "radial-gradient(circle, rgba(255,255,255,0.07) 0%, transparent 60%)",
          pointerEvents: "none",
        }} />
        <div style={{ position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div>
            <Eyebrow color="rgba(255,255,255,0.55)">Branch analysis · {network.monthLabel || "Live"}</Eyebrow>
            <h2 style={{
              fontSize: 26, fontWeight: 800, color: "#FFFFFF", margin: "4px 0 2px",
              letterSpacing: "-1px", fontFamily: FONT,
            }}>{branch.name}</h2>
            <p style={{
              fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.7)",
              margin: 0, fontFamily: FONT,
            }}>
              {branch.students.toLocaleString()} students · {branch.teachers} teachers · {branch.city}
            </p>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.2px", color: "rgba(255,255,255,0.5)", margin: "0 0 2px", textTransform: "uppercase" }}>Composite</p>
              <p style={{ fontSize: 32, fontWeight: 800, color: "#FFFFFF", margin: 0, letterSpacing: "-1px" }}>{branch.composite.toFixed(1)}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.2px", color: "rgba(255,255,255,0.5)", margin: "0 0 2px", textTransform: "uppercase" }}>Rank</p>
              <p style={{ fontSize: 32, fontWeight: 800, color: "#FFFFFF", margin: 0, letterSpacing: "-1px" }}>#{branch.rank}/{network.totalBranches}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "24px 28px" }}>
        {sourceBadge && <div style={{ marginBottom: 16 }}>{sourceBadge}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "stretch" }}>
          {/* LEFT — trend chart for this branch */}
          <div style={{
            background: "#F8FAFF", borderRadius: 16, padding: 18,
            border: T.BORDER_SOFT,
          }}>
            <Eyebrow>Attendance trend · last 6 months</Eyebrow>
            <div style={{ width: "100%", height: 220, marginTop: 10, fontFamily: FONT }}>
              <ResponsiveContainer>
                <LineChart data={trendData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,85,255,0.06)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: T.T3, fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: T.T3, fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: T.cardBg, border: T.BORDER, borderRadius: 10,
                      boxShadow: T.SH, fontFamily: FONT, fontSize: 11, padding: "6px 10px",
                    }}
                    formatter={(v: number) => [`${v}%`, "Attendance"]}
                  />
                  <Line type="monotone" dataKey="attendance" stroke={T.B1} strokeWidth={2.5}
                    dot={{ r: 3, strokeWidth: 0, fill: T.B1 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* RIGHT — why analysis */}
          <div>
            <Eyebrow>{insight?.isTop ? "Why #1" : `Why at #${branch.rank}`}</Eyebrow>
            <div style={{ marginTop: 10 }}>
              {!insight ? (
                <p style={{ fontSize: 13, color: T.T3, fontFamily: FONT }}>Generating analysis…</p>
              ) : insight.isTop ? (
                insight.whyTop.map((it, i) => (
                  <div key={i} style={{
                    display: "flex", gap: 10, alignItems: "flex-start",
                    paddingTop: i > 0 ? 10 : 0, marginTop: i > 0 ? 10 : 0,
                    borderTop: i > 0 ? T.BORDER_SOFT : "none",
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: T.GREEN, marginTop: 6, flexShrink: 0 }} />
                    <p style={{ fontSize: 13, fontWeight: 500, color: T.T1, margin: 0, lineHeight: 1.55, fontFamily: FONT }}>
                      <strong>{it.metric}</strong> — {it.detail}
                    </p>
                  </div>
                ))
              ) : (
                insight.whyHere.map((it, i) => (
                  <div key={i} style={{
                    display: "flex", gap: 10, alignItems: "flex-start",
                    paddingTop: i > 0 ? 10 : 0, marginTop: i > 0 ? 10 : 0,
                    borderTop: i > 0 ? T.BORDER_SOFT : "none",
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: it.color, marginTop: 6, flexShrink: 0 }} />
                    <p style={{ fontSize: 13, fontWeight: 500, color: T.T1, margin: 0, lineHeight: 1.55, fontFamily: FONT }}>
                      <strong>{it.bold}</strong>{it.rest}
                    </p>
                  </div>
                ))
              )}
            </div>

            {insight?.isTop && insight.pills.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
                {insight.pills.map((p, i) => (
                  <span key={i} style={{
                    fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 999,
                    background: "rgba(52,199,89,0.10)", color: "#00833A", fontFamily: FONT,
                  }}>{p}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Solutions row */}
        {insight && !insight.isTop && insight.solutions.length > 0 && (
          <>
            <div style={{ marginTop: 24, marginBottom: 12 }}>
              <Eyebrow>{insight.solutionLabel || "Improvement steps"}</Eyebrow>
              <h3 style={{
                fontSize: 17, fontWeight: 800, letterSpacing: "-0.5px",
                color: T.T1, margin: "4px 0 0", fontFamily: FONT,
              }}>Specific actions</h3>
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(insight.solutions.length, 3)}, 1fr)`,
              gap: 12,
            }}>
              {insight.solutions.map((sol, i) => (
                <div key={i} style={{
                  background: sol.urgent ? (style?.solutionBg || "rgba(255,69,58,0.04)") : "#F8FAFF",
                  border: sol.urgent ? (style?.solutionBorder || "0.5px solid rgba(255,69,58,0.15)") : T.BORDER_SOFT,
                  borderRadius: 14, padding: 16, fontFamily: FONT,
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
                  }}>
                    <span style={{
                      fontSize: 22, fontWeight: 800, letterSpacing: "-1px",
                      color: style?.solutionArrowColor || T.B1, lineHeight: 1,
                    }}>0{i + 1}</span>
                    {sol.urgent && (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "2px 8px", borderRadius: 999,
                        background: style?.solutionBg || "rgba(255,69,58,0.06)",
                        border: style?.solutionBorder || "0.5px solid rgba(255,69,58,0.15)",
                      }}>
                        <AlertTriangle size={9} color={style?.solutionArrowColor || T.RED} strokeWidth={2.5} />
                        <span style={{
                          fontSize: 8, fontWeight: 800,
                          color: style?.solutionArrowColor || T.RED,
                          letterSpacing: "1px", textTransform: "uppercase",
                        }}>Urgent</span>
                      </span>
                    )}
                  </div>
                  <p style={{
                    fontSize: 12, fontWeight: 500, color: T.T1, margin: 0,
                    lineHeight: 1.55, fontFamily: FONT,
                  }}>{sol.text}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
};

// ── Root ─────────────────────────────────────────────────────────────────────
const OwnerDashboardDesktop: React.FC<Props> = ({ data, selectedId, onSelect, aiSources }) => {
  const selectedBranch = useMemo(
    () => data.branches.find(b => b.id === selectedId) || data.branches[0] || null,
    [data, selectedId],
  );

  return (
    <div style={{
      padding: 28, background: T.pageBg, fontFamily: FONT,
      minHeight: "calc(100vh - 80px)",
    }}>
      <HeroStrip network={data.network} />

      {/* Two-up: ranking + trend */}
      <div style={{
        display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
        gap: 20, marginBottom: 24,
      }}>
        <RankingChart
          branches={data.branches}
          selectedId={selectedId}
          onSelect={onSelect}
          networkAvg={data.network.networkAvg}
        />
        <TrendChart data={data} selectedId={selectedId} />
      </div>

      {/* Branch grid */}
      <div style={{ marginBottom: 24 }}>
        <SectionTitle eyebrow="All branches" title="Quick-glance ranking cards" />
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
        }}>
          {data.branches.map(b => (
            <BranchCard
              key={b.id}
              branch={b}
              insight={data.insights[b.id]}
              isSelected={b.id === selectedBranch?.id}
              onClick={() => onSelect(b)}
            />
          ))}
        </div>
      </div>

      {/* Selected branch deep dive */}
      {selectedBranch && (
        <AnalysisPanel
          branch={selectedBranch}
          insight={data.insights[selectedBranch.id]}
          trend={data.trendByBranch[selectedBranch.id] || []}
          trendMonths={data.trendMonths}
          aiSource={aiSources[selectedBranch.id]}
          network={data.network}
        />
      )}
    </div>
  );
};

export default OwnerDashboardDesktop;
