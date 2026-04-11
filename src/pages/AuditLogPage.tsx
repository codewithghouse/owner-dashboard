import { useEffect, useState, useCallback } from "react";
import {
  Activity, Clock, Download, Loader2, RefreshCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  fetchAuditLog, AuditEntry, AuditAction, ACTION_CONFIG,
} from "@/lib/auditService";
import { toast } from "sonner";

// ── Filter options ────────────────────────────────────────────────────────────
const FILTERS: { value: string; label: string }[] = [
  { value: "all",               label: "All Activity" },
  { value: "branch",            label: "Branches" },
  { value: "principal",         label: "Principals" },
  { value: "deo",               label: "DEO Changes" },
  { value: "alert",             label: "Alerts" },
  { value: "settings_saved",    label: "Settings" },
  { value: "data_exported",     label: "Exports" },
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

// ── Group entries by date ──────────────────────────────────────────────────────
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

  // ── Filter logic ─────────────────────────────────────────────────────────
  const filtered = filter === "all"
    ? entries
    : entries.filter(e => e.action.startsWith(filter));

  const groups = groupByDate(filtered);

  return (
    <div className="max-w-[860px] mx-auto space-y-8 animate-in fade-in duration-500 pb-16">

      {/* ── Header ─────────────────────────────────────────────��──────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-[#1e294b] tracking-tight">Activity Log</h1>
          <p className="text-slate-400 text-sm font-medium mt-1">
            Complete audit trail of all management actions in your school network
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Button
            variant="outline"
            onClick={load}
            className="h-10 px-4 rounded-xl border-slate-200 text-xs font-bold gap-2 hover:bg-slate-50"
          >
            <RefreshCcw className="w-3.5 h-3.5" /> Refresh
          </Button>
          <Button
            onClick={() => exportCSV(filtered)}
            className="h-10 px-4 rounded-xl bg-[#1e3a8a] text-white text-xs font-bold gap-2 shadow-lg shadow-blue-900/10"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      {!loading && entries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Actions",   value: entries.length,                                         color: "text-[#1e3a8a]" },
            { label: "Branches",        value: entries.filter(e => e.action.startsWith("branch")).length,    color: "text-blue-500" },
            { label: "Principals",      value: entries.filter(e => e.action.startsWith("principal")).length, color: "text-emerald-500" },
            { label: "DEO Changes",     value: entries.filter(e => e.action.startsWith("deo")).length,       color: "text-amber-500" },
          ].map((stat, i) => (
            <div key={i} className="bg-white border border-slate-100 rounded-[1.5rem] p-5">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{stat.label}</p>
              <p className={`text-3xl font-black ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Filter tabs ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
              filter === opt.value
                ? "bg-[#1e3a8a] text-white border-[#1e3a8a] shadow-lg shadow-blue-900/10"
                : "bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* ── Feed ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="bg-white rounded-[2rem] border border-slate-100 flex items-center justify-center h-48 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-[#1e3a8a]" />
          <p className="text-sm font-bold text-slate-400">Loading activity...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-[2rem] border border-slate-100 flex flex-col items-center justify-center h-48 gap-3">
          <Activity className="w-10 h-10 text-slate-200" />
          <p className="text-sm font-bold text-slate-400">No activity recorded yet</p>
          <p className="text-xs text-slate-300 text-center max-w-xs">
            Actions like adding branches, inviting principals, and resolving alerts will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <div key={group.date}>
              {/* Date divider */}
              <div className="flex items-center gap-4 mb-4">
                <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">
                  {group.date}
                </span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>

              {/* Entries for this date */}
              <div className="bg-white rounded-[1.5rem] border border-slate-100 overflow-hidden">
                {group.items.map((entry, i) => {
                  const cfg = ACTION_CONFIG[entry.action] ?? {
                    icon: "📝", label: entry.action,
                    color: "bg-slate-50 text-slate-600 border-slate-100",
                  };
                  return (
                    <div
                      key={entry.id}
                      className={`flex items-start gap-4 px-6 py-4 hover:bg-slate-50/50 transition-colors ${
                        i < group.items.length - 1 ? "border-b border-slate-50" : ""
                      }`}
                    >
                      {/* Icon */}
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-base shrink-0 border ${cfg.color}`}>
                        {cfg.icon}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#1e294b] leading-tight">{entry.label}</p>
                            {entry.details && (
                              <p className="text-xs text-slate-400 font-medium mt-0.5 truncate">{entry.details}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[11px] font-bold text-slate-400 flex items-center gap-1 justify-end">
                              <Clock className="w-3 h-3" />
                              {timeAgo(entry.ts)}
                            </p>
                            <p className="text-[10px] text-slate-300 mt-0.5">{timeAbsolute(entry.ts)}</p>
                          </div>
                        </div>
                        <span className={`inline-flex mt-1.5 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${cfg.color}`}>
                          {cfg.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <p className="text-center text-xs text-slate-300 font-medium pb-4">
          Showing {filtered.length} {entries.length >= 200 ? "of 200+ " : ""}entries
          {filtered.length !== entries.length ? ` (filtered from ${entries.length} total)` : ""}
        </p>
      )}
    </div>
  );
}
