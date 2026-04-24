import React from "react";
import { useIsMobile } from "@/hooks/use-mobile";

/* ─── Principal/Owner dashboard design tokens ─── */
export const B1 = "#0055FF";
export const B2 = "#1166FF";
export const T1 = "#001040";
export const T3 = "#5070B0";
export const T4 = "#99AACC";
export const GREEN = "#00C853";
export const RED = "#FF3355";
export const ORANGE = "#FF8800";
export const GOLD = "#FFAA00";
export const VIOLET = "#7B3FF4";

export const GRAD_PRIMARY = `linear-gradient(135deg, ${B1}, ${B2})`;
export const GRAD_HERO = "linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)";
// Mild pastel 3-stop gradients — paired with dark ink text for readability.
export const GRAD_BLUE = "linear-gradient(140deg,#F0F5FF 0%,#DCE7FF 55%,#C8D8FF 100%)";
export const GRAD_GREEN = "linear-gradient(140deg,#EAFBF1 0%,#CFEEDA 55%,#B4E2C2 100%)";
export const GRAD_VIOLET = "linear-gradient(140deg,#F6EEFF 0%,#E7D6FF 55%,#D6BEFF 100%)";
export const GRAD_GOLD = "linear-gradient(140deg,#FFFAE0 0%,#FFEEB0 55%,#FFE082 100%)";
export const GRAD_RED = "linear-gradient(140deg,#FFECEE 0%,#FFCAD2 55%,#FFA8B4 100%)";
export const GRAD_ORANGE = "linear-gradient(140deg,#FFF3E0 0%,#FFDBB5 55%,#FFC388 100%)";

export const SHADOW_SM = "0 0 0 .5px rgba(0,85,255,.08), 0 2px 8px rgba(0,85,255,.08), 0 10px 26px rgba(0,85,255,.10)";
export const SHADOW_LG = "0 0 0 .5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.11), 0 18px 44px rgba(0,85,255,.13)";
export const SHADOW_BTN = "0 6px 22px rgba(0,85,255,.40), 0 2px 5px rgba(0,85,255,.20)";

export const pageShellStyle: React.CSSProperties = {
  fontFamily: "'DM Sans', -apple-system, sans-serif",
  background: "#EEF4FF",
  minHeight: "100vh",
  margin: "-16px -24px 0",
  padding: "24px 32px 40px",
};

/* Hook-based responsive version of pageShellStyle. Use instead of importing pageShellStyle directly. */
export function usePageShellStyle(): React.CSSProperties {
  const isMobile = useIsMobile();
  return {
    fontFamily: "'DM Sans', -apple-system, sans-serif",
    background: "#EEF4FF",
    minHeight: "100vh",
    margin: isMobile ? "-12px -12px 0" : "-16px -24px 0",
    padding: isMobile ? "16px 14px 28px" : "24px 32px 40px",
  };
}

/* Shared hover / 3D CSS — inject once per page by rendering <DashGlobalStyles/> at the top of the return */
export function DashGlobalStyles() {
  return (
    <style>{`
      .dash3d {
        transition: transform .22s cubic-bezier(0.2,0.8,0.2,1), box-shadow .22s ease;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        will-change: transform;
      }
      .dash3d:hover {
        transform: translate3d(0,-5px,0) scale(1.02);
        box-shadow: 0 0 0 .5px rgba(0,85,255,.14), 0 8px 24px rgba(0,85,255,.16), 0 20px 46px rgba(0,85,255,.18) !important;
      }
      .dash-tile {
        transition: transform .22s cubic-bezier(0.2,0.8,0.2,1), box-shadow .22s ease;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        cursor: pointer;
      }
      .dash-tile:hover {
        transform: translate3d(0,-5px,0) scale(1.02);
        box-shadow: 0 0 0 .5px rgba(0,85,255,.14), 0 8px 24px rgba(0,85,255,.16), 0 20px 46px rgba(0,85,255,.18) !important;
      }
      .dash-card {
        transition: transform .22s cubic-bezier(0.2,0.8,0.2,1), box-shadow .22s ease;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
      }
      .dash-card:hover {
        transform: translate3d(0,-5px,0) scale(1.02);
        box-shadow: 0 0 0 .5px rgba(0,85,255,.14), 0 8px 24px rgba(0,85,255,.16), 0 20px 46px rgba(0,85,255,.18) !important;
      }
      .dash-row {
        transition: transform .3s ease, background .2s ease;
      }
      .dash-row:hover {
        transform: translateX(4px);
        background: rgba(0,85,255,.04) !important;
      }
      .dash-btn {
        transition: transform .2s ease, box-shadow .2s ease, background .2s ease;
      }
      .dash-btn:hover {
        transform: translateY(-1px);
      }
    `}</style>
  );
}

