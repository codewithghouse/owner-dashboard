import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, X, Building2, AlertTriangle, LayoutDashboard, Users,
  BookOpen, DollarSign, FileText, Settings, ShieldCheck, UserCog,
  GraduationCap, GitBranch, ArrowRight, Activity, Brain,
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";

// ── Types ─────────────────────────────────────────────────────────────────────
interface SearchResult {
  id: string;
  label: string;
  sublabel?: string;
  icon: React.ElementType;
  color: string;
  path: string;
  group: "page" | "branch";
}

// ── Static nav results ────────────────────────────────────────────────────────
const NAV_RESULTS: SearchResult[] = [
  { id: "nav-dashboard",  label: "Dashboard",             sublabel: "Overview & live KPIs",       icon: LayoutDashboard, color: "#1e3a8a", path: "/",           group: "page" },
  { id: "nav-students",   label: "Students Intelligence", sublabel: "Student analytics & risks",   icon: Users,           color: "#3b82f6", path: "/students",   group: "page" },
  { id: "nav-teachers",   label: "Teacher Performance",  sublabel: "Teacher metrics & profiles",  icon: GraduationCap,   color: "#8b5cf6", path: "/teachers",   group: "page" },
  { id: "nav-academics",  label: "Academics Overview",   sublabel: "Grades, pass rates, exams",   icon: BookOpen,        color: "#10b981", path: "/academics",  group: "page" },
  { id: "nav-finance",    label: "Finance & Fees",       sublabel: "Fee collection & revenue",    icon: DollarSign,      color: "#f59e0b", path: "/finance",    group: "page" },
  { id: "nav-risks",      label: "Risks & Alerts",       sublabel: "Active risk alerts",          icon: AlertTriangle,   color: "#ef4444", path: "/risks",      group: "page" },
  { id: "nav-branches",   label: "Branches Comparison",  sublabel: "Multi-branch analytics",      icon: GitBranch,       color: "#06b6d4", path: "/branches",   group: "page" },
  { id: "nav-reports",    label: "Reports Center",       sublabel: "Generate & export reports",   icon: FileText,        color: "#ec4899", path: "/reports",    group: "page" },
  { id: "nav-principals", label: "Principal Management", sublabel: "Invite & manage principals",  icon: UserCog,         color: "#1e3a8a", path: "/principals", group: "page" },
  { id: "nav-deo",        label: "DEO Management",       sublabel: "DEO access & approvals",      icon: ShieldCheck,     color: "#10b981", path: "/deo",        group: "page" },
  { id: "nav-audit",      label: "Activity Log",         sublabel: "Audit trail of all actions",  icon: Activity,        color: "#8b5cf6", path: "/audit",        group: "page" },
  { id: "nav-ai",         label: "AI Risk Predictor",    sublabel: "Fail probability per student", icon: Brain,           color: "#7c3aed", path: "/ai-predictor", group: "page" },
  { id: "nav-settings",   label: "Settings",             sublabel: "Profile, thresholds & prefs", icon: Settings,        color: "#6b7280", path: "/settings",     group: "page" },
];

