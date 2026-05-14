import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, BarChart, Bar,
} from "recharts";
import {
  ArrowLeft, CheckCircle, AlertTriangle, Building2, Loader2,
  Plus, Pencil, Trash2, X, Save,
  BarChart3, CircleDollarSign, GraduationCap, CalendarCheck2,
  Sparkles, FileText, Activity, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD, VIOLET,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, GRAD_RED,
  SHADOW_SM, SHADOW_LG, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, Card3D, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";
import { tilt3D, tilt3DStyle } from "@/lib/use3DTilt";
import {
  subscribeBranchesComparison, subscribeBranchDetail,
  BranchComparisonData, BranchDetailData,
  ComparisonRow, ComparisonCell, ComparisonMetricKey,
  WinnerCallout, BranchSummary,
} from "@/lib/branchesService";
import { buildReport, openReportWindow, type ReportSection } from "@/lib/reportTemplate";
import { Trophy, Crown } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, getDocs, query, where,
} from "firebase/firestore";
import { invalidateCache } from "@/lib/analyticsService";
import { addAuditLog } from "@/lib/auditService";
import { toast } from "sonner";

// ── Branch CRUD helpers ───────────────────────────────────────────────────────
const BRANCH_COLORS = ["#1e3a8a","#3b82f6","#f59e0b","#10b981","#8b5cf6","#ec4899","#06b6d4","#f97316"];

interface BranchForm {
  name: string;
  location: string;
  established: string;
  color: string;
}
const EMPTY_FORM: BranchForm = { name: "", location: "", established: "", color: "#1e3a8a" };