/* Page head component — icon chip + title + subtitle + optional right slot */
export function PageHead({
  icon: Icon,
  title,
  subtitle,
  right,
}: {
  icon: any;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  return (
    <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap: isMobile ? 12 : 20, marginBottom: isMobile ? 16 : 22, flexWrap:"wrap" }}>
      <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 14, minWidth:0, flex: isMobile ? "1 1 auto" : undefined }}>
        <div style={{
          width: isMobile ? 40 : 48, height: isMobile ? 40 : 48, borderRadius: isMobile ? 12 : 14, background:GRAD_PRIMARY,
          display:"flex", alignItems:"center", justifyContent:"center",
          boxShadow:"0 8px 22px rgba(0,85,255,.35)", flexShrink:0,
        }}>
          <Icon size={isMobile ? 20 : 24} color="#fff" strokeWidth={2.2}/>
        </div>
        <div style={{ minWidth:0 }}>
          <h1 style={{ fontSize: isMobile ? 20 : 32, fontWeight:700, color:T1, letterSpacing: isMobile ? "-0.4px" : "-0.8px", margin:0, lineHeight:1.1 }}>{title}</h1>
          <p style={{ fontSize: isMobile ? 10 : 12, color:T3, fontWeight:500, margin:"5px 0 0 0", letterSpacing:"0.10em", textTransform:"uppercase" }}>
            {subtitle}
          </p>
        </div>
      </div>
      {right}
    </div>
  );
}

/* Bright stat tile (clickable) */
export function StatTile({
  label,
  value,
  sub,
  grad,
  icon: Icon,
  onClick,
  delta,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  grad: string;
  icon: any;
  onClick?: () => void;
  delta?: "up" | "down" | null;
}) {
  const isMobile = useIsMobile();
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className="dash-tile"
      style={{
        background:grad, borderRadius: isMobile ? 16 : 22, padding: isMobile ? "14px 14px" : "20px 22px", color:T1,
        position:"relative", overflow:"hidden",
        boxShadow:"0 0 0 .5px rgba(0,16,64,.06), 0 10px 28px rgba(0,85,255,.12), 0 4px 12px rgba(0,85,255,.08)",
      }}
    >
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMobile ? 10 : 14, position:"relative", zIndex:1 }}>
        <div style={{ width: isMobile ? 32 : 38, height: isMobile ? 32 : 38, borderRadius: isMobile ? 10 : 12, background:"rgba(255,255,255,.65)", border:"0.5px solid rgba(0,16,64,.08)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Icon size={isMobile ? 16 : 19} color={T1} strokeWidth={2.4}/>
        </div>
        {delta && (
          <div style={{ display:"inline-flex", alignItems:"center", gap:3, padding:"4px 8px", borderRadius:8, background:"rgba(255,255,255,.55)", fontSize:10, fontWeight:800, color:T1 }}>
            {delta === "up" ? "▲" : "▼"}
          </div>
        )}
      </div>
      <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:800, color:T3, letterSpacing:"0.10em", textTransform:"uppercase", margin:"0 0 4px 0", position:"relative", zIndex:1 }}>{label}</p>
      <p style={{ fontSize: isMobile ? 22 : 30, fontWeight:800, color:T1, letterSpacing:"-0.6px", margin:0, lineHeight:1.1, position:"relative", zIndex:1 }}>{value}</p>
      {sub && (
        <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:T3, margin:"6px 0 0 0", position:"relative", zIndex:1 }}>{sub}</p>
      )}
    </div>
  );
}