// ── Component ─────────────────────────────────────────────────────────────────
interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SearchModal({ open, onClose }: SearchModalProps) {
  const navigate              = useNavigate();
  const [queryStr, setQueryStr] = useState("");
  const [branches, setBranches] = useState<SearchResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef              = useRef<HTMLInputElement>(null);

  // Load branches once when modal opens
  useEffect(() => {
    if (!open) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDocs(collection(db, "schools", uid, "branches"))
      .then(snap => {
        setBranches(snap.docs.map(d => ({
          id:       d.id,
          label:    d.data().name || "Branch",
          sublabel: d.data().location || "Branch",
          icon:     Building2,
          color:    d.data().color || "#1e3a8a",
          path:     `/branches/${d.data().branchId || d.id}`,
          group:    "branch" as const,
        })));
      })
      .catch(() => {});
    // Focus input after animation
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Reset on close
  useEffect(() => {
    if (!open) { setQueryStr(""); setActiveIdx(0); }
  }, [open]);

  const allResults = [...NAV_RESULTS, ...branches];

  const filtered: SearchResult[] = queryStr.trim().length < 1
    ? allResults.slice(0, 8)
    : allResults.filter(r =>
        r.label.toLowerCase().includes(queryStr.toLowerCase()) ||
        r.sublabel?.toLowerCase().includes(queryStr.toLowerCase())
      ).slice(0, 8);

  const select = useCallback((result: SearchResult) => {
    navigate(result.path);
    onClose();
  }, [navigate, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown")  { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp")    { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && filtered[activeIdx]) select(filtered[activeIdx]);
    if (e.key === "Escape") onClose();
  };

  if (!open) return null;

  // Group results for display
  const pageResults   = filtered.filter(r => r.group === "page");
  const branchResults = filtered.filter(r => r.group === "branch");

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4 animate-in fade-in duration-150"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150">

        {/* ── Search Input ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={queryStr}
            onChange={e => { setQueryStr(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, branches..."
            className="flex-1 text-sm font-medium text-[#1e294b] placeholder:text-slate-400 outline-none bg-transparent"
          />
          {queryStr ? (
            <button onClick={() => setQueryStr("")} className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          ) : (
            <kbd className="px-2 py-1 text-[10px] font-bold bg-slate-100 text-slate-400 rounded-md shrink-0">ESC</kbd>
          )}
        </div>

        {/* ── Results ──────────────────────────────────────────────────── */}
        <div className="py-2 max-h-[340px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Search className="w-8 h-8 text-slate-200" />
              <p className="text-sm text-slate-400 font-medium">No results for "{queryStr}"</p>
            </div>
          ) : (
            <>
              {pageResults.length > 0 && (
                <div>
                  {queryStr && <p className="px-6 py-1.5 text-[9px] font-black text-slate-400 uppercase tracking-widest">Pages</p>}
                  {pageResults.map(result => {
                    const i = filtered.indexOf(result);
                    return <ResultRow key={result.id} result={result} active={activeIdx === i} onSelect={() => select(result)} onHover={() => setActiveIdx(i)} />;
                  })}
                </div>
              )}
              {branchResults.length > 0 && (
                <div>
                  <p className="px-6 py-1.5 text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Branches</p>
                  {branchResults.map(result => {
                    const i = filtered.indexOf(result);
                    return <ResultRow key={result.id} result={result} active={activeIdx === i} onSelect={() => select(result)} onHover={() => setActiveIdx(i)} />;
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer hints ─────────────────────────────────────────────── */}
        <div className="border-t border-slate-50 px-6 py-3 flex items-center gap-5">
          <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">↑↓ Navigate</span>
          <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">↵ Select</span>
          <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">ESC Close</span>
          <span className="ml-auto text-[10px] font-bold text-slate-300">⌘K / Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}

// ── ResultRow sub-component ───────────────────────────────────────────────────
function ResultRow({
  result, active, onSelect, onHover,
}: {
  result: SearchResult; active: boolean; onSelect: () => void; onHover: () => void;
}) {
  const Icon = result.icon;
  return (
    <button
      onClick={onSelect}
      onMouseEnter={onHover}
      className={`w-full flex items-center gap-4 px-6 py-3.5 transition-colors text-left ${
        active ? "bg-slate-50" : "hover:bg-slate-50/60"
      }`}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm"
        style={{ backgroundColor: result.color }}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-[#1e294b] truncate">{result.label}</p>
        {result.sublabel && (
          <p className="text-xs text-slate-400 font-medium truncate">{result.sublabel}</p>
        )}
      </div>
      {active && <ArrowRight className="w-4 h-4 text-slate-300 shrink-0" />}
    </button>
  );
}