// ── Branch Modal (Add / Edit) ─────────────────────────────────────────────────
function BranchModal({
  open, mode, form, docId, onClose, onChange, onSave, saving
}: {
  open: boolean; mode: "add" | "edit";
  form: BranchForm; docId: string;
  onClose: () => void;
  onChange: (f: BranchForm) => void;
  onSave: () => void;
  saving: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-3 md:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl md:rounded-[2rem] shadow-2xl w-full max-w-md p-5 md:p-8 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5 md:mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4 md:w-5 md:h-5 text-[#1e3a8a]" />
            </div>
            <h2 className="text-base md:text-lg font-black text-[#1e293b] truncate">
              {mode === "add" ? "Add New Branch" : "Edit Branch"}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-50 transition-colors shrink-0">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Branch Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => onChange({ ...form, name: e.target.value })}
              placeholder="e.g. Main Campus, North Branch"
              className="w-full h-12 px-4 rounded-2xl border border-slate-100 bg-slate-50 text-sm font-semibold text-[#1e293b] outline-none focus:border-blue-300 focus:bg-white transition-all"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Location / City</label>
            <input
              type="text"
              value={form.location}
              onChange={e => onChange({ ...form, location: e.target.value })}
              placeholder="e.g. Mumbai, Delhi, Pune"
              className="w-full h-12 px-4 rounded-2xl border border-slate-100 bg-slate-50 text-sm font-semibold text-[#1e293b] outline-none focus:border-blue-300 focus:bg-white transition-all"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Established Year</label>
            {/* Digits-only via onChange filter — `maxLength` alone allowed
                "abcd" through. inputMode="numeric" hints mobile keyboards to
                show the number pad. We strip non-digits eagerly so even paste
                from clipboard gets sanitised. */}
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={form.established}
              onChange={e => onChange({
                ...form,
                established: e.target.value.replace(/\D/g, "").slice(0, 4),
              })}
              placeholder="e.g. 2018"
              maxLength={4}
              className="w-full h-12 px-4 rounded-2xl border border-slate-100 bg-slate-50 text-sm font-semibold text-[#1e293b] outline-none focus:border-blue-300 focus:bg-white transition-all"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Branch Color</label>
            <div className="flex items-center gap-3 flex-wrap">
              {BRANCH_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange({ ...form, color: c })}
                  className={`w-9 h-9 rounded-xl transition-all ${form.color === c ? "ring-2 ring-offset-2 ring-blue-400 scale-110" : "hover:scale-105"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={e => onChange({ ...form, color: e.target.value })}
                className="w-9 h-9 rounded-xl cursor-pointer border border-slate-100"
                title="Custom color"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6 md:mt-8">
          <button
            onClick={onClose}
            className="flex-1 h-11 md:h-12 rounded-2xl border border-slate-100 text-[13px] md:text-sm font-black text-slate-500 hover:bg-slate-50 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.name.trim()}
            className="flex-1 h-11 md:h-12 rounded-2xl bg-[#1e294b] text-white text-[13px] md:text-sm font-black hover:bg-[#1e3a8a] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {mode === "add" ? "Add Branch" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirm Modal ──────────────────────────────────────────────────────
interface OrphanCounts {
  loading: boolean;
  teachers: number;
  students: number;
}

function DeleteModal({
  open, branchName, orphans, onClose, onConfirm, deleting
}: {
  open: boolean; branchName: string;
  orphans: OrphanCounts;
  onClose: () => void; onConfirm: () => void; deleting: boolean;
}) {
  if (!open) return null;
  /* When the count finishes loading and is non-zero, highlight the impact in
     amber/rose so the Owner sees concrete consequences before clicking delete.
     Generic "X may remain in the system" copy was easy to skim past — actual
     numbers force a beat of consideration. */
  const hasOrphans = !orphans.loading && (orphans.teachers > 0 || orphans.students > 0);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-3 md:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl md:rounded-[2rem] shadow-2xl w-full max-w-sm p-5 md:p-8 animate-in zoom-in-95 duration-200">
        <div className="flex flex-col items-center text-center gap-3 md:gap-4">
          <div className="w-14 h-14 md:w-16 md:h-16 rounded-xl md:rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center">
            <Trash2 className="w-7 h-7 md:w-8 md:h-8 text-rose-500" />
          </div>
          <div>
            <h2 className="text-base md:text-lg font-black text-[#1e293b]">Delete Branch?</h2>
            <p className="text-[13px] md:text-sm text-slate-400 font-medium mt-2 leading-relaxed">
              You're about to delete <strong className="text-[#1e293b]">{branchName}</strong>.
            </p>
          </div>
          {/* Impact panel — counts orphan teachers + students linked by branchId */}
          <div className={`w-full px-4 py-3 rounded-xl border text-left ${
            hasOrphans
              ? "bg-amber-50 border-amber-200"
              : "bg-slate-50 border-slate-100"
          }`}>
            {orphans.loading ? (
              <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Checking what depends on this branch…
              </div>
            ) : hasOrphans ? (
              <>
                <p className="text-[11px] font-black text-amber-700 uppercase tracking-widest mb-1.5">
                  ⚠ Will be left without a branch
                </p>
                <ul className="text-[12px] font-semibold text-amber-900 space-y-0.5">
                  {orphans.teachers > 0 && (
                    <li>· {orphans.teachers} teacher{orphans.teachers !== 1 ? "s" : ""}</li>
                  )}
                  {orphans.students > 0 && (
                    <li>· {orphans.students} student{orphans.students !== 1 ? "s" : ""}</li>
                  )}
                </ul>
                <p className="text-[11px] text-amber-700/80 mt-2 leading-snug">
                  Records remain in the system but lose their branch link. Reassign them after deletion to restore filtering & reporting.
                </p>
              </>
            ) : (
              <p className="text-[12px] font-semibold text-slate-500">
                No teachers or students currently linked to this branch — safe to delete.
              </p>
            )}
          </div>
          <div className="flex gap-3 w-full mt-1">
            <button
              onClick={onClose}
              className="flex-1 h-11 md:h-12 rounded-2xl border border-slate-100 text-[13px] md:text-sm font-black text-slate-500 hover:bg-slate-50 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={deleting || orphans.loading}
              className="flex-1 h-11 md:h-12 rounded-2xl bg-rose-500 text-white text-[13px] md:text-sm font-black hover:bg-rose-600 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Local tokens (owner-dashboard tokens only export T1/T3/T4; T2 is the
//    secondary deep blue between them, matching teacher-dashboard's scale). ─
const T2 = "#002080";

// ── Per-metric value color ramp (shared by card + matrix) ───────────────────
function valueColorForMetric(metricKey: ComparisonMetricKey, v: number, hasData: boolean): string {
  if (!hasData) return "#CBD5E1";
  // For "lower is better" metrics (alerts, failures), invert: 0 = green, big = red
  if (metricKey === "activeAlerts" || metricKey === "failedTestCount") {
    return v === 0 ? "#10B981" : v <= 3 ? "#3B82F6" : v <= 8 ? "#F59E0B" : "#F43F5E";
  }
  // Higher is better — pct ramp
  return v >= 85 ? "#10B981" : v >= 70 ? "#3B82F6" : v >= 50 ? "#F59E0B" : "#F43F5E";
}

// ── Winners Strip — horizontal scroll of metric leaders, page-top ─────────────
const WinnersStripImpl: React.FC<{ winners: WinnerCallout[]; isMobile: boolean }> = ({ winners, isMobile }) => {
  if (winners.length === 0) return null;
  return (
    <div className="bg-white rounded-2xl md:rounded-[1.5rem] p-4 md:p-5"
      style={{ boxShadow: SHADOW_SM, border: "0.5px solid rgba(0,85,255,0.10)" }}>
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="w-4 h-4" style={{ color: GOLD }} strokeWidth={2.5} />
        <span className="text-[10px] md:text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: T3 }}>
          Metric Leaders
        </span>
      </div>
      <div className={`flex gap-2 ${isMobile ? "overflow-x-auto pb-1" : "flex-wrap"}`} style={{ scrollbarWidth: "none" }}>
        {winners.map(w => (
          <div key={`${w.metricKey}_${w.branchId}`}
            className="shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${w.branchColor}10 0%, ${w.branchColor}22 100%)`,
              border: `0.5px solid ${w.branchColor}55`,
            }}>
            <div className="w-6 h-6 rounded-md flex items-center justify-center"
              style={{ background: w.branchColor, boxShadow: `0 2px 6px ${w.branchColor}55` }}>
              <Crown className="w-3 h-3 text-white" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] font-black uppercase tracking-wider" style={{ color: T4 }}>
                {w.metricLabel}
              </div>
              <div className="text-[12px] font-bold whitespace-nowrap" style={{ color: T1 }}>
                {w.branchName} <span style={{ color: w.branchColor }}>· {w.display}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Comparison Matrix — branches × metrics table, page-top headline view ────
const ComparisonMatrixImpl: React.FC<{
  rows: ComparisonRow[];
  branches: BranchSummary[];
  isMobile: boolean;
  onBranchClick: (id: string) => void;
}> = ({ rows, branches, isMobile, onBranchClick }) => {
  const visibleRows = rows.filter(r => r.hasAnyData);
  if (visibleRows.length === 0 || branches.length === 0) return null;

  // Mobile = vertical layout (metric cards listing each branch's value).
  // Desktop = real table (rows = metrics, cols = branches).
  if (isMobile) {
    return (
      <div className="bg-white rounded-2xl p-4"
        style={{ boxShadow: SHADOW_SM, border: "0.5px solid rgba(0,85,255,0.10)" }}>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4" style={{ color: B1 }} strokeWidth={2.5} />
          <span className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: T1 }}>
            Side-by-Side Comparison
          </span>
        </div>
        <div className="space-y-3">
          {visibleRows.map(row => (
            <div key={row.key} className="rounded-xl p-3"
              style={{ background: "#F5F9FF", border: "0.5px solid rgba(0,85,255,0.08)" }}>
              <div className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: T3 }}>
                {row.label}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {row.cells.map(cell => (
                  <button key={cell.branchId} onClick={() => onBranchClick(cell.branchId)}
                    className="text-left px-2.5 py-2 rounded-lg transition-transform active:scale-[0.97]"
                    style={{
                      background: cell.isLeader
                        ? `linear-gradient(135deg, ${cell.branchColor}22 0%, ${cell.branchColor}33 100%)`
                        : "#FFFFFF",
                      border: cell.isLeader
                        ? `0.5px solid ${cell.branchColor}88`
                        : "0.5px solid rgba(148,163,184,0.18)",
                    }}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: cell.branchColor }} />
                      <span className="text-[10px] font-bold truncate" style={{ color: T2 }}>{cell.branchName}</span>
                      {cell.isLeader && <Crown className="w-3 h-3 shrink-0" style={{ color: GOLD }} />}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[15px] font-black"
                        style={{ color: valueColorForMetric(row.key, cell.value ?? 0, cell.value != null) }}>
                        {cell.display}
                      </span>
                      {cell.deltaVsLeader != null && cell.deltaVsLeader < 0 && (
                        <span className="text-[9px] font-bold" style={{ color: T4 }}>
                          {cell.deltaVsLeader}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Desktop: real table layout
  return (
    <div className="bg-white rounded-[1.5rem] p-6"
      style={{ boxShadow: SHADOW_SM, border: "0.5px solid rgba(0,85,255,0.10)" }}>
      <div className="flex items-center gap-2 mb-5">
        <BarChart3 className="w-4 h-4" style={{ color: B1 }} strokeWidth={2.5} />
        <span className="text-[12px] font-black uppercase tracking-[0.14em]" style={{ color: T1 }}>
          Side-by-Side Comparison
        </span>
        <span className="text-[11px] font-medium ml-auto" style={{ color: T4 }}>
          🏆 = metric leader · grey = no data
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th className="text-left text-[10px] font-black uppercase tracking-wider pb-3 pr-4"
                style={{ color: T4 }}>
                Metric
              </th>
              {branches.map(b => (
                <th key={b.id} className="text-left pb-3 px-3 cursor-pointer hover:bg-slate-50 rounded-md"
                  onClick={() => onBranchClick(b.id)}
                  style={{ minWidth: 140 }}>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-md shrink-0"
                      style={{ background: b.color, boxShadow: `0 2px 4px ${b.color}66` }} />
                    <span className="text-[12px] font-bold truncate" style={{ color: T1 }}>{b.name}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rIdx) => (
              <tr key={row.key} style={{ background: rIdx % 2 === 0 ? "#FAFCFF" : "transparent" }}>
                <td className="text-[12px] font-bold py-3 pr-4" style={{ color: T2 }}>
                  {row.label}
                </td>
                {row.cells.map(cell => {
                  const color = valueColorForMetric(row.key, cell.value ?? 0, cell.value != null);
                  return (
                    <td key={cell.branchId} className="py-3 px-3"
                      style={{
                        background: cell.isLeader ? `${cell.branchColor}11` : undefined,
                        borderLeft: cell.isLeader ? `2px solid ${cell.branchColor}` : "2px solid transparent",
                      }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[16px] font-black tabular-nums" style={{ color }}>
                          {cell.display}
                        </span>
                        {cell.isLeader && cell.value != null && (
                          <Crown className="w-3.5 h-3.5 shrink-0" style={{ color: GOLD }} />
                        )}
                        {cell.rank != null && cell.rank > 1 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={{ color: T4, background: "rgba(148,163,184,0.10)" }}>
                            #{cell.rank}
                          </span>
                        )}
                        {cell.deltaVsLeader != null && cell.deltaVsLeader < 0 && (
                          <span className="text-[10px] font-bold tabular-nums" style={{ color: RED }}>
                            {cell.deltaVsLeader}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Branch Card — strong visual identity per branch + rank chips ────────────
const BranchCardImpl: React.FC<{
  branch: BranchSummary;
  cellsByMetric: Map<ComparisonMetricKey, ComparisonCell>;
  isMobile: boolean;
  totalBranches: number;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ branch: b, cellsByMetric, isMobile, totalBranches, onClick, onEdit, onDelete }) => {
  const accent = b.color || "#3B82F6";
  // 3-mode discriminator: empty / awaiting / active
  const mode: "empty" | "awaiting" | "active" =
    b.studentCount === 0 ? "empty" :
    (b.ahi > 0 || b.feeCollection > 0 || b.passRate > 0 || b.attendance > 0) ? "active" : "awaiting";

  // STRONG accent gradient for active cards — 30% alpha at the corner reads
  // unmistakably as "this card is X colour" instead of the previous 12% tint
  // which made every branch card look like a white card with a hint of blue.
  const cardBg =
    mode === "active"
      ? `linear-gradient(135deg, #FFFFFF 0%, ${accent}0D 50%, ${accent}33 100%)`
      : `linear-gradient(135deg, #FCFDFE 0%, #F5F7FB 100%)`;
  const cardBorder =
    mode === "active"
      ? `0.5px solid ${accent}66`
      : `0.5px solid rgba(148,163,184,0.20)`;
  const accentShadow =
    mode === "active"
      ? `0 8px 24px ${accent}22, 0 2px 6px rgba(15,23,42,0.06)`
      : SHADOW_LG;

  // Status palette — driven off branch.status for active mode
  const statusPalette =
    mode !== "active"
      ? { bg: "rgba(148,163,184,0.14)", fg: "#64748B", label: mode === "empty" ? "EMPTY" : "AWAITING DATA" }
      : b.status === "Strong"
        ? { bg: "linear-gradient(135deg, #10B981 0%, #059669 100%)", fg: "#FFFFFF", label: "STRONG" }
        : b.status === "Good"
          ? { bg: "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)", fg: "#FFFFFF", label: "GOOD" }
          : { bg: "linear-gradient(135deg, #F43F5E 0%, #E11D48 100%)", fg: "#FFFFFF", label: "NEEDS FOCUS" };

  const cardMetrics: { key: ComparisonMetricKey; label: string; icon: any }[] = [
    { key: "ahi",           label: "AHI",        icon: Activity },
    { key: "passRate",      label: "Pass Rate",  icon: GraduationCap },
    { key: "feeCollection", label: "Fee Coll.",  icon: CircleDollarSign },
    { key: "attendance",    label: "Attendance", icon: CalendarCheck2 },
  ];

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      {...tilt3D}
      style={{
        background: cardBg,
        border: cardBorder,
        borderRadius: isMobile ? 18 : 22,
        padding: 0,                 // padding moved inside for top stripe
        boxShadow: accentShadow,
        position: "relative",
        overflow: "hidden",
        cursor: "pointer",
        minHeight: isMobile ? 250 : 290,
        ...tilt3DStyle,
      }}
      className="clickable-card group"
    >
      {/* TOP ACCENT STRIPE — 6px bold band of branch colour. The single
           strongest identity signal. Carries on hover-lift. */}
      <div style={{
        height: 6,
        background: mode === "active"
          ? `linear-gradient(90deg, ${accent} 0%, ${accent}AA 100%)`
          : "linear-gradient(90deg, #CBD5E1 0%, #E2E8F0 100%)",
      }} />

      <div style={{ padding: isMobile ? 18 : 22, position: "relative" }}>
        {/* Decorative faded icon — bottom-right */}
        <div style={{
          position: "absolute",
          bottom: isMobile ? 10 : 14,
          right: isMobile ? 12 : 18,
          color: accent,
          opacity: mode === "active" ? 0.10 : 0.06,
          pointerEvents: "none",
          lineHeight: 0,
        }}>
          <Building2 size={isMobile ? 56 : 76} strokeWidth={1.8}/>
        </div>

        {/* Edit / Delete — top-right, hover-revealed on desktop */}
        <div className={`absolute top-3 right-3 flex items-center gap-1 z-[3] transition-opacity duration-200 ${
          isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="w-7 h-7 rounded-lg bg-white/95 border border-slate-200 hover:bg-white hover:border-blue-300 flex items-center justify-center transition-all backdrop-blur-sm"
            title="Edit branch"
          >
            <Pencil className="w-3 h-3 text-slate-500" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="w-7 h-7 rounded-lg bg-white/95 border border-slate-200 hover:bg-rose-50 hover:border-rose-300 flex items-center justify-center transition-all backdrop-blur-sm"
            title="Delete branch"
          >
            <Trash2 className="w-3 h-3 text-slate-500" />
          </button>
        </div>

        {/* Header: solid icon badge + branch name + meta */}
        <div className="relative z-[2] flex items-start gap-3 mb-4 md:mb-5">
          <div style={{
            width: isMobile ? 42 : 46,
            height: isMobile ? 42 : 46,
            borderRadius: isMobile ? 12 : 13,
            background: accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 4px 14px ${accent}66, 0 0 0 2px #FFFFFF`,
            flexShrink: 0,
          }}>
            <Building2 size={isMobile ? 19 : 22} color="#FFFFFF" strokeWidth={2.5}/>
          </div>
          <div className="flex-1 min-w-0 pr-12">
            <h3 className="text-[15px] md:text-base font-bold text-[#0F172A] truncate"
              style={{ letterSpacing: "-0.2px" }}>
              {b.name}
            </h3>
            <p className="text-[10px] md:text-[11px] font-bold uppercase tracking-wider mt-1 truncate"
              style={{ color: "#64748B" }}>
              {b.studentCount.toLocaleString()} {b.studentCount === 1 ? "student" : "students"}
              {b.location && b.location !== "—" ? ` · ${b.location}` : ""}
              {b.teacherCount > 0 ? ` · ${b.teacherCount} teacher${b.teacherCount === 1 ? "" : "s"}` : ""}
            </p>
          </div>
        </div>

        {/* 2x2 metric grid — frosted white tiles WITH RANK CHIPS */}
        <div className="relative z-[2] grid grid-cols-2 gap-2 md:gap-2.5 mb-4">
          {cardMetrics.map(m => {
            const cell = cellsByMetric.get(m.key);
            const has = cell?.value != null;
            const Icon = m.icon;
            const valColor = valueColorForMetric(m.key, cell?.value ?? 0, has);
            return (
              <div key={m.label} className="rounded-xl p-2.5 md:p-3 relative"
                style={{
                  background: "rgba(255,255,255,0.85)",
                  border: cell?.isLeader
                    ? `0.5px solid ${accent}77`
                    : "0.5px solid rgba(255,255,255,0.6)",
                  backdropFilter: "blur(4px)",
                  boxShadow: cell?.isLeader ? `inset 0 0 0 1px ${accent}33` : "none",
                }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={11} color="#94A3B8" strokeWidth={2}/>
                  <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-wider flex-1 truncate">
                    {m.label}
                  </p>
                  {cell?.isLeader && has && (
                    <Crown size={11} style={{ color: GOLD }} strokeWidth={2.5} />
                  )}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <p className="text-[16px] md:text-[18px] font-black leading-tight"
                    style={{ color: valColor }}>
                    {cell?.display ?? "—"}
                  </p>
                  {has && cell && totalBranches > 1 && (
                    cell.isLeader ? (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
                        style={{ color: GOLD, background: `${GOLD}1F` }}>
                        #1
                      </span>
                    ) : cell.rank != null ? (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                        style={{ color: "#64748B", background: "rgba(148,163,184,0.14)" }}>
                        #{cell.rank}
                        {cell.deltaVsLeader != null && cell.deltaVsLeader < 0 ? ` · ${cell.deltaVsLeader}` : ""}
                      </span>
                    ) : null
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer: status pill + at-risk + failures, OR explicit empty hint */}
        <div className="relative z-[2] flex items-center justify-between gap-3 flex-wrap">
          {mode === "active" ? (
            <>
              <span style={{
                background: statusPalette.bg,
                color: statusPalette.fg,
                fontSize: 10,
                fontWeight: 800,
                padding: "5px 12px",
                borderRadius: 999,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                boxShadow: "0 2px 6px rgba(0,0,0,0.10)",
              }}>
                {statusPalette.label}
              </span>
              <div className="flex items-center gap-1.5">
                {b.activeAlerts > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-50 border border-rose-100 text-rose-500">
                    <AlertTriangle className="w-3 h-3 shrink-0"/>
                    {b.activeAlerts} at-risk
                  </span>
                )}
                {b.failedTestCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-50 border border-amber-100 text-amber-700">
                    {b.failedTestCount} fail{b.failedTestCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="text-[10px] md:text-[11px] font-semibold leading-snug"
              style={{ color: "#64748B" }}>
              {mode === "empty"
                ? "0 students enrolled — first enrollment will appear here"
                : "Awaiting performance data — appears once attendance/scores are recorded"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default function BranchesComparison() {
  const { id }     = useParams();
  const navigate   = useNavigate();
  const isMobile   = useIsMobile();
  const pageShellStyle = usePageShellStyle();
  const [listData,   setListData]   = useState<BranchComparisonData | null>(null);
  const [detailData, setDetailData] = useState<BranchDetailData | null>(null);
  const [loading,    setLoading]    = useState(true);

  // ── CRUD state ─────────────────────────────────────────────────────────
  const [addOpen,    setAddOpen]    = useState(false);
  const [editOpen,   setEditOpen]   = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [crudForm,   setCrudForm]   = useState<BranchForm>(EMPTY_FORM);
  const [crudDocId,  setCrudDocId]  = useState("");  // Firestore doc ID (not branchId)
  const [crudName,   setCrudName]   = useState("");   // for delete confirm
  const [crudSaving, setCrudSaving] = useState(false);
  /* Counts of teachers + unique students whose branchId points at the branch
     being deleted. Loaded async on openDelete and shown in the modal so the
     Owner sees concrete impact (not just a generic "may remain in system"). */
  const [orphanCounts, setOrphanCounts] = useState<OrphanCounts>({
    loading: false, teachers: 0, students: 0,
  });

  // ── Add branch ────────────────────────────────────────────────────────
  const handleAddBranch = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !crudForm.name.trim()) return;
    const trimmedName = crudForm.name.trim();
    /* Block duplicate branch names (case-insensitive). Two branches called
       "Banjarahills" make every cross-page join (Principal whitelist, teacher
       branchId fallback by name, student-branch resolver) ambiguous — Owner
       can't tell them apart on the dropdown either. Rejecting here is cheaper
       than untangling duplicates later. */
    const existing = (listData?.branches || []).find(b =>
      (b.name || "").toLowerCase().trim() === trimmedName.toLowerCase()
    );
    if (existing) {
      toast.error(`A branch named "${trimmedName}" already exists.`);
      return;
    }
    setCrudSaving(true);
    try {
      /* Store empty strings, NOT "—" / "N/A" sentinels. analyticsService
         already maps `|| "—"` and `|| "N/A"` on read for display, so writing
         empty here keeps the sentinel logic in ONE place. Bonus: a user who
         legitimately types "—" as a location no longer collides with our
         "this means empty" convention. */
      const docRef = await addDoc(collection(db, "schools", uid, "branches"), {
        name:        trimmedName,
        location:    crudForm.location.trim(),
        established: crudForm.established.trim(),
        color:       crudForm.color,
        createdAt:   serverTimestamp(),
      });
      // Set branchId = doc.id for easy resolution
      await updateDoc(docRef, { branchId: docRef.id });
      invalidateCache(`core:${uid}`);
      addAuditLog("branch_added", `Branch "${trimmedName}" added`, crudForm.location || undefined).catch(() => {});
      toast.success(`Branch "${trimmedName}" added!`);
      setAddOpen(false);
      setCrudForm(EMPTY_FORM);
    } catch (e) {
      console.error(e);
      toast.error("Failed to add branch.");
    } finally {
      setCrudSaving(false);
    }
  };

  // ── Edit branch ───────────────────────────────────────────────────────
  const handleEditBranch = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !crudDocId || !crudForm.name.trim()) return;
    const trimmedName = crudForm.name.trim();
    /* Same uniqueness rule as Add — but exclude the branch being edited so
       a no-op rename (or just changing color/location) doesn't trigger the
       check against itself. */
    const collision = (listData?.branches || []).find(b =>
      b.id !== crudDocId &&
      (b.name || "").toLowerCase().trim() === trimmedName.toLowerCase()
    );
    if (collision) {
      toast.error(`Another branch is already named "${trimmedName}".`);
      return;
    }
    setCrudSaving(true);
    try {
      await updateDoc(doc(db, "schools", uid, "branches", crudDocId), {
        name:        trimmedName,
        location:    crudForm.location.trim(),
        established: crudForm.established.trim(),
        color:       crudForm.color,
        updatedAt:   serverTimestamp(),
      });
      invalidateCache(`core:${uid}`);
      addAuditLog("branch_edited", `Branch "${trimmedName}" updated`).catch(() => {});
      toast.success(`Branch updated!`);
      setEditOpen(false);
    } catch (e) {
      console.error(e);
      toast.error("Failed to update branch.");
    } finally {
      setCrudSaving(false);
    }
  };

  // ── Delete branch ─────────────────────────────────────────────────────
  const handleDeleteBranch = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !crudDocId) return;
    setCrudSaving(true);
    try {
      await deleteDoc(doc(db, "schools", uid, "branches", crudDocId));
      invalidateCache(`core:${uid}`);
      addAuditLog("branch_deleted", `Branch "${crudName}" deleted`).catch(() => {});
      toast.success(`Branch "${crudName}" deleted.`);
      setDeleteOpen(false);
    } catch (e) {
      console.error(e);
      toast.error("Failed to delete branch.");
    } finally {
      setCrudSaving(false);
    }
  };

  // ── Open edit ─────────────────────────────────────────────────────────
  /* analyticsService normalises empty location/established to "—"/"N/A" for
     display. The form should open with a blank input when the branch has no
     value set, so we strip those exact display sentinels back to "". A user
     who typed literal "—" or "N/A" as their actual value will see it cleared
     on edit — acceptable trade-off because (a) we no longer write those
     sentinels (so this only affects branches created before this fix), and
     (b) those strings are visually identical to "no value" anyway. */
  const openEdit = (branch: any, docId: string) => {
    const rawLocation    = String(branch.location ?? "");
    const rawEstablished = String(branch.established ?? "");
    setCrudForm({
      name:        branch.name,
      location:    rawLocation === "—"   ? "" : rawLocation,
      established: rawEstablished === "N/A" ? "" : rawEstablished,
      color:       branch.color,
    });
    setCrudDocId(docId);
    setEditOpen(true);
  };

  const openDelete = async (docId: string, name: string) => {
    setCrudDocId(docId);
    setCrudName(name);
    /* Reset state and start counting in parallel — modal opens immediately
       with a "checking…" indicator while the count resolves. Branches with
       large rosters could take a moment, so blocking modal-open on the count
       would feel laggy. */
    setOrphanCounts({ loading: true, teachers: 0, students: 0 });
    setDeleteOpen(true);

    const uid = auth.currentUser?.uid;
    if (!uid) {
      setOrphanCounts({ loading: false, teachers: 0, students: 0 });
      return;
    }

    try {
      /* Match by canonical branchId — branch.docId === branchId since
         handleAddBranch sets it on creation (line 328). Stale name-only
         references are a separate hygiene concern; the canonical orphan set
         is what truly breaks on delete. Dedup students by studentId per the
         enrollment-row dedup memory rule. */
      const [tSnap, eSnap] = await Promise.all([
        getDocs(query(
          collection(db, "teachers"),
          where("schoolId", "==", uid),
          where("branchId", "==", docId),
        )),
        getDocs(query(
          collection(db, "enrollments"),
          where("schoolId", "==", uid),
          where("branchId", "==", docId),
        )),
      ]);
      const studentSet = new Set<string>();
      eSnap.docs.forEach(d => {
        const sid = (d.data() as any).studentId;
        if (sid) studentSet.add(sid);
      });
      setOrphanCounts({
        loading: false,
        teachers: tSnap.size,
        students: studentSet.size,
      });
    } catch (e) {
      console.error("[BranchesComparison] orphan count fetch failed:", e);
      setOrphanCounts({ loading: false, teachers: 0, students: 0 });
    }
  };

  useEffect(() => {
    setLoading(true);
    setListData(null);
    setDetailData(null);

    if (id) {
      const unsub = subscribeBranchDetail(
        id,
        d => { setDetailData(d); setLoading(false); },
        err => { console.error(err); toast.error("Failed to load branch details."); setLoading(false); }
      );
      return unsub;
    } else {
      const unsub = subscribeBranchesComparison(
        d => { setListData(d); setLoading(false); },
        err => { console.error(err); toast.error("Failed to load branches data."); setLoading(false); }
      );
      return unsub;
    }
  }, [id]);


  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14 }}>
        <Loader2 className="animate-spin" size={38} color={B1}/>
        <p style={{ fontSize:10, fontWeight:800, color:T4, letterSpacing:"0.14em", textTransform:"uppercase" }}>
          {id ? "Loading Branch Details..." : "Aggregating Branch Data..."}
        </p>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DETAIL VIEW  /branches/:id
  // ══════════════════════════════════════════════════════════════════════════
  if (id) {
    if (!detailData) {
      return (
        <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
          <p className="text-sm font-bold text-slate-400">Branch not found.</p>
          <Button variant="outline" onClick={() => navigate("/branches")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
        </div>
      );
    }

    const { summary, historicalTrend, benchmarkComparison, strengths, improvements, actionPlan, kpiNotes } = detailData;
    /* `score` can be null for empty months — only positive numbers count as
       "has data" so we don't render a chart of nulls or fake zeros. */
    const hasTrendData    = historicalTrend.some(t => typeof t.score === "number" && t.score > 0);
    /* Drop empty rows (no data) but ALWAYS keep Growth — `0` for Growth means
       "stable" (valid signal), not "no data". Other metrics treat 0 as "no data
       recorded yet" because they're percentages where 0% is rare-real and
       almost always means "untracked". Negative growth also legitimate, so
       use a metric-aware filter rather than a blanket `> 0`. */
    const benchmarkFiltered = benchmarkComparison.filter(row =>
      row.metric === "Growth" || row.branch > 0
    );

    // KPI cards matching screenshot: AHI, Fee Collection, Pass Rate, At-Risk Students
    // (renamed from "Active Alerts" — the underlying metric is specifically
    //  students with attendance below 80%, NOT all alert types in the system.
    //  See bug_pattern_misleading_label memory: surface what the metric
    //  actually measures so Owner doesn't conflate this with full risk count.)
    const kpiCards = [
      { label: "Academic Health Index", value: `${summary.ahi}%`,           note: kpiNotes.ahi,      borderColor: "border-amber-200",  bgColor: "bg-amber-50/50",  textColor: summary.ahi >= 85 ? "text-emerald-500" : summary.ahi >= 70 ? "text-amber-500" : "text-red-500" },
      { label: "Fee Collection",        value: summary.feeCollection > 0 ? `${summary.feeCollection}%` : "N/A", note: kpiNotes.fee, borderColor: "border-amber-200", bgColor: "bg-amber-50/50", textColor: summary.feeCollection >= 90 ? "text-emerald-500" : "text-amber-500" },
      { label: "Pass Rate",             value: summary.passRate > 0 ? `${summary.passRate}%` : "N/A", note: kpiNotes.passRate, borderColor: "border-amber-200", bgColor: "bg-amber-50/50", textColor: summary.passRate >= 85 ? "text-emerald-500" : "text-amber-500" },
      { label: "At-Risk Students",      value: summary.activeAlerts.toString(), note: kpiNotes.alerts, borderColor: "border-red-200",  bgColor: "bg-red-50/50",    textColor: summary.activeAlerts === 0 ? "text-emerald-500" : "text-red-500" },
    ];

    // Build bright KPI tiles with gradient
    const kpiTiles = [
      { label:"Academic Health", value:`${summary.ahi}%`, sub:kpiNotes.ahi, grad: summary.ahi >= 85 ? GRAD_GREEN : summary.ahi >= 70 ? GRAD_BLUE : GRAD_RED, icon:Activity },
      { label:"Fee Collection", value:summary.feeCollection > 0 ? `${summary.feeCollection}%` : "N/A", sub:kpiNotes.fee, grad: summary.feeCollection >= 90 ? GRAD_GREEN : summary.feeCollection > 0 ? GRAD_GOLD : GRAD_BLUE, icon:CircleDollarSign },
      { label:"Pass Rate", value:summary.passRate > 0 ? `${summary.passRate}%` : "N/A", sub:kpiNotes.passRate, grad: summary.passRate >= 85 ? GRAD_GREEN : summary.passRate > 0 ? GRAD_GOLD : GRAD_BLUE, icon:GraduationCap },
      { label:"At-Risk Students", value:summary.activeAlerts.toString(), sub:kpiNotes.alerts, grad: summary.activeAlerts === 0 ? GRAD_GREEN : GRAD_RED, icon:AlertTriangle },
    ];

    return (
      <>
        <DashGlobalStyles />
        <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 16 : 24 }}>

          <button
            onClick={() => navigate("/branches")}
            className="dash-btn"
            style={{
              display:"inline-flex", alignItems:"center", gap:7, alignSelf:"flex-start",
              padding: isMobile ? "7px 12px" : "8px 14px", borderRadius:12,
              background:"#fff", border:"0.5px solid rgba(0,85,255,.12)",
              fontSize: isMobile ? 10 : 11, fontWeight:700, color:T3,
              letterSpacing:"0.06em", textTransform:"uppercase",
              cursor:"pointer", boxShadow:SHADOW_SM, fontFamily:"inherit",
            }}
          >
            <ArrowLeft size={isMobile ? 12 : 14}/> {isMobile ? "Back" : "Back to Branches"}
          </button>

          {/* Dark Hero */}
          <div
            style={{
              background:"linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)",
              borderRadius: isMobile ? 18 : 24, padding: isMobile ? "18px 16px" : "24px 28px", color:"#fff",
              position:"relative", overflow:"hidden",
              boxShadow:"0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)",
            }}
          >
            <div style={{ position:"absolute", top:-60, right:-40, width:280, height:280, background:"radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 65%)", borderRadius:"50%", pointerEvents:"none" }}/>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 14 : 20, flexWrap:"wrap", position:"relative", zIndex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 12 : 16, minWidth:0, flex: isMobile ? "1 1 100%" : undefined }}>
                <div
                  style={{
                    width: isMobile ? 48 : 60, height: isMobile ? 48 : 60, borderRadius: isMobile ? 14 : 17,
                    background:summary.color || GRAD_PRIMARY,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    boxShadow:"0 10px 28px rgba(0,0,0,.26), 0 0 0 2px rgba(255,255,255,.2)",
                    flexShrink:0,
                  }}
                >
                  <Building2 size={isMobile ? 24 : 30} color="#fff" strokeWidth={2.2}/>
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"3px 10px", borderRadius:999, background:"rgba(255,255,255,.14)", border:"0.5px solid rgba(255,255,255,.22)", fontSize: isMobile ? 8 : 9, fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:8 }}>
                    <Sparkles size={10}/> Branch Profile
                  </div>
                  <h2 style={{ fontSize: isMobile ? 20 : 30, fontWeight:800, letterSpacing: isMobile ? "-0.4px" : "-0.8px", margin:0, color:"#fff", lineHeight:1.1, whiteSpace: isMobile ? "normal" : "nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{summary.name}</h2>
                  <p style={{ fontSize: isMobile ? 11 : 12, color:"rgba(255,255,255,.72)", fontWeight:500, margin: isMobile ? "6px 0 0 0" : "8px 0 0 0", letterSpacing:"0.04em" }}>
                    {summary.studentCount.toLocaleString()} students
                    {summary.teacherCount > 0 && ` · ${summary.teacherCount} teachers`}
                    {summary.established !== "N/A" && ` · Est. ${summary.established}`}
                    {summary.location !== "—" && ` · ${summary.location}`}
                  </p>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 8 : 10, flexWrap:"wrap", width: isMobile ? "100%" : "auto" }}>
                {/* Status pill — two bugs fixed together:
                    1) Status strings are "Strong" / "Good" / "Needs Focus"
                       (per branchesService.computeStatus). The earlier
                       checks for "High Risk" / "Low Risk" never matched,
                       so every pill fell through to GRAD_GOLD.
                    2) GRAD_GREEN / GRAD_GOLD / GRAD_RED are PASTEL card
                       backgrounds — white text on them is invisible (memory:
                       bug_pattern_pastel_grad_on_button). Use solid
                       gradients for active pills with white text. */}
                {(() => {
                  const SOLID_GREEN = "linear-gradient(135deg,#10B981 0%,#059669 100%)";
                  const SOLID_GOLD  = "linear-gradient(135deg,#F59E0B 0%,#D97706 100%)";
                  const SOLID_RED   = "linear-gradient(135deg,#FF3355 0%,#DC2626 100%)";
                  const SOLID_GREY  = "linear-gradient(135deg,#94A3B8 0%,#64748B 100%)";
                  // Default to neutral grey for unknown status — earlier the
                  // fall-through treated everything-not-Strong-or-Good as
                  // "Needs Focus" (red), so a future 4th status string would
                  // look like an alarm even if it isn't.
                  const pillBg =
                    summary.status === "Strong"      ? SOLID_GREEN :
                    summary.status === "Good"        ? SOLID_GOLD :
                    summary.status === "Needs Focus" ? SOLID_RED :
                                                       SOLID_GREY;
                  return (
                    <span style={{
                      fontSize: isMobile ? 9 : 10, fontWeight:800, padding: isMobile ? "6px 10px" : "8px 14px", borderRadius:10,
                      background: pillBg,
                      color:"#fff", letterSpacing:"0.12em", textTransform:"uppercase",
                      boxShadow:"0 4px 12px rgba(0,0,0,.24)",
                    }}>
                      {summary.status}
                    </span>
                  );
                })()}
                <button
                  // Branch-scoped: pass branchId via query param so the
                  // generic /reports page can pre-filter to this branch.
                  // Earlier this navigated to /reports plain — Owner clicked
                  // expecting the current branch's report and got a generic page.
                  onClick={() => navigate(`/reports?branchId=${encodeURIComponent(id || "")}`)}
                  className="dash-btn"
                  style={{
                    display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                    padding: isMobile ? "9px 14px" : "10px 18px", borderRadius:12,
                    background:"#fff", color:T1,
                    fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                    border:"none", cursor:"pointer", fontFamily:"inherit",
                    boxShadow:"0 4px 12px rgba(0,0,0,.18)",
                    flex: isMobile ? 1 : undefined,
                  }}
                >
                  <FileText size={13}/> {isMobile ? "Report" : "Generate Report"}
                </button>
              </div>
            </div>
          </div>

          {/* Bright KPI Grid */}
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16 }}>
            {kpiTiles.map(k => (
              <StatTile key={k.label} label={k.label} value={k.value} sub={k.sub} grad={k.grad} icon={k.icon} />
            ))}
          </div>

        {/* Wrapper for remaining legacy content */}
        <div className="dash3d bg-white rounded-2xl md:rounded-[2rem] border border-slate-100" style={{ boxShadow: SHADOW_SM }}>
          <div className="p-4 md:p-8 lg:p-12">

            {/* Charts — only render if at least one has data */}
            {(hasTrendData || benchmarkFiltered.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-10 mb-8 md:mb-12">

              {/* Historical Performance */}
              <div>
                <h3 className="text-sm md:text-base font-bold text-[#111827] mb-4 md:mb-8">Historical Performance</h3>
                {!hasTrendData ? (
                  <div className="h-[220px] md:h-[260px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
                    <p className="text-sm text-slate-400 font-semibold">No attendance data yet</p>
                    <p className="text-xs text-slate-300">Appears once daily attendance is recorded</p>
                  </div>
                ) : (
                  <div className="h-[240px] md:h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={historicalTrend} margin={{ left: isMobile ? -14 : -20, right: 10, top: 4, bottom: isMobile ? 28 : 4 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="period" axisLine={false} tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: isMobile ? 10 : 11, fontWeight: "bold" }} dy={10} />
                        <YAxis axisLine={false} tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: isMobile ? 9 : 11, fontWeight: "bold" }} domain={[0, 100]} width={isMobile ? 30 : 40} ticks={isMobile ? [0, 50, 100] : undefined}/>
                        <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                        <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: isMobile ? 10 : 11, fontWeight: 700, paddingTop: 4 }} iconType="circle"/>
                        <Line type="monotone" dataKey="schoolAvg" name="School Avg"
                          stroke="#22c55e" strokeWidth={isMobile ? 1.5 : 2} strokeDasharray="6 6" dot={false} />
                        <Line type="monotone" dataKey="score" name={summary.name}
                          stroke={summary.color} strokeWidth={isMobile ? 2.5 : 3}
                          dot={{ r: isMobile ? 3.5 : 5, fill: "#fff", strokeWidth: 2, stroke: summary.color }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Benchmark Comparison */}
              <div>
                <h3 className="text-sm md:text-base font-bold text-[#111827] mb-4 md:mb-8">Benchmark Comparison</h3>
                {benchmarkFiltered.length === 0 ? (
                  <div className="h-[220px] md:h-[260px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
                    <p className="text-sm text-slate-400 font-semibold">No benchmark data yet</p>
                    <p className="text-xs text-slate-300">Appears once results or attendance are recorded</p>
                  </div>
                ) : (
                  <div className="h-[240px] md:h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={benchmarkFiltered} barGap={6} margin={{ top: 4, right: isMobile ? 6 : 10, bottom: isMobile ? 28 : 20, left: isMobile ? -14 : 0 }}>
                        <XAxis dataKey="metric" axisLine={false} tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: isMobile ? 9 : 10, fontWeight: "bold" }} dy={10}
                          interval={0} angle={isMobile ? -12 : 0} textAnchor={isMobile ? "end" : "middle"} height={isMobile ? 40 : 28}/>
                        <YAxis axisLine={false} tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: isMobile ? 9 : 10, fontWeight: "bold" }}
                          domain={[0, 100]} ticks={isMobile ? [0, 50, 100] : [0, 20, 40, 60, 80, 100]} width={isMobile ? 30 : 40}/>
                        <Tooltip cursor={{ fill: "#f8fafc" }} contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                        <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: isMobile ? "4px" : "10px" }}
                          content={({ payload }) => (
                            <div className={`flex justify-center flex-wrap ${isMobile ? "gap-3 mt-2" : "gap-6 mt-4"}`}>
                              {payload?.map((e: any, i: number) => (
                                <div key={i} className="flex items-center gap-2">
                                  <div className="w-3 h-3 md:w-4 md:h-4 rounded-sm" style={{ backgroundColor: e.color }}></div>
                                  <span className="text-[10px] font-bold text-slate-500">{e.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        />
                        <Bar dataKey="branch" name={summary.name.split(" ")[0]} fill={summary.color}
                          radius={[3, 3, 0, 0]} barSize={isMobile ? 14 : 18} />
                        <Bar dataKey="avg" name="School Avg" fill="#d1d5db"
                          radius={[3, 3, 0, 0]} barSize={isMobile ? 14 : 18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Strengths & Improvements */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
              <div className="p-4 md:p-8 rounded-2xl md:rounded-[1.5rem] border border-emerald-100 bg-[#f0fdf4]/50">
                <h4 className="text-sm md:text-base font-bold text-[#22c55e] mb-4 md:mb-6 flex items-center gap-2.5">
                  <CheckCircle className="w-4 h-4 md:w-5 md:h-5" /> Strengths
                </h4>
                <ul className="space-y-2 md:space-y-3">
                  {strengths.map((s, i) => (
                    <li key={i} className="text-slate-700 font-medium text-[13px] md:text-sm leading-relaxed">• {s}</li>
                  ))}
                </ul>
              </div>
              <div className="p-4 md:p-8 rounded-2xl md:rounded-[1.5rem] border border-rose-100 bg-[#fef2f2]/50">
                <h4 className="text-sm md:text-base font-bold text-[#ef4444] mb-4 md:mb-6 flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 md:w-5 md:h-5" /> Areas for Improvement
                </h4>
                <ul className="space-y-2 md:space-y-3">
                  {improvements.map((s, i) => (
                    <li key={i} className="text-slate-700 font-medium text-[13px] md:text-sm leading-relaxed">• {s}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* ── Recommended Action Plan ──────────────────────────────────────── */}
        <div className="dash3d bg-white rounded-2xl md:rounded-[2rem] border border-slate-100 p-4 md:p-10" style={{ boxShadow: SHADOW_SM }}>
          <h3 className="text-base md:text-xl font-bold text-[#111827] mb-5 md:mb-10">Recommended Action Plan</h3>
          <div className="space-y-0 divide-y divide-slate-50">
            {actionPlan.map((plan, idx) => (
              <div key={idx} className="flex items-start md:items-center justify-between py-4 md:py-7 gap-3 md:gap-8 group">
                <div className="flex items-start md:items-center gap-3 md:gap-6 flex-1 min-w-0">
                  <div
                    className="w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-white font-black text-xs md:text-sm shrink-0"
                    style={{ backgroundColor: summary.color }}
                  >
                    {idx + 1}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-[13px] md:text-[15px] font-bold text-[#111827] mb-0.5 md:mb-1 group-hover:text-blue-600 transition-colors">
                      {plan.task}
                    </h4>
                    <p className="text-slate-400 text-[11px] md:text-xs font-medium leading-snug">{plan.sub}</p>
                  </div>
                </div>
                <span className={`px-3 md:px-4 py-1 md:py-1.5 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-widest text-white whitespace-nowrap shrink-0 ${plan.prColor}`}>
                  {plan.priority}
                </span>
              </div>
            ))}
          </div>
        </div>

          <AIInsightCard
            title={`${summary.name} — Branch Intelligence`}
            items={[
              { label:"Health Pulse", value: `AHI ${summary.ahi}%`, sub: summary.ahi >= 85 ? "Excellent" : summary.ahi >= 70 ? "Healthy" : "Needs Focus" },
              { label:"Alert Queue", value: summary.activeAlerts > 0 ? `${summary.activeAlerts} active` : "All clear", sub: summary.activeAlerts > 0 ? "Review action plan" : "No intervention needed" },
              { label:"Enrollment Reach", value: `${summary.studentCount.toLocaleString()} students`, sub: summary.teacherCount > 0 ? `${summary.teacherCount} teachers` : "Staff pending" },
            ]}
          />
        </div>
      </>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LIST VIEW  /branches
  // ══════════════════════════════════════════════════════════════════════════
  if (!listData) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <p className="text-sm font-bold text-slate-400">No branch data available.</p>
      </div>
    );
  }

  const {
    branches, performanceRanking, comparativeTrends, efficiencyMetrics, mappingIssue,
    comparisonMatrix, winners, headlineLeader, headlineLaggard,
  } = listData;

  // Show all ranking rows always (0 will render as short bar)
  const rankingWithData = performanceRanking;
  // Only show trends chart if any month has real attendance data. Note: row
  // values are now `number | null | string` — `null` means "no data this month"
  // (don't plot the point), so we explicitly check for finite numbers > 0.
  const hasTrendsData = comparativeTrends.some(row =>
    branches.some((_, i) => {
      const v = row[`b${i}`];
      return typeof v === "number" && v > 0;
    })
  );

  // Compute list-view AHI avg for hero
  const listAhiAvg = branches.length > 0
    ? Math.round(branches.reduce((a, b) => a + (b.ahi || 0), 0) / branches.length)
    : 0;
  const totalAlertsList = branches.reduce((a, b) => a + (b.activeAlerts || 0), 0);
  const totalStudentsList = branches.reduce((a, b) => a + (b.studentCount || 0), 0);

  // Actionable hero subtitle: surface leader + laggard (if more than one branch
  // with data). Falls back to descriptive text when only 1 branch / no data.
  const heroSubtitle = headlineLeader && headlineLaggard
    ? `${headlineLeader.name.split(" ")[0]} leading at ${headlineLeader.ahi}% · ${headlineLaggard.name.split(" ")[0]} needs focus at ${headlineLaggard.ahi}%`
    : headlineLeader
      ? `${headlineLeader.name.split(" ")[0]} leading at ${headlineLeader.ahi}% AHI · ${branches.length} branch${branches.length !== 1 ? "es" : ""} · ${totalStudentsList.toLocaleString()} students`
      : `${branches.length} branch${branches.length !== 1 ? "es" : ""} · ${totalStudentsList.toLocaleString()} students · awaiting performance data`;

  // Build a per-branch lookup of all comparison cells, indexed by metric key.
  // Cards consume this so they can show rank/leader/delta per metric without
  // recomputing the comparison logic per render.
  const cellsByBranchByMetric = new Map<string, Map<ComparisonMetricKey, ComparisonCell>>();
  comparisonMatrix.forEach(row => {
    row.cells.forEach(cell => {
      let m = cellsByBranchByMetric.get(cell.branchId);
      if (!m) { m = new Map(); cellsByBranchByMetric.set(cell.branchId, m); }
      m.set(row.key, cell);
    });
  });

  // Export Comparison PDF — uses reportTemplate.buildReport (same infra the
  // teacher Pre-Result Predictor uses). Opens in new blob: window with print
  // button. Replaces the previous "no export" gap.
  const handleExportComparison = () => {
    if (branches.length === 0) {
      toast.info("Add at least one branch before exporting.");
      return;
    }
    try {
      const sections: ReportSection[] = [];

      // 1. Headline (text)
      sections.push({
        title: "Network Headline",
        type: "text",
        text: heroSubtitle,
      });

      // 2. Winners (list) — one bullet per metric leader
      if (winners.length > 0) {
        sections.push({
          title: "Metric Leaders",
          type: "list",
          items: winners.map(w => `${w.metricLabel}: ${w.branchName} — ${w.display}`),
        });
      }

      // 3. Side-by-side comparison table
      const visibleRows = comparisonMatrix.filter(r => r.hasAnyData);
      if (visibleRows.length > 0) {
        sections.push({
          title: "Side-by-Side Comparison",
          type: "table",
          headers: ["Metric", ...branches.map(b => b.name)],
          rows: visibleRows.map(row => ({
            cells: [
              row.label,
              ...row.cells.map(c =>
                c.value == null ? "—" :
                c.isLeader ? `${c.display} 🏆` :
                c.deltaVsLeader != null && c.deltaVsLeader < 0 ? `${c.display} (${c.deltaVsLeader})` :
                c.display
              ),
            ],
          })),
        });
      }

      // 4. Efficiency metrics
      sections.push({
        title: "Efficiency Metrics",
        type: "stats",
        stats: efficiencyMetrics.map(m => ({ label: m.label, value: `${m.value} — ${m.note}` })),
      });

      // 5. Per-branch summary
      sections.push({
        title: "Per-Branch Summary",
        type: "table",
        headers: ["Branch", "Students", "Teachers", "Status", "Location"],
        rows: branches.map(b => ({
          cells: [
            b.name,
            b.studentCount,
            b.teacherCount || 0,
            b.status,
            b.location && b.location !== "—" ? b.location : "—",
          ],
        })),
      });

      const html = buildReport({
        title: "Branch Network Comparison",
        subtitle: heroSubtitle,
        badge: `${branches.length} BRANCHES`,
        heroStats: [
          { label: "Avg AHI", value: `${listAhiAvg}%` },
          { label: "Total Students", value: totalStudentsList.toLocaleString() },
          { label: "Total At-Risk", value: totalAlertsList.toString() },
          { label: "Branches", value: branches.length.toString() },
        ],
        sections,
        schoolName: "Branch Network",
        generatedBy: "Owner Dashboard",
      });
      openReportWindow(html);
    } catch (err) {
      console.error("[BranchesComparison] export failed", err);
      toast.error("Could not open report. Please try again.");
    }
  };

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 16 : 24 }}>

      {/* CRUD Modals */}
      <BranchModal
        open={addOpen} mode="add" form={crudForm} docId=""
        onClose={() => { setAddOpen(false); setCrudForm(EMPTY_FORM); }}
        onChange={setCrudForm} onSave={handleAddBranch} saving={crudSaving}
      />
      <BranchModal
        open={editOpen} mode="edit" form={crudForm} docId={crudDocId}
        onClose={() => setEditOpen(false)}
        onChange={setCrudForm} onSave={handleEditBranch} saving={crudSaving}
      />
      <DeleteModal
        open={deleteOpen} branchName={crudName}
        orphans={orphanCounts}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteBranch} deleting={crudSaving}
      />

      <PageHead
        icon={Building2}
        title="Branches Comparison"
        subtitle="Side-by-side performance analysis"
        right={
          <div style={{ display: "flex", gap: 8, width: isMobile ? "100%" : "auto" }}>
            {branches.length > 0 && (
              <button
                onClick={handleExportComparison}
                className="dash-btn"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: isMobile ? "10px 14px" : "11px 16px", borderRadius: isMobile ? 12 : 14,
                  background: "#fff", color: T2,
                  fontSize: isMobile ? 11 : 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
                  border: "0.5px solid rgba(0,85,255,0.18)", cursor: "pointer", boxShadow: SHADOW_SM, fontFamily: "inherit",
                  flex: isMobile ? 1 : undefined,
                }}
              >
                <FileText size={isMobile ? 13 : 14} strokeWidth={2.3}/> Export PDF
              </button>
            )}
            <button
              onClick={() => { setCrudForm(EMPTY_FORM); setAddOpen(true); }}
              className="dash-btn"
              style={{
                display:"inline-flex", alignItems:"center", justifyContent:"center", gap:7,
                padding: isMobile ? "10px 16px" : "11px 18px", borderRadius: isMobile ? 12 : 14,
                background:GRAD_PRIMARY, color:"#fff",
                fontSize: isMobile ? 11 : 12, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                border:"none", cursor:"pointer", boxShadow:SHADOW_BTN, fontFamily:"inherit",
                flex: isMobile ? 1 : undefined,
              }}
            >
              <Plus size={isMobile ? 14 : 15} strokeWidth={2.4}/> Add Branch
            </button>
          </div>
        }
      />

      {branches.length > 0 && (
        <DarkHero
          icon={BarChart3}
          eyebrow="Branch Intelligence"
          title={`${listAhiAvg}%`}
          subtitle={heroSubtitle}
          stats={[
            { label:"Branches", value: branches.length.toString() },
            { label:"Students", value: totalStudentsList.toLocaleString() },
            /* "At-Risk" is more accurate than "Alerts" — the count is
               attendance-based at-risk students, not all alert types. */
            { label:"At-Risk",  value: totalAlertsList.toString() },
          ]}
        />
      )}

      {/* WINNERS STRIP — page-top "who leads what" at-a-glance ─────────── */}
      {branches.length > 0 && winners.length > 0 && (
        <WinnersStripImpl winners={winners} isMobile={isMobile} />
      )}

      {/* SIDE-BY-SIDE COMPARISON MATRIX — the headline view that delivers
          on the page subtitle. Branches × metrics, leader marked with crown,
          rank chips on every other cell. The promise the page actually keeps. */}
      {branches.length > 1 && (
        <ComparisonMatrixImpl
          rows={comparisonMatrix}
          branches={branches}
          isMobile={isMobile}
          onBranchClick={(bid) => navigate(`/branches/${bid}`)}
        />
      )}

      {/* ── Mapping issue banner ────────────────────────────────────────────
          Surfaced from analyticsService when student-branch attribution is
          partial or fully broken. We render it loudly here because every
          downstream metric (AHI, fees, attendance) is computed off that
          attribution — Owner needs to know the dashboard might be wrong
          before making decisions. */}
      {mappingIssue && (
        <div
          className={`rounded-2xl md:rounded-[1.5rem] border p-4 md:p-5 flex items-start gap-3 md:gap-4 ${
            mappingIssue.fallbackTriggered
              ? "bg-rose-50 border-rose-200"
              : "bg-amber-50 border-amber-200"
          }`}
        >
          <AlertTriangle
            className={`w-5 h-5 md:w-6 md:h-6 shrink-0 mt-0.5 ${
              mappingIssue.fallbackTriggered ? "text-rose-600" : "text-amber-600"
            }`}
          />
          <div className="min-w-0 flex-1">
            <p className={`text-[12px] md:text-[13px] font-black uppercase tracking-widest mb-1 ${
              mappingIssue.fallbackTriggered ? "text-rose-700" : "text-amber-700"
            }`}>
              {mappingIssue.fallbackTriggered
                ? "Branch attribution may be incorrect"
                : `${mappingIssue.unmapped} of ${mappingIssue.total} students unmapped`}
            </p>
            <p className={`text-[11px] md:text-[12px] font-medium leading-snug ${
              mappingIssue.fallbackTriggered ? "text-rose-600/90" : "text-amber-700/90"
            }`}>
              {mappingIssue.fallbackTriggered
                ? `No students could be matched to any branch via branchId/schoolId, so all ${mappingIssue.total.toLocaleString()} are temporarily attributed to the first branch. Update student records with valid branchId values matching this school's branches to fix.`
                : `These students have no branchId/schoolId field that matches a known branch — they are excluded from per-branch metrics. Update their records to restore accurate attribution.`}
            </p>
          </div>
        </div>
      )}

      {/* Branch Cards */}
      {branches.length === 0 ? (
        <div className="dash3d py-12 md:py-20 px-4 flex flex-col items-center justify-center bg-white rounded-2xl md:rounded-[2rem] border border-slate-100" style={{ boxShadow: SHADOW_SM }}>
          <Building2 className="w-12 h-12 md:w-16 md:h-16 text-slate-200 mb-3 md:mb-4" />
          <p className="text-sm font-bold text-slate-400">No branches yet</p>
          <p className="text-xs text-slate-300 mt-1 mb-5 md:mb-6 text-center">Create your first branch to start comparing performance</p>
          <button
            onClick={() => { setCrudForm(EMPTY_FORM); setAddOpen(true); }}
            className="flex items-center gap-2 px-5 md:px-6 py-3 rounded-2xl bg-[#1e294b] text-white text-[13px] md:text-sm font-black hover:bg-[#1e3a8a] transition-all shadow-lg"
          >
            <Plus className="w-4 h-4" /> Add First Branch
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {branches.map(b => {
            const cellsByMetric = cellsByBranchByMetric.get(b.id) || new Map();
            return (
              <BranchCardImpl
                key={b.id}
                branch={b}
                cellsByMetric={cellsByMetric}
                isMobile={isMobile}
                totalBranches={branches.length}
                onClick={() => navigate(`/branches/${b.id}`)}
                onEdit={() => openEdit(b, b.id)}
                onDelete={() => openDelete(b.id, b.name)}
              />
            );
          })}
        </div>
      )}

      {/* Charts — only render if at least one has data */}
      {branches.length > 0 && (rankingWithData.length > 0 || hasTrendsData) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">

          {/* Performance Ranking */}
          <div className="dash3d bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 p-4 md:p-8" style={{ boxShadow: SHADOW_SM }}>
            <h3 className="text-base md:text-lg font-bold text-[#111827] mb-6 md:mb-12">Performance Ranking</h3>
            {rankingWithData.length === 0 ? (
              <div className="h-[260px] md:h-[300px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
                <p className="text-sm text-slate-400 font-semibold">No performance data yet</p>
                <p className="text-xs text-slate-300">Appears once attendance or results are recorded</p>
              </div>
            ) : (
              <div className="h-[280px] md:h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rankingWithData} layout="vertical" barGap={4} margin={{ left: isMobile ? -8 : 0, right: isMobile ? 8 : 20 }}>
                    <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: isMobile ? 9 : 10, fontWeight: "bold" }} ticks={isMobile ? [0, 50, 100] : [0, 20, 40, 60, 80, 100]} />
                    <YAxis dataKey="metric" type="category" axisLine={false} tickLine={false}
                      tick={{ fill: "#64748b", fontSize: isMobile ? 9 : 11, fontWeight: "bold" }} width={isMobile ? 68 : 80} />
                    <Tooltip cursor={{ fill: "#f8fafc" }} contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: isMobile ? "10px" : "20px" }}
                      content={({ payload }) => (
                        <div className={`flex flex-wrap justify-center ${isMobile ? "gap-3 mt-2" : "gap-6 mt-6"}`}>
                          {payload?.map((e: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="w-3 h-3 md:w-4 md:h-4 rounded-sm" style={{ backgroundColor: e.color }}></div>
                              <span className="text-[10px] md:text-[11px] font-bold text-slate-500">{e.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    />
                    {branches.map((b, i) => (
                      <Bar key={b.id} dataKey={`b${i}`} name={b.name}
                        fill={b.color} radius={[0, 2, 2, 0]} barSize={isMobile ? 8 : 10} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Comparative Trends */}
          <div className="dash3d bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 p-4 md:p-8" style={{ boxShadow: SHADOW_SM }}>
            <h3 className="text-base md:text-lg font-bold text-[#111827] mb-6 md:mb-12">Comparative Trends <span className="text-slate-400 font-medium text-xs md:text-sm">(Attendance %)</span></h3>
            {!hasTrendsData ? (
              <div className="h-[260px] md:h-[300px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
                <p className="text-sm text-slate-400 font-semibold">No attendance trend data yet</p>
                <p className="text-xs text-slate-300">Appears once daily attendance is recorded</p>
              </div>
            ) : (
              <div className="h-[280px] md:h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={comparativeTrends} margin={{ left: isMobile ? -14 : -10, right: 10, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: isMobile ? 10 : 11, fontWeight: "bold" }} dy={10} />
                    <YAxis axisLine={false} tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: isMobile ? 9 : 11, fontWeight: "bold" }}
                      domain={[0, 100]} ticks={isMobile ? [0, 50, 100] : [0, 20, 40, 60, 80, 100]} width={isMobile ? 30 : 40} />
                    <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: isMobile ? "8px" : "20px" }}
                      content={({ payload }) => (
                        <div className={`flex flex-wrap justify-center ${isMobile ? "gap-3 mt-2" : "gap-6 mt-6"}`}>
                          {payload?.map((e: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="w-3 h-3 md:w-4 md:h-4 rounded-full border-[2.5px] bg-white" style={{ borderColor: e.color }}></div>
                              <span className="text-[10px] md:text-[11px] font-bold text-slate-500">{e.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    />
                    {branches.map((b, i) => (
                      <Line key={b.id} type="monotone" dataKey={`b${i}`} name={b.name}
                        stroke={b.color} strokeWidth={isMobile ? 2.5 : 3}
                        dot={{ r: isMobile ? 3.5 : 5, fill: "#fff", strokeWidth: 2, stroke: b.color }}
                        activeDot={{ r: 7 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Efficiency Metrics */}
      {branches.length > 0 && (
        <div className="dash3d bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 p-4 md:p-10" style={{ boxShadow: SHADOW_SM }}>
          <h3 className="text-base md:text-xl font-bold text-[#111827] mb-5 md:mb-10">Efficiency Metrics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
            {efficiencyMetrics.map((m, i) => (
              <div key={i} className="dash-tile bg-[#f8fafc]/50 border border-slate-100 p-4 md:p-8 rounded-xl md:rounded-[1.5rem] text-center" style={{ boxShadow: SHADOW_SM }}>
                <p className="text-slate-400 text-[10px] md:text-[11px] font-bold uppercase tracking-tight mb-2 md:mb-4">{m.label}</p>
                <h3 className={`text-xl md:text-3xl font-black tracking-tighter mb-1 md:mb-2 ${m.col}`}>{m.value}</h3>
                <p className={`text-[10px] md:text-[11px] font-bold ${m.col}`}>{m.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {branches.length > 0 && (
        <AIInsightCard
          title="Network Intelligence Summary"
          items={[
            { label:"Portfolio Health", value: `AHI ${listAhiAvg}%`, sub: listAhiAvg >= 80 ? "Strong network" : listAhiAvg >= 60 ? "Stable" : "Needs focus" },
            { label:"Risk Watch",       value: totalAlertsList > 0 ? `${totalAlertsList} alert${totalAlertsList!==1?"s":""}` : "All clear", sub: totalAlertsList > 0 ? "Investigate per branch" : "No immediate action" },
            { label:"Scale",            value: `${branches.length} branch${branches.length!==1?"es":""}`, sub: `${totalStudentsList.toLocaleString()} scholars total` },
          ]}
        />
      )}
      </div>
    </>
  );
}