/* Dark hero banner with icon + title + subtitle + stats */
export function DarkHero({
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  stats,
}: {
  icon: any;
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: string;
  stats?: { label: string; value: React.ReactNode }[];
}) {
  const isMobile = useIsMobile();
  return (
    <div
      className="dash3d"
      style={{
        background:GRAD_HERO, borderRadius: isMobile ? 18 : 24, padding: isMobile ? "18px 18px" : "24px 28px", color:"#fff",
        marginBottom: isMobile ? 16 : 24, position:"relative", overflow:"hidden",
        boxShadow:"0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)",
      }}
    >
      <div style={{ position:"absolute", top:-60, right:-40, width:280, height:280, background:"radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 65%)", borderRadius:"50%", pointerEvents:"none" }}/>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap: isMobile ? 14 : 24, flexWrap:"wrap", position:"relative", zIndex:1 }}>
        <div style={{ display:"flex", alignItems:"flex-start", gap: isMobile ? 12 : 16, flex:1, minWidth: isMobile ? 0 : 300 }}>
          <div style={{ width: isMobile ? 42 : 52, height: isMobile ? 42 : 52, borderRadius: isMobile ? 12 : 15, background:"rgba(255,255,255,.16)", border:"0.5px solid rgba(255,255,255,.26)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Icon size={isMobile ? 20 : 26} color="#fff" strokeWidth={2.2}/>
          </div>
          <div style={{ minWidth:0 }}>
            {eyebrow && (
              <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 10px", borderRadius:999, background:"rgba(255,255,255,.14)", border:"0.5px solid rgba(255,255,255,.22)", fontSize: isMobile ? 9 : 10, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:10 }}>
                {eyebrow}
              </div>
            )}
            <h2 style={{ fontSize: isMobile ? 28 : 38, fontWeight:800, letterSpacing: isMobile ? "-0.6px" : "-1px", margin:0, color:"#fff", lineHeight:1 }}>
              {title}
            </h2>
            {subtitle && (
              <p style={{ fontSize: isMobile ? 11 : 13, color:"rgba(255,255,255,.72)", fontWeight:500, margin:"8px 0 0 0" }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {stats && stats.length > 0 && (
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? `repeat(${stats.length}, 1fr)` : `repeat(${stats.length}, minmax(120px,1fr))`, gap: isMobile ? 8 : 10, width: isMobile ? "100%" : "auto" }}>
            {stats.map(s=>(
              <div key={s.label} style={{ background:"rgba(255,255,255,.10)", borderRadius: isMobile ? 12 : 14, padding: isMobile ? "10px 10px" : "12px 14px", border:"0.5px solid rgba(255,255,255,.14)" }}>
                <p style={{ fontSize: isMobile ? 8 : 9, fontWeight:700, color:"rgba(255,255,255,.65)", letterSpacing:"0.10em", textTransform:"uppercase", margin:"0 0 6px 0" }}>{s.label}</p>
                <p style={{ fontSize: isMobile ? 16 : 20, fontWeight:800, color:"#fff", margin:0, letterSpacing:"-0.4px" }}>{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* White card wrapper with 3D hover */
export function Card3D({
  children,
  padding = "22px 24px",
  onClick,
  style,
}: {
  children: React.ReactNode;
  padding?: string | number;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <div
      onClick={onClick}
      className="dash3d"
      style={{
        background:"#fff", borderRadius:22, padding,
        boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* AI Intelligence dark footer card */
export function AIInsightCard({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string; sub?: string }[];
}) {
  const isMobile = useIsMobile();
  return (
    <div
      className="dash3d"
      style={{
        background:GRAD_HERO, borderRadius: isMobile ? 16 : 22, padding: isMobile ? "18px 16px" : "24px 26px", color:"#fff",
        position:"relative", overflow:"hidden",
        boxShadow:"0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)",
      }}
    >
      <div style={{ position:"absolute", bottom:-50, left:-40, width:240, height:240, background:"radial-gradient(circle, rgba(123,63,244,.28) 0%, transparent 65%)", borderRadius:"50%", pointerEvents:"none" }}/>
      <div style={{ display:"flex", alignItems:"flex-start", gap: isMobile ? 12 : 14, position:"relative", zIndex:1, marginBottom: isMobile ? 14 : 16 }}>
        <div style={{ width: isMobile ? 38 : 44, height: isMobile ? 38 : 44, borderRadius: isMobile ? 11 : 13, background:"rgba(255,255,255,.16)", border:"0.5px solid rgba(255,255,255,.26)", display:"flex", alignItems:"center", justifyContent:"center", fontSize: isMobile ? 18 : 22, flexShrink:0 }}>
          ✨
        </div>
        <div style={{ minWidth:0 }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:999, background:"rgba(255,255,255,.14)", border:"0.5px solid rgba(255,255,255,.22)", fontSize:9, fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:8 }}>
            AI Insights
          </div>
          <h3 style={{ fontSize: isMobile ? 15 : 18, fontWeight:700, color:"#fff", margin:0, letterSpacing:"-0.4px" }}>{title}</h3>
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${items.length}, 1fr)`, gap: isMobile ? 10 : 12, position:"relative", zIndex:1 }}>
        {items.map(c=>(
          <div key={c.label} style={{ background:"rgba(255,255,255,.10)", borderRadius: isMobile ? 12 : 14, padding: isMobile ? "12px 14px" : "14px 16px", border:"0.5px solid rgba(255,255,255,.14)" }}>
            <p style={{ fontSize:9, fontWeight:800, color:"rgba(255,255,255,.65)", letterSpacing:"0.14em", textTransform:"uppercase", margin:"0 0 8px 0" }}>{c.label}</p>
            <p style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:"#fff", margin:0, letterSpacing:"-0.3px" }}>{c.value}</p>
            {c.sub && (
              <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:"rgba(255,255,255,.72)", margin:"6px 0 0 0" }}>{c.sub}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}