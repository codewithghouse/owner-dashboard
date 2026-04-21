import React from "react";

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
export const GRAD_BLUE = "linear-gradient(135deg,#0055FF 0%,#2277FF 100%)";
export const GRAD_GREEN = "linear-gradient(135deg,#00C853 0%,#33DD77 100%)";
export const GRAD_VIOLET = "linear-gradient(135deg,#7B3FF4 0%,#A060FF 100%)";
export const GRAD_GOLD = "linear-gradient(135deg,#FFAA00 0%,#FFCC33 100%)";
export const GRAD_RED = "linear-gradient(135deg,#FF3355 0%,#FF6677 100%)";
export const GRAD_ORANGE = "linear-gradient(135deg,#FF8800 0%,#FFAA44 100%)";

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

/* Shared hover / 3D CSS — inject once per page by rendering <DashGlobalStyles/> at the top of the return */
export function DashGlobalStyles() {
  return (
    <style>{`
      .dash3d {
        transition: transform .45s cubic-bezier(.2,.9,.25,1.2), box-shadow .35s ease;
        transform-style: preserve-3d;
        will-change: transform;
      }
      .dash3d:hover {
        transform: perspective(1000px) translateY(-6px) rotateX(3deg) rotateY(-3deg) scale(1.015);
        box-shadow: 0 0 0 .5px rgba(0,85,255,.18), 0 22px 54px rgba(0,16,64,.22), 0 6px 18px rgba(0,85,255,.22) !important;
      }
      .dash-tile {
        transition: transform .5s cubic-bezier(.2,.9,.25,1.2), box-shadow .35s ease;
        cursor: pointer;
      }
      .dash-tile:hover {
        transform: perspective(1100px) translateY(-8px) rotateX(4deg) rotateY(-4deg) scale(1.025);
      }
      .dash-card {
        transition: transform .45s cubic-bezier(.2,.9,.25,1.2), box-shadow .35s ease;
      }
      .dash-card:hover {
        transform: perspective(900px) translateY(-8px) rotateX(3deg) scale(1.02);
        box-shadow: 0 0 0 .5px rgba(0,85,255,.18), 0 22px 54px rgba(0,16,64,.22), 0 6px 18px rgba(0,85,255,.22) !important;
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
  return (
    <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:20, marginBottom:22, flexWrap:"wrap" }}>
      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
        <div style={{
          width:48, height:48, borderRadius:14, background:GRAD_PRIMARY,
          display:"flex", alignItems:"center", justifyContent:"center",
          boxShadow:"0 8px 22px rgba(0,85,255,.35)",
        }}>
          <Icon size={24} color="#fff" strokeWidth={2.2}/>
        </div>
        <div>
          <h1 style={{ fontSize:32, fontWeight:700, color:T1, letterSpacing:"-0.8px", margin:0, lineHeight:1.1 }}>{title}</h1>
          <p style={{ fontSize:12, color:T3, fontWeight:500, margin:"5px 0 0 0", letterSpacing:"0.10em", textTransform:"uppercase" }}>
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
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className="dash-tile"
      style={{
        background:grad, borderRadius:22, padding:"20px 22px", color:"#fff",
        position:"relative", overflow:"hidden",
        boxShadow:"0 0 0 .5px rgba(255,255,255,.15), 0 14px 38px rgba(0,85,255,.26), 0 4px 12px rgba(0,85,255,.18)",
      }}
    >
      <div style={{ position:"absolute", top:-30, right:-20, width:110, height:110, background:"radial-gradient(circle, rgba(255,255,255,.22) 0%, transparent 70%)", borderRadius:"50%", pointerEvents:"none" }}/>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, position:"relative", zIndex:1 }}>
        <div style={{ width:38, height:38, borderRadius:12, background:"rgba(255,255,255,.22)", border:"0.5px solid rgba(255,255,255,.28)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Icon size={19} color="#fff" strokeWidth={2.3}/>
        </div>
        {delta && (
          <div style={{ display:"inline-flex", alignItems:"center", gap:3, padding:"4px 8px", borderRadius:8, background:"rgba(255,255,255,.22)", fontSize:10, fontWeight:800, color:"#fff" }}>
            {delta === "up" ? "▲" : "▼"}
          </div>
        )}
      </div>
      <p style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,.75)", letterSpacing:"0.10em", textTransform:"uppercase", margin:"0 0 4px 0", position:"relative", zIndex:1 }}>{label}</p>
      <p style={{ fontSize:30, fontWeight:800, color:"#fff", letterSpacing:"-0.6px", margin:0, lineHeight:1.1, position:"relative", zIndex:1 }}>{value}</p>
      {sub && (
        <p style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,.78)", margin:"6px 0 0 0", position:"relative", zIndex:1 }}>{sub}</p>
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
  return (
    <div
      style={{
        background:GRAD_HERO, borderRadius:24, padding:"24px 28px", color:"#fff",
        marginBottom:24, position:"relative", overflow:"hidden",
        boxShadow:"0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)",
      }}
    >
      <div style={{ position:"absolute", top:-60, right:-40, width:280, height:280, background:"radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 65%)", borderRadius:"50%", pointerEvents:"none" }}/>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:24, flexWrap:"wrap", position:"relative", zIndex:1 }}>
        <div style={{ display:"flex", alignItems:"flex-start", gap:16, flex:1, minWidth:300 }}>
          <div style={{ width:52, height:52, borderRadius:15, background:"rgba(255,255,255,.16)", border:"0.5px solid rgba(255,255,255,.26)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Icon size={26} color="#fff" strokeWidth={2.2}/>
          </div>
          <div>
            {eyebrow && (
              <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 10px", borderRadius:999, background:"rgba(255,255,255,.14)", border:"0.5px solid rgba(255,255,255,.22)", fontSize:10, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:10 }}>
                {eyebrow}
              </div>
            )}
            <h2 style={{ fontSize:38, fontWeight:800, letterSpacing:"-1px", margin:0, color:"#fff", lineHeight:1 }}>
              {title}
            </h2>
            {subtitle && (
              <p style={{ fontSize:13, color:"rgba(255,255,255,.72)", fontWeight:500, margin:"8px 0 0 0" }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {stats && stats.length > 0 && (
          <div style={{ display:"grid", gridTemplateColumns:`repeat(${stats.length}, minmax(120px,1fr))`, gap:10 }}>
            {stats.map(s=>(
              <div key={s.label} style={{ background:"rgba(255,255,255,.10)", borderRadius:14, padding:"12px 14px", border:"0.5px solid rgba(255,255,255,.14)" }}>
                <p style={{ fontSize:9, fontWeight:700, color:"rgba(255,255,255,.65)", letterSpacing:"0.12em", textTransform:"uppercase", margin:"0 0 6px 0" }}>{s.label}</p>
                <p style={{ fontSize:20, fontWeight:800, color:"#fff", margin:0, letterSpacing:"-0.4px" }}>{s.value}</p>
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
  return (
    <div
      style={{
        background:GRAD_HERO, borderRadius:22, padding:"24px 26px", color:"#fff",
        position:"relative", overflow:"hidden",
        boxShadow:"0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)",
      }}
    >
      <div style={{ position:"absolute", bottom:-50, left:-40, width:240, height:240, background:"radial-gradient(circle, rgba(123,63,244,.28) 0%, transparent 65%)", borderRadius:"50%", pointerEvents:"none" }}/>
      <div style={{ display:"flex", alignItems:"flex-start", gap:14, position:"relative", zIndex:1, marginBottom:16 }}>
        <div style={{ width:44, height:44, borderRadius:13, background:"rgba(255,255,255,.16)", border:"0.5px solid rgba(255,255,255,.26)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>
          ✨
        </div>
        <div>
          <div style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:999, background:"rgba(255,255,255,.14)", border:"0.5px solid rgba(255,255,255,.22)", fontSize:9, fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:8 }}>
            AI Insights
          </div>
          <h3 style={{ fontSize:18, fontWeight:700, color:"#fff", margin:0, letterSpacing:"-0.4px" }}>{title}</h3>
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:`repeat(${items.length}, 1fr)`, gap:12, position:"relative", zIndex:1 }}>
        {items.map(c=>(
          <div key={c.label} style={{ background:"rgba(255,255,255,.10)", borderRadius:14, padding:"14px 16px", border:"0.5px solid rgba(255,255,255,.14)" }}>
            <p style={{ fontSize:9, fontWeight:800, color:"rgba(255,255,255,.65)", letterSpacing:"0.14em", textTransform:"uppercase", margin:"0 0 8px 0" }}>{c.label}</p>
            <p style={{ fontSize:15, fontWeight:700, color:"#fff", margin:0, letterSpacing:"-0.3px" }}>{c.value}</p>
            {c.sub && (
              <p style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,.72)", margin:"6px 0 0 0" }}>{c.sub}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}