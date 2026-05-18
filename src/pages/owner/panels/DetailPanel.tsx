import React from "react";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { FONT, T } from "../ownerDashboardTokens";
import { Eyebrow, AIBadge } from "../atoms";
import type { OwnerBranchRanking, OwnerBranchInsight, OwnerNetworkSummary } from "@/lib/ownerTypes";

interface Props {
  branch: OwnerBranchRanking | null;
  insight: OwnerBranchInsight | null;
  network: OwnerNetworkSummary;
  onBack: (() => void) | null;
  isMobile: boolean;
}

const Placeholder: React.FC = () => (
  <div style={{
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
    background: T.pageBg, borderLeft: T.BORDER,
  }}>
    <div style={{ textAlign: "center", padding: 40 }}>
      <div style={{
        width: 64, height: 64, borderRadius: 20,
        background: "rgba(0,85,255,0.08)",
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 16px",
      }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <path d="M4 20L10 14L14 18L20 10L24 14"
            stroke={T.B1} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="4" cy="20" r="2" fill={T.B1} />
          <circle cx="24" cy="14" r="2" fill={T.B1} />
        </svg>
      </div>
      <p style={{ fontSize: 16, fontWeight: 800, color: T.T1, margin: "0 0 6px", fontFamily: FONT }}>
        Select a branch
      </p>
      <p style={{ fontSize: 13, fontWeight: 500, color: T.T3, margin: 0, fontFamily: FONT }}>
        Click any branch on the left to see detailed analysis
      </p>
    </div>
  </div>
);

const InsightsLoading: React.FC = () => (
  <p style={{
    color: T.T4, textAlign: "center", padding: "32px 16px",
    fontSize: 13, fontWeight: 600, fontFamily: FONT, margin: 0,
  }}>
    Generating branch analysis…
  </p>
);

const DetailPanel: React.FC<Props> = ({ branch, insight, network, onBack, isMobile }) => {
  if (!branch) return <Placeholder />;

  const trendUp = branch.trend === "up";
  const trendFlat = branch.trend === "same";
  const pad = isMobile ? "16px 0px 24px" : "32px 28px 40px";
  const style = insight?.style;
  const headerGradient = style?.headerGradient
    || "linear-gradient(135deg, #001A66 0%, #0055FF 100%)";

  return (
    <div style={{
      flex: 1, background: T.pageBg, padding: pad, overflowY: "auto",
      fontFamily: FONT, borderLeft: isMobile ? "none" : T.BORDER,
    }}>
      {/* Mobile: back button */}
      {isMobile && onBack && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 20,
        }}>
          <button onClick={onBack} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 14px 8px 10px", borderRadius: 999,
            background: T.cardBg, border: T.BORDER, cursor: "pointer",
            fontFamily: FONT, boxShadow: T.SH,
          }}>
            <ArrowLeft size={14} color={T.B1} strokeWidth={2.2} />
            <span style={{ fontSize: 12, fontWeight: 700, color: T.B1 }}>
              Branch rankings
            </span>
          </button>
          <Eyebrow>{network.monthLabel} · Analysis</Eyebrow>
        </div>
      )}

      {/* Desktop: branch heading */}
      {!isMobile && (
        <div style={{ marginBottom: 20 }}>
          <Eyebrow>{network.name} · {network.monthLabel}</Eyebrow>
          <h2 style={{
            fontSize: 28, fontWeight: 800, letterSpacing: "-1.2px", color: T.T1,
            margin: "6px 0 4px", lineHeight: 1, fontFamily: FONT,
          }}>
            {branch.name}
          </h2>
          <p style={{ fontSize: 13, fontWeight: 500, color: T.T3, margin: 0, fontFamily: FONT }}>
            {branch.students.toLocaleString()} students · {branch.teachers} teachers · {branch.city}
          </p>
        </div>
      )}

      {/* Hero */}
      <div style={{
        background: headerGradient, borderRadius: isMobile ? 22 : 20,
        padding: isMobile ? "20px 18px" : "18px 22px",
        boxShadow: T.SH_HERO, marginBottom: 24,
        position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: "-40%", right: "-15%", width: "70%", height: "140%",
          background: "radial-gradient(circle, rgba(255,255,255,0.07) 0%, transparent 60%)",
          pointerEvents: "none",
        }} />
        {isMobile && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            marginBottom: 14, position: "relative",
          }}>
            <div style={{
              width: 42, height: 42, borderRadius: 13,
              background: style?.rankBg || "rgba(255,255,255,0.15)",
              boxShadow: style?.rankShadow || "none",
              flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, fontWeight: 800, color: "#FFF", fontFamily: FONT,
            }}>
              #{branch.rank}
            </div>
            <div>
              <p style={{
                fontSize: 18, fontWeight: 800, color: "#FFF", margin: 0,
                letterSpacing: "-0.4px", fontFamily: FONT,
              }}>
                {branch.name}
              </p>
              <p style={{
                fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.65)",
                margin: "1px 0 0", fontFamily: FONT,
              }}>
                {branch.city}
              </p>
            </div>
          </div>
        )}
        <div style={{
          display: "flex", gap: 12, padding: "12px 0",
          borderTop: isMobile ? "0.5px solid rgba(255,255,255,0.12)" : "none",
          position: "relative",
        }}>
          {[
            { label: "Score", value: branch.composite.toFixed(1), color: "#FFF" },
            {
              label: "This month",
              value: trendFlat ? "0.0" : `${trendUp ? "+" : ""}${branch.weekChange.toFixed(1)}`,
              color: trendFlat ? "rgba(255,255,255,0.85)" : (trendUp ? T.GREEN : T.RED),
            },
            { label: "Network rank", value: `#${branch.rank}/${network.totalBranches}`, color: "#FFF" },
          ].map((s, i) => (
            <React.Fragment key={i}>
              {i > 0 && <div style={{ width: 0.5, background: "rgba(255,255,255,0.15)" }} />}
              <div style={{ flex: 1, textAlign: "center" }}>
                <p style={{
                  fontSize: 8, fontWeight: 800, letterSpacing: "1.2px",
                  color: "rgba(255,255,255,0.5)", margin: "0 0 3px",
                  textTransform: "uppercase", fontFamily: FONT,
                }}>
                  {s.label}
                </p>
                <p style={{
                  fontSize: isMobile ? 22 : 26, fontWeight: 800, color: s.color,
                  margin: 0, letterSpacing: "-0.6px", fontFamily: FONT,
                }}>
                  {s.value}
                </p>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Insights body */}
      {!insight ? (
        <InsightsLoading />
      ) : insight.isTop ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <Eyebrow>Why #1 — detailed analysis</Eyebrow>
            <h3 style={{
              fontSize: isMobile ? 22 : 20, fontWeight: 800, letterSpacing: "-0.8px",
              color: T.T1, margin: "4px 0 0", lineHeight: 1.15, fontFamily: FONT,
            }}>
              What makes {branch.name} the top branch
            </h3>
          </div>
          <div style={{
            background: T.cardBg, border: "0.5px solid rgba(52,199,89,0.20)",
            borderRadius: 20, padding: isMobile ? 20 : 22,
            boxShadow: T.SH_LG, marginBottom: 16,
          }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "5px 11px", borderRadius: 999,
              background: "rgba(52,199,89,0.08)",
              border: "0.5px solid rgba(52,199,89,0.20)", marginBottom: 14,
            }}>
              <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: T.GREEN }} />
              <span style={{
                fontSize: 9, fontWeight: 800, color: "#00833A",
                letterSpacing: "1.4px", textTransform: "uppercase", fontFamily: FONT,
              }}>
                Edullent · Top branch analysis
              </span>
            </div>
            {insight.whyTop.map((item, i) => (
              <div key={i} style={{
                display: "flex", gap: 12, alignItems: "flex-start",
                paddingTop: i > 0 ? 12 : 0, marginTop: i > 0 ? 12 : 0,
                borderTop: i > 0 ? T.BORDER_SOFT : "none",
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%", background: T.GREEN,
                  marginTop: 7, flexShrink: 0,
                }} />
                <p style={{
                  fontSize: isMobile ? 14 : 13, fontWeight: 500, color: T.T1,
                  margin: 0, lineHeight: 1.65, fontFamily: FONT,
                }}>
                  <strong>{item.metric}</strong> — {item.detail}
                </p>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {insight.pills.map((pill, i) => (
              <span key={i} style={{
                fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 999,
                background: "rgba(52,199,89,0.10)", color: "#00833A", fontFamily: FONT,
              }}>
                {pill}
              </span>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* 01 — WHY */}
          <div style={{ marginBottom: 12 }}>
            <Eyebrow>01 · Why at #{branch.rank}</Eyebrow>
            <h3 style={{
              fontSize: isMobile ? 22 : 20, fontWeight: 800, letterSpacing: "-0.8px",
              color: T.T1, margin: "4px 0 0", lineHeight: 1.15, fontFamily: FONT,
            }}>
              Root causes for this position
            </h3>
          </div>
          <div style={{
            background: T.cardBg, border: T.BORDER, borderRadius: 20,
            padding: isMobile ? 20 : 22, boxShadow: T.SH_LG, marginBottom: 24,
          }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "5px 11px", borderRadius: 999,
              background: "rgba(123,63,244,0.08)",
              border: "0.5px solid rgba(123,63,244,0.20)", marginBottom: 14,
            }}>
              <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: T.VIOLET }} />
              <span style={{
                fontSize: 9, fontWeight: 800, color: T.VIOLET,
                letterSpacing: "1.4px", textTransform: "uppercase", fontFamily: FONT,
              }}>
                Edullent · Data backed
              </span>
            </div>
            {insight.whyHere.map((item, i) => (
              <div key={i} style={{
                display: "flex", gap: 12, alignItems: "flex-start",
                paddingTop: i > 0 ? 12 : 0, marginTop: i > 0 ? 12 : 0,
                borderTop: i > 0 ? T.BORDER_SOFT : "none",
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%", background: item.color,
                  marginTop: 7, flexShrink: 0,
                }} />
                <p style={{
                  fontSize: isMobile ? 14 : 13, fontWeight: 500, color: T.T1,
                  margin: 0, lineHeight: 1.65, fontFamily: FONT,
                }}>
                  <strong>{item.bold}</strong>{item.rest}
                </p>
              </div>
            ))}
          </div>

          {/* 02 — SOLUTIONS */}
          <div style={{ marginBottom: 12 }}>
            <Eyebrow>02 · {insight.solutionLabel}</Eyebrow>
            <h3 style={{
              fontSize: isMobile ? 22 : 20, fontWeight: 800, letterSpacing: "-0.8px",
              color: T.T1, margin: "4px 0 0", lineHeight: 1.15, fontFamily: FONT,
            }}>
              Specific improvement steps
            </h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {insight.solutions.map((sol, i) => (
              <div key={i} style={{
                background: sol.urgent ? style?.solutionBg || T.cardBg : T.cardBg,
                border: sol.urgent ? (style?.solutionBorder || T.BORDER) : T.BORDER,
                borderRadius: 16, padding: isMobile ? "14px 16px" : "14px 18px",
                boxShadow: T.SH_LG,
              }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{
                    flexShrink: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-1px",
                    color: style?.solutionArrowColor || T.B1,
                    lineHeight: 1, minWidth: 32, fontFamily: FONT,
                  }}>
                    0{i + 1}
                  </span>
                  <div style={{ flex: 1 }}>
                    {sol.urgent && (
                      <div style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "3px 9px", borderRadius: 999,
                        background: style?.solutionBg || "rgba(255,69,58,0.06)",
                        border: style?.solutionBorder || "0.5px solid rgba(255,69,58,0.15)",
                        marginBottom: 6,
                      }}>
                        <AlertTriangle size={9} color={style?.solutionArrowColor || T.RED} strokeWidth={2.5} />
                        <span style={{
                          fontSize: 9, fontWeight: 800, color: style?.solutionArrowColor || T.RED,
                          letterSpacing: "1px", textTransform: "uppercase", fontFamily: FONT,
                        }}>
                          Urgent
                        </span>
                      </div>
                    )}
                    <p style={{
                      fontSize: 13, fontWeight: 500, color: T.T1,
                      margin: 0, lineHeight: 1.65, fontFamily: FONT,
                    }}>
                      {sol.text}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <AIBadge label={`Edullent · ${network.name} · ${network.monthLabel || "Live"}`} />
    </div>
  );
};

export default DetailPanel;
