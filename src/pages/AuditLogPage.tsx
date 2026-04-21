import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, Clock, Download, Loader2, RefreshCcw,
  Building2, UserCog, FileCog, Bell, Settings, FileDown, Sparkles,
} from "lucide-react";
import {
  fetchAuditLog, AuditEntry, AuditAction, ACTION_CONFIG,
} from "@/lib/auditService";
import { toast } from "sonner";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD, VIOLET,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, GRAD_RED, GRAD_ORANGE,
  SHADOW_SM, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, Card3D, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";

// ── Filter options ────────────────────────────────────────────────────────────
const FILTERS: { value: string; label: string; icon: any; grad: string }[] = [
  { value: "all",            label: "All Activity", icon: Activity,   grad: GRAD_BLUE },
  { value: "branch",         label: "Branches",     icon: Building2,  grad: GRAD_VIOLET },
  { value: "principal",      label: "Principals",   icon: UserCog,    grad: GRAD_GREEN },
  { value: "deo",            label: "DEO Changes",  icon: FileCog,    grad: GRAD_GOLD },
  { value: "alert",          label: "Alerts",       icon: Bell,       grad: GRAD_RED },
  { value: "settings_saved", label: "Settings",     icon: Settings,   grad: GRAD_ORANGE },
  { value: "data_exported",  label: "Exports",      icon: FileDown,   grad: GRAD_PRIMARY },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(ts: any): string {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)        return "just now";
  if (diff < 3600)      return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400)     return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function timeAbsolute(ts: any): string {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function exportCSV(entries: AuditEntry[]) {
  if (!entries.length) { toast.error("No entries to export."); return; }
  const headers = ["Action Type", "Description", "Details", "Timestamp (IST)"];
  const rows = entries.map(e => [
    ACTION_CONFIG[e.action]?.label ?? e.action,
    e.label,
    e.details ?? "",
    e.ts?.toDate ? e.ts.toDate().toLocaleString("en-IN") : "",
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Audit log exported!");
}

function groupByDate(entries: AuditEntry[]): { date: string; items: AuditEntry[] }[] {
  const map = new Map<string, AuditEntry[]>();
  entries.forEach(e => {
    const d = e.ts?.toDate ? e.ts.toDate() : new Date();
    const key = d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  });
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AuditLogPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const pageShellStyle = usePageShellStyle();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchAuditLog(200);
    setEntries(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === "all"
    ? entries
    : entries.filter(e => e.action.startsWith(filter));

  const groups = groupByDate(filtered);

  const branchCount    = entries.filter(e => e.action.startsWith("branch")).length;
  const principalCount = entries.filter(e => e.action.startsWith("principal")).length;
  const deoCount       = entries.filter(e => e.action.startsWith("deo")).length;
  const alertCount     = entries.filter(e => e.action.startsWith("alert")).length;

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 16 : 24 }}>

        <PageHead
          icon={Activity}
          title="Activity Log"
          subtitle="Complete audit trail of all management actions"
          right={
            <div style={{ display:"flex", gap:8, width: isMobile ? "100%" : "auto" }}>
              <button
                onClick={load}
                className="dash-btn"
                style={{
                  display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                  padding: isMobile ? "10px 12px" : "10px 14px", borderRadius:12,
                  background:"#fff", color:T3, border:"0.5px solid rgba(0,85,255,.12)",
                  fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                  cursor:"pointer", boxShadow:SHADOW_SM, fontFamily:"inherit",
                  flex: isMobile ? 1 : undefined,
                }}
              >
                <RefreshCcw size={13}/> Refresh
              </button>
              <button
                onClick={() => exportCSV(filtered)}
                className="dash-btn"
                style={{
                  display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                  padding: isMobile ? "10px 12px" : "10px 16px", borderRadius:12,
                  background:GRAD_PRIMARY, color:"#fff",
                  fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                  border:"none", cursor:"pointer", boxShadow:SHADOW_BTN, fontFamily:"inherit",
                  flex: isMobile ? 1 : undefined,
                }}
              >
                <Download size={13}/> {isMobile ? "Export" : "Export CSV"}
              </button>
            </div>
          }
        />

        {!loading && entries.length > 0 && (
          <DarkHero
            icon={Activity}
            eyebrow={<><Sparkles size={11} style={{ display:"inline", marginRight:4 }}/> Audit Intelligence</> as any}
            title={entries.length.toString()}
            subtitle={`Actions tracked across ${groups.length} day${groups.length!==1?"s":""} · ${filtered.length === entries.length ? "all activity" : `${filtered.length} filtered`}`}
            stats={[
              { label:"Branches",   value: branchCount.toString() },
              { label:"Principals", value: principalCount.toString() },
              { label:"DEO",        value: deoCount.toString() },
            ]}
          />
        )}

        {/* Stats */}
        {!loading && entries.length > 0 && (
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16 }}>
            <StatTile label="Total Actions" value={entries.length.toString()} sub="All time"            grad={GRAD_BLUE}   icon={Activity}   onClick={()=>setFilter("all")} />
            <StatTile label="Branches"      value={branchCount.toString()}   sub="Branch changes"      grad={GRAD_VIOLET} icon={Building2}  onClick={()=>setFilter("branch")} />
            <StatTile label="Principals"    value={principalCount.toString()} sub="Principal actions" grad={GRAD_GREEN}  icon={UserCog}    onClick={()=>setFilter("principal")} />
            <StatTile label="DEO Changes"   value={deoCount.toString()}      sub="DEO lifecycle"       grad={GRAD_GOLD}   icon={FileCog}    onClick={()=>setFilter("deo")} />
          </div>
        )}

        {/* Filter chips — horizontal scroll on mobile for uninterrupted rhythm */}
        <div style={{
          display:"flex",
          flexWrap: isMobile ? "nowrap" : "wrap",
          gap: isMobile ? 6 : 8,
          overflowX: isMobile ? "auto" : "visible",
          paddingBottom: isMobile ? 2 : 0,
          WebkitOverflowScrolling:"touch",
          marginLeft: isMobile ? -14 : 0,
          marginRight: isMobile ? -14 : 0,
          paddingLeft: isMobile ? 14 : 0,
          paddingRight: isMobile ? 14 : 0,
        }}>
          {FILTERS.map(opt => {
            const active = filter === opt.value;
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className="dash-btn"
                style={{
                  display:"inline-flex", alignItems:"center", gap: isMobile ? 5 : 6,
                  padding: isMobile ? "8px 12px" : "9px 16px", borderRadius: isMobile ? 999 : 12,
                  background: active ? opt.grad : "#fff",
                  color: active ? "#fff" : T3,
                  fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                  border: active ? "none" : "0.5px solid rgba(0,85,255,.12)",
                  boxShadow: active ? SHADOW_BTN : SHADOW_SM,
                  cursor:"pointer", fontFamily:"inherit",
                  whiteSpace:"nowrap", flexShrink:0,
                }}
              >
                <Icon size={12}/> {opt.label}
              </button>
            );
          })}
        </div>

        {/* Feed */}
        {loading ? (
          <Card3D padding={isMobile ? "32px 16px" : "40px 24px"}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
              <Loader2 className="animate-spin" size={22} color={B1}/>
              <p style={{ fontSize: isMobile ? 12 : 13, fontWeight:700, color:T3, margin:0 }}>Loading activity...</p>
            </div>
          </Card3D>
        ) : filtered.length === 0 ? (
          <Card3D padding={isMobile ? "36px 16px" : "48px 24px"}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
              <div style={{ width: isMobile ? 52 : 60, height: isMobile ? 52 : 60, borderRadius:18, background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Activity size={isMobile ? 24 : 28} color={T4}/>
              </div>
              <p style={{ fontSize: isMobile ? 12 : 13, fontWeight:800, color:T3, margin:0, textAlign:"center" }}>No activity recorded yet</p>
              <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:500, color:T4, margin:0, textAlign:"center", maxWidth:360, lineHeight:1.5, padding: isMobile ? "0 8px" : 0 }}>
                Actions like adding branches, inviting principals, and resolving alerts will appear here automatically.
              </p>
            </div>
          </Card3D>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap: isMobile ? 16 : 20 }}>
            {groups.map(group => (
              <div key={group.date}>
                <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, marginBottom: isMobile ? 10 : 12 }}>
                  <span style={{ fontSize: isMobile ? 9 : 10, fontWeight:800, color:T4, letterSpacing:"0.14em", textTransform:"uppercase", whiteSpace:"nowrap" }}>
                    {isMobile ? group.date.replace(/,.*/, "") : group.date}
                  </span>
                  <div style={{ flex:1, height:1, background:"rgba(0,85,255,.08)" }}/>
                </div>

                <Card3D padding={0} style={{ overflow:"hidden" }}>
                  {group.items.map((entry, i) => {
                    const cfg = ACTION_CONFIG[entry.action] ?? {
                      icon: "📝", label: entry.action,
                      color: "bg-slate-50 text-slate-600 border-slate-100",
                    };
                    const isLast = i >= group.items.length - 1;
                    return (
                      <div
                        key={entry.id}
                        className="dash-row"
                        style={{
                          display:"flex", alignItems:"flex-start", gap: isMobile ? 11 : 14,
                          padding: isMobile ? "12px 14px" : "14px 20px",
                          borderBottom: isLast ? "none" : "0.5px solid rgba(0,85,255,.05)",
                        }}
                      >
                        <div
                          style={{
                            width: isMobile ? 36 : 40, height: isMobile ? 36 : 40, borderRadius: isMobile ? 11 : 12,
                            display:"flex", alignItems:"center", justifyContent:"center",
                            fontSize: isMobile ? 16 : 18,
                            background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.1)",
                            flexShrink:0,
                          }}
                        >
                          {cfg.icon}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          {isMobile ? (
                            /* Mobile: title/details on top, time chip on the same row — single ellipsis row keeps density */
                            <>
                              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
                                <p style={{ fontSize:12, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.2px", lineHeight:1.4, minWidth:0, flex:1 }}>{entry.label}</p>
                                <p style={{ fontSize:9, fontWeight:800, color:T3, display:"inline-flex", alignItems:"center", gap:3, margin:0, flexShrink:0, whiteSpace:"nowrap" }}>
                                  <Clock size={9}/> {timeAgo(entry.ts)}
                                </p>
                              </div>
                              {entry.details && (
                                <p style={{ fontSize:10, fontWeight:500, color:T3, margin:"3px 0 0 0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                                  {entry.details}
                                </p>
                              )}
                              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginTop:6 }}>
                                <span
                                  style={{
                                    display:"inline-flex",
                                    fontSize:8, fontWeight:800, padding:"3px 7px", borderRadius:999,
                                    background:"rgba(0,85,255,.08)", color:B1,
                                    letterSpacing:"0.12em", textTransform:"uppercase",
                                  }}
                                >
                                  {cfg.label}
                                </span>
                                <span style={{ fontSize:9, fontWeight:600, color:T4, whiteSpace:"nowrap" }}>{timeAbsolute(entry.ts)}</span>
                              </div>
                            </>
                          ) : (
                            <>
                              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:14 }}>
                                <div style={{ minWidth:0 }}>
                                  <p style={{ fontSize:13, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.2px", lineHeight:1.4 }}>{entry.label}</p>
                                  {entry.details && (
                                    <p style={{ fontSize:11, fontWeight:500, color:T3, margin:"3px 0 0 0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                                      {entry.details}
                                    </p>
                                  )}
                                </div>
                                <div style={{ textAlign:"right", flexShrink:0 }}>
                                  <p style={{ fontSize:10, fontWeight:800, color:T3, display:"flex", alignItems:"center", gap:4, justifyContent:"flex-end", margin:0 }}>
                                    <Clock size={10}/> {timeAgo(entry.ts)}
                                  </p>
                                  <p style={{ fontSize:9, fontWeight:600, color:T4, margin:"2px 0 0 0" }}>{timeAbsolute(entry.ts)}</p>
                                </div>
                              </div>
                              <span
                                style={{
                                  display:"inline-flex", marginTop:6,
                                  fontSize:9, fontWeight:800, padding:"3px 8px", borderRadius:999,
                                  background:"rgba(0,85,255,.08)", color:B1,
                                  letterSpacing:"0.12em", textTransform:"uppercase",
                                }}
                              >
                                {cfg.label}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </Card3D>
              </div>
            ))}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <p style={{ textAlign:"center", fontSize:10, fontWeight:700, color:T4, letterSpacing:"0.10em", textTransform:"uppercase", margin:"6px 0" }}>
            Showing {filtered.length} {entries.length >= 200 ? "of 200+ " : ""}entries
            {filtered.length !== entries.length ? ` (filtered from ${entries.length})` : ""}
          </p>
        )}

        {!loading && entries.length > 0 && (
          <AIInsightCard
            title="Audit Intelligence Summary"
            items={[
              { label:"Activity Volume", value: `${entries.length} action${entries.length!==1?"s":""}`, sub: `${groups.length} day${groups.length!==1?"s":""} of records` },
              { label:"Most Active",     value: branchCount > principalCount && branchCount > deoCount ? "Branches" : principalCount > deoCount ? "Principals" : deoCount > 0 ? "DEO" : "Mixed", sub: "Highest change volume" },
              { label:"Alert Signal",    value: alertCount > 0 ? `${alertCount} alert${alertCount!==1?"s":""}` : "No alerts", sub: alertCount > 0 ? "Review context" : "All quiet" },
            ]}
          />
        )}
      </div>
    </>
  );
}