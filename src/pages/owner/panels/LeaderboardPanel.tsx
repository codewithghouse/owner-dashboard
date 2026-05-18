import React from "react";
import { FONT, T } from "../ownerDashboardTokens";
import { Eyebrow, TrendBadge, AIBadge } from "../atoms";
import type { OwnerBranchRanking, OwnerNetworkSummary, OwnerBranchInsight } from "@/lib/ownerTypes";

interface Props {
  network: OwnerNetworkSummary;
  branches: OwnerBranchRanking[];
  insights: Record<string, OwnerBranchInsight>;
  selectedId: string | null;
  onSelect: (b: OwnerBranchRanking) => void;
  isMobile: boolean;
}

const LeaderboardPanel: React.FC<Props> = ({
  network, branches, insights, selectedId, onSelect, isMobile,
}) => {
  const pad = isMobile ? "16px 0px 24px" : "32px 24px 32px";

  return (
    <div style={{
      background: T.pageBg, padding: pad,
      height: isMobile ? "auto" : "100%",
      overflowY: isMobile ? "visible" : "auto",
      fontFamily: FONT,
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <Eyebrow>{network.name} · {network.monthLabel || "Current month"}</Eyebrow>
        <h1 style={{
          fontSize: isMobile ? 28 : 24, fontWeight: 800, letterSpacing: "-1.2px",
          color: T.T1, margin: "6px 0 10px", lineHeight: 1, fontFamily: FONT,
        }}>
          Branch Leaderboard
        </h1>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
          {[
            { n: network.totalBranches, label: "branches" },
            { n: network.totalStudents.toLocaleString(), label: "students" },
            { n: network.totalTeachers, label: "teachers" },
          ].map((s, i) => (
            <React.Fragment key={i}>
              {i > 0 && !isMobile && (
                <span style={{
                  width: 3, height: 3, borderRadius: "50%", background: T.T4,
                  display: "inline-block", alignSelf: "center",
                }} />
              )}
              {isMobile ? (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: T.T1, padding: "4px 10px",
                  background: T.cardBg, borderRadius: 999, border: T.BORDER, boxShadow: T.SH,
                }}>
                  {s.n} {s.label}
                </span>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 700, color: T.T1 }}>
                  {s.n} {s.label}
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Network summary — 3 metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 20 }}>
        {[
          { label: "Network avg", value: network.networkAvg.toFixed(1), color: T.T1, border: T.BORDER },
          { label: "Top score", value: network.topScore.toFixed(1), color: T.GREEN, border: "0.5px solid rgba(52,199,89,0.20)" },
          { label: "At-risk", value: network.totalAtRisk, color: T.RED, border: "0.5px solid rgba(255,69,58,0.15)" },
        ].map((s, i) => (
          <div key={i} style={{
            background: T.cardBg, borderRadius: 14, padding: "10px 8px",
            border: s.border, textAlign: "center", boxShadow: T.SH,
          }}>
            <p style={{
              fontSize: 8, fontWeight: 800, letterSpacing: "1px", color: T.T4,
              margin: "0 0 4px", textTransform: "uppercase", fontFamily: FONT,
            }}>
              {s.label}
            </p>
            <p style={{
              fontSize: isMobile ? 22 : 20, fontWeight: 800, color: s.color,
              margin: 0, letterSpacing: "-0.6px", fontFamily: FONT,
            }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Rankings list */}
      <div style={{
        background: T.cardBg, border: T.BORDER, borderRadius: 20,
        padding: "12px 10px 8px", boxShadow: T.SH_LG,
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "2px 8px 10px", borderBottom: T.BORDER_SOFT,
        }}>
          <Eyebrow>All branches</Eyebrow>
          <p style={{ fontSize: 10, fontWeight: 500, color: T.T3, margin: 0, fontFamily: FONT }}>
            {isMobile ? "Tap for analysis" : "Click for analysis"}
          </p>
        </div>

        {branches.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center" }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: T.T3, margin: 0, fontFamily: FONT }}>
              No branches found yet. Add a branch to start ranking.
            </p>
          </div>
        ) : (
          branches.map((branch, i) => {
            const isBig = branch.rank <= 3;
            const sz = isBig ? 38 : 34;
            const isSelected = selectedId === branch.id;
            const style = insights[branch.id]?.style;
            const isWorst = branch.rank === branches.length && branch.composite < network.networkAvg;

            return (
              <button
                key={branch.id}
                onClick={() => onSelect(branch)}
                style={{
                  width: "100%",
                  background: isSelected ? "rgba(0,85,255,0.05)" : "transparent",
                  border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 12,
                  padding: isBig ? "13px 8px" : "10px 8px",
                  borderRadius: 14,
                  borderTop: i > 0 ? T.BORDER_SOFT : "none",
                  outline: isSelected ? `2px solid ${T.B1}` : "none",
                  outlineOffset: -1,
                  fontFamily: FONT,
                  transition: "background 0.12s",
                }}
              >
                {/* Rank badge */}
                <div style={{
                  width: sz, height: sz, borderRadius: 11, flexShrink: 0,
                  background: style?.rankBg || "rgba(255,255,255,0.15)",
                  boxShadow: style?.rankShadow || "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: isBig ? 14 : 12, fontWeight: 800, color: "#FFF", fontFamily: FONT,
                }}>
                  #{branch.rank}
                </div>
                {/* Avatar */}
                <div style={{
                  width: sz, height: sz, borderRadius: "50%", flexShrink: 0,
                  background: style?.avatarBg || "rgba(0,85,255,0.12)",
                  color: style?.avatarColor || T.B1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: isBig ? 13 : 12, fontWeight: 800, fontFamily: FONT,
                }}>
                  {branch.initial}
                </div>
                {/* Name + context */}
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <p style={{
                    fontSize: isBig ? 14 : 13, fontWeight: 800, color: T.T1,
                    margin: 0, letterSpacing: "-0.2px",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    fontFamily: FONT,
                  }}>
                    {branch.name}
                  </p>
                  <p style={{
                    fontSize: 10, fontWeight: 600, color: branch.contextColor,
                    margin: "1px 0 0",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    fontFamily: FONT,
                  }}>
                    {branch.contextLine}
                  </p>
                </div>
                {/* Score + trend */}
                <div style={{
                  display: "flex",
                  flexDirection: isMobile ? "row" : "column",
                  alignItems: isMobile ? "center" : "flex-end",
                  gap: isMobile ? 8 : 2, flexShrink: 0,
                }}>
                  <span style={{
                    fontSize: isBig ? 18 : 16, fontWeight: 800,
                    color: isWorst ? T.RED : T.T1,
                    letterSpacing: "-0.4px", fontFamily: FONT,
                  }}>
                    {branch.composite.toFixed(1)}
                  </span>
                  <TrendBadge change={branch.weekChange} trend={branch.trend} />
                </div>
              </button>
            );
          })
        )}
      </div>

      <AIBadge label={`Edullent · ${network.name} · ${network.monthLabel || "Live"}`} />
    </div>
  );
};

export default LeaderboardPanel;
