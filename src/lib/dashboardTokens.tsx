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
// Premium soft pastel 2-stop gradients — almost-white with a subtle tint.
// Designed to pair with saturated solid icon badges for an aesthetic premium feel.
export const GRAD_BLUE   = "linear-gradient(135deg,#F7FAFF 0%,#EEF3FF 100%)";
export const GRAD_GREEN  = "linear-gradient(135deg,#F5FCF8 0%,#E9F8EF 100%)";
export const GRAD_VIOLET = "linear-gradient(135deg,#FAF7FF 0%,#F2EBFF 100%)";
export const GRAD_GOLD   = "linear-gradient(135deg,#FFFCF0 0%,#FEF5DC 100%)";
export const GRAD_RED    = "linear-gradient(135deg,#FEF8F9 0%,#FCEAEE 100%)";
export const GRAD_ORANGE = "linear-gradient(135deg,#FFF9F0 0%,#FDECD3 100%)";

export const SHADOW_SM = "0 2px 4px rgba(0,85,255,.10), 0 6px 14px rgba(0,85,255,.14), 0 16px 32px rgba(0,85,255,.14)";
export const SHADOW_LG = "0 4px 8px rgba(0,85,255,.12), 0 12px 24px rgba(0,85,255,.16), 0 28px 56px rgba(0,85,255,.18)";
export const SHADOW_BTN = "0 6px 22px rgba(0,85,255,.40), 0 2px 5px rgba(0,85,255,.20)";

/*
 * Page-shell styling.
 *
 * AppLayout's main content wrapper has Tailwind padding `p-4` on mobile
 * (= 16px each side) and `lg:px-8 lg:pt-6 lg:pb-8` on desktop (= 32px sides).
 * To make pages feel edge-to-edge we apply matching NEGATIVE margins so the
 * shell breaks out of that padding, then re-add our own internal padding.
 *
 * Critical guards (added 2026-04-27 after a mobile overflow regression):
 *   • `boxSizing: border-box`  — padding stays inside the box, never widens it.
 *   • `width: auto`            — the negative margin sets the visual extent;
 *                                width auto lets the box fit inside parent.
 *   • `maxWidth: 100vw`        — hard ceiling so a rogue child can never push
 *                                the shell past the viewport on mobile.
 *   • `overflowX: hidden`      — final clip, in case some descendant ignores
 *                                the rules above (charts, fixed-width tables).
 *
 * MAGIC NUMBERS — keep in sync with AppLayout's <main> wrapper padding:
 *   mobile  parent p-4  = 16px → margin: -16px
 *   desktop parent lg:px-8 = 32px → margin: -32px
 */
export const pageShellStyle: React.CSSProperties = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  background: "#EEF4FF",
  minHeight: "100vh",
  margin: "-32px -32px 0",
  padding: "24px 32px 40px",
  boxSizing: "border-box",
  width: "auto",
  maxWidth: "100vw",
  overflowX: "hidden",
};

/* Hook-based responsive version of pageShellStyle. Use instead of importing pageShellStyle directly.
 *
 * IMPORTANT MOBILE FIX (2026-04-27): The previous "negative margin to break out
 * of parent padding" trick (margin: -16px) collapsed on mobile in some
 * Chromium / WebKit configurations — the page shell ended up rendered as a
 * narrow column on the right. The fix is to NOT use negative margins on
 * mobile at all. Instead, we let AppLayout's <main> p-4 padding stand and
 * use width:100% inside it. We lose the strict edge-to-edge feel on mobile
 * but the layout becomes bullet-proof.
 *
 * Desktop still uses the negative-margin trick because there it works
 * reliably and the visual benefit is bigger (page hero feels more premium).
 */
