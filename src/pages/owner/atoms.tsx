import React from "react";
import { FONT, T } from "./ownerDashboardTokens";

export const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children, color = T.T4,
}) => (
  <p style={{
    fontSize: 10, fontWeight: 800, letterSpacing: "1.6px",
    color, margin: 0, textTransform: "uppercase", fontFamily: FONT,
  }}>
    {children}
  </p>
);

export const TrendBadge: React.FC<{ change: number; trend: "up" | "down" | "same" }> = ({
  change, trend,
}) => {
  const isUp = trend === "up";
  const isFlat = trend === "same";
  const color = isFlat ? T.T4 : isUp ? T.GREEN : T.RED;
  const bg = isFlat
    ? "rgba(153,170,204,0.10)"
    : isUp
      ? "rgba(52,199,89,0.12)"
      : "rgba(255,69,58,0.10)";
  const border = isFlat
    ? "0.5px solid rgba(153,170,204,0.25)"
    : isUp
      ? "0.5px solid rgba(52,199,89,0.25)"
      : "0.5px solid rgba(255,69,58,0.20)";

  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 7px", borderRadius: 999, background: bg, border,
    }}>
      {!isFlat && (
        <svg width="7" height="7" viewBox="0 0 7 7">
          {isUp
            ? <path d="M3.5 1L6 5H1L3.5 1Z" fill={color} />
            : <path d="M3.5 6L1 2H6L3.5 6Z" fill={color} />}
        </svg>
      )}
      <span style={{
        fontSize: 9, fontWeight: 800, color, letterSpacing: "0.8px", fontFamily: FONT,
      }}>
        {isFlat ? "0.0" : `${isUp ? "+" : ""}${Math.abs(change).toFixed(1)}`}
      </span>
    </div>
  );
};

export const AIBadge: React.FC<{ label: string }> = ({ label }) => (
  <div style={{ textAlign: "center", marginTop: 22 }}>
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "6px 14px", borderRadius: 999,
      background: "rgba(123,63,244,0.08)",
      border: "0.5px solid rgba(123,63,244,0.20)",
    }}>
      <span style={{
        display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: T.VIOLET,
      }} />
      <span style={{ fontSize: 10, fontWeight: 700, color: T.VIOLET, fontFamily: FONT }}>
        {label}
      </span>
    </div>
  </div>
);