export function usePageShellStyle(): React.CSSProperties {
  const isMobile = useIsMobile();
  return {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    background: "#EEF4FF",
    minHeight: "100vh",
    // Mobile: NO negative margin. Just sit inside parent padding with full width.
    margin: isMobile ? 0 : "-32px -32px 0",
    padding: isMobile ? "8px 0 28px" : "24px 32px 40px",
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "100%",
    // Use `clip` not `hidden` — clip also contains 3D-transformed children
    // that escape an overflow:hidden boundary via stacking context promotion.
    overflowX: "clip",
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
        transform: translate3d(0,-7px,0);
        box-shadow: 0 8px 16px rgba(0,85,255,.20), 0 24px 40px rgba(0,85,255,.24), 0 40px 80px rgba(0,85,255,.26) !important;
      }
      .dash-tile {
        transition: transform .22s cubic-bezier(0.2,0.8,0.2,1), box-shadow .22s ease;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        cursor: pointer;
      }
      .dash-tile:hover {
        transform: translate3d(0,-7px,0);
        box-shadow: 0 8px 16px rgba(0,85,255,.20), 0 24px 40px rgba(0,85,255,.24), 0 40px 80px rgba(0,85,255,.26) !important;
      }
      .dash-card {
        transition: transform .22s cubic-bezier(0.2,0.8,0.2,1), box-shadow .22s ease;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
      }
      .dash-card:hover {
        transform: translate3d(0,-7px,0);
        box-shadow: 0 8px 16px rgba(0,85,255,.20), 0 24px 40px rgba(0,85,255,.24), 0 40px 80px rgba(0,85,255,.26) !important;
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
          <h1 style={{ fontSize: isMobile ? 20 : 28, fontWeight:700, color:T1, letterSpacing: isMobile ? "-0.4px" : "-0.6px", margin:0, lineHeight:1.15 }}>{title}</h1>
          <p style={{ fontSize: isMobile ? 12 : 14, color:T3, fontWeight:500, margin:"4px 0 0 0", letterSpacing:0 }}>
            {subtitle}
          </p>
        </div>
      </div>
      {right}
    </div>
  );
}

/* Map known gradient constants → solid accent color for the badge / decoration */
export const GRAD_ACCENTS: Record<string, string> = {
  [GRAD_BLUE]:   "#4F46E5",
  [GRAD_GREEN]:  "#10B981",
  [GRAD_VIOLET]: "#7C3AED",
  [GRAD_GOLD]:   "#F59E0B",
  [GRAD_RED]:    "#DC2626",
  [GRAD_ORANGE]: "#F97316",
};

/* Bright stat tile (clickable) — premium aesthetic style: mild pastel bg,
   solid colored badge top-left, faded decorative icon bottom-right. */
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
  const accent = GRAD_ACCENTS[grad] || "#4F46E5";
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className="dash-tile"
      style={{
        background:grad, borderRadius: isMobile ? 16 : 22, padding: isMobile ? "14px 14px" : "20px 22px", color:T1,
        position:"relative", overflow:"hidden",
        boxShadow:"0 4px 8px rgba(0,85,255,.12), 0 12px 24px rgba(0,85,255,.16), 0 28px 56px rgba(0,85,255,.18)",
      }}
    >
      {/* Decorative faded icon — bottom-right */}
      <div style={{ position:"absolute", bottom: isMobile ? 8 : 12, right: isMobile ? 10 : 16, color: accent, opacity: 0.22, pointerEvents:"none", lineHeight: 0 }}>
        <Icon size={isMobile ? 48 : 64} strokeWidth={2}/>
      </div>
      {/* Solid icon badge — top-left */}
      <div style={{ width: isMobile ? 36 : 44, height: isMobile ? 36 : 44, borderRadius: isMobile ? 10 : 12, display:"flex", alignItems:"center", justifyContent:"center", background: accent, marginBottom: isMobile ? 10 : 14, boxShadow: `0 4px 12px ${accent}33`, position:"relative", zIndex:1 }}>
        <Icon size={isMobile ? 18 : 20} color="#FFFFFF" strokeWidth={2.5}/>
      </div>
      {delta && (
        <div style={{ position:"absolute", top: isMobile ? 14 : 20, right: isMobile ? 14 : 20, display:"inline-flex", alignItems:"center", gap:3, padding:"4px 8px", borderRadius:8, background: `${accent}1A`, fontSize:10, fontWeight:800, color: accent, zIndex:1 }}>
          {delta === "up" ? "▲" : "▼"}
        </div>
      )}
      <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:700, color:"#94A3B8", letterSpacing:"0.10em", textTransform:"uppercase", margin:"0 0 6px 0", position:"relative", zIndex:1 }}>{label}</p>
      <p style={{ fontSize: isMobile ? 22 : 30, fontWeight:800, color:"#0F172A", letterSpacing:"-0.6px", margin:0, lineHeight:1.1, position:"relative", zIndex:1 }}>{value}</p>
      {sub && (
        <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:"#64748B", margin:"6px 0 0 0", position:"relative", zIndex:1 }}>{sub}</p>
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