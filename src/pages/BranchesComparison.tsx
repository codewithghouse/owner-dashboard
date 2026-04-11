import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, BarChart, Bar,
} from "recharts";
import {
  ArrowLeft, CheckCircle, AlertTriangle, Building2, Loader2,
  Plus, Pencil, Trash2, X, Save
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  subscribeBranchesComparison, subscribeBranchDetail,
  BranchComparisonData, BranchDetailData,
} from "@/lib/branchesService";
import { auth, db } from "@/lib/firebase";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp
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
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md p-8 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-[#1e3a8a]" />
            </div>
            <h2 className="text-lg font-black text-[#1e293b]">
              {mode === "add" ? "Add New Branch" : "Edit Branch"}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-50 transition-colors">
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
            <input
              type="text"
              value={form.established}
              onChange={e => onChange({ ...form, established: e.target.value })}
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

        <div className="flex gap-3 mt-8">
          <button
            onClick={onClose}
            className="flex-1 h-12 rounded-2xl border border-slate-100 text-sm font-black text-slate-500 hover:bg-slate-50 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.name.trim()}
            className="flex-1 h-12 rounded-2xl bg-[#1e294b] text-white text-sm font-black hover:bg-[#1e3a8a] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {mode === "add" ? "Add Branch" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirm Modal ──────────────────────────────────────────────────────
function DeleteModal({
  open, branchName, onClose, onConfirm, deleting
}: {
  open: boolean; branchName: string;
  onClose: () => void; onConfirm: () => void; deleting: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm p-8 animate-in zoom-in-95 duration-200">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center">
            <Trash2 className="w-8 h-8 text-rose-500" />
          </div>
          <div>
            <h2 className="text-lg font-black text-[#1e293b]">Delete Branch?</h2>
            <p className="text-sm text-slate-400 font-medium mt-2">
              You're about to delete <strong className="text-[#1e293b]">{branchName}</strong>.
              This removes the branch record. Existing students and teachers linked to this branch remain in the system.
            </p>
          </div>
          <div className="flex gap-3 w-full">
            <button
              onClick={onClose}
              className="flex-1 h-12 rounded-2xl border border-slate-100 text-sm font-black text-slate-500 hover:bg-slate-50 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={deleting}
              className="flex-1 h-12 rounded-2xl bg-rose-500 text-white text-sm font-black hover:bg-rose-600 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
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

export default function BranchesComparison() {
  const { id }     = useParams();
  const navigate   = useNavigate();
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

  // ── Add branch ────────────────────────────────────────────────────────
  const handleAddBranch = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !crudForm.name.trim()) return;
    setCrudSaving(true);
    try {
      const docRef = await addDoc(collection(db, "schools", uid, "branches"), {
        name:        crudForm.name.trim(),
        location:    crudForm.location.trim() || "—",
        established: crudForm.established.trim() || "N/A",
        color:       crudForm.color,
        createdAt:   serverTimestamp(),
      });
      // Set branchId = doc.id for easy resolution
      await updateDoc(docRef, { branchId: docRef.id });
      invalidateCache(`core:${uid}`);
      addAuditLog("branch_added", `Branch "${crudForm.name}" added`, crudForm.location || undefined);
      toast.success(`Branch "${crudForm.name}" added!`);
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
    setCrudSaving(true);
    try {
      await updateDoc(doc(db, "schools", uid, "branches", crudDocId), {
        name:        crudForm.name.trim(),
        location:    crudForm.location.trim() || "—",
        established: crudForm.established.trim() || "N/A",
        color:       crudForm.color,
        updatedAt:   serverTimestamp(),
      });
      invalidateCache(`core:${uid}`);
      addAuditLog("branch_edited", `Branch "${crudForm.name}" updated`);
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
      addAuditLog("branch_deleted", `Branch "${crudName}" deleted`);
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
  const openEdit = (branch: any, docId: string) => {
    setCrudForm({
      name:        branch.name,
      location:    branch.location !== "—" ? branch.location : "",
      established: branch.established !== "N/A" ? branch.established : "",
      color:       branch.color,
    });
    setCrudDocId(docId);
    setEditOpen(true);
  };

  const openDelete = (docId: string, name: string) => {
    setCrudDocId(docId);
    setCrudName(name);
    setDeleteOpen(true);
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

  // ── Metric color helper ───────────────────────────────────────────────────
  const metricColor = (v: number) =>
    v >= 85 ? "text-[#22c55e]" : v >= 70 ? "text-[#f59e0b]" : "text-[#ef4444]";

  const statusConfig = (status: string) => {
    if (status === "Strong")      return "bg-emerald-500";
    if (status === "Good")        return "bg-blue-500";
    return "bg-[#ef4444]";
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#1e3a8a]" />
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
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
    const hasTrendData    = historicalTrend.some(t => t.score > 0);
    const benchmarkFiltered = benchmarkComparison.filter(row => row.branch > 0);

    // KPI cards matching screenshot: AHI, Fee Collection, Pass Rate, Active Alerts
    const kpiCards = [
      { label: "Academic Health Index", value: `${summary.ahi}%`,           note: kpiNotes.ahi,      borderColor: "border-amber-200",  bgColor: "bg-amber-50/50",  textColor: summary.ahi >= 85 ? "text-emerald-500" : summary.ahi >= 70 ? "text-amber-500" : "text-red-500" },
      { label: "Fee Collection",        value: summary.feeCollection > 0 ? `${summary.feeCollection}%` : "N/A", note: kpiNotes.fee, borderColor: "border-amber-200", bgColor: "bg-amber-50/50", textColor: summary.feeCollection >= 90 ? "text-emerald-500" : "text-amber-500" },
      { label: "Pass Rate",             value: summary.passRate > 0 ? `${summary.passRate}%` : "N/A", note: kpiNotes.passRate, borderColor: "border-amber-200", bgColor: "bg-amber-50/50", textColor: summary.passRate >= 85 ? "text-emerald-500" : "text-amber-500" },
      { label: "Active Alerts",         value: summary.activeAlerts.toString(), note: kpiNotes.alerts, borderColor: "border-red-200",  bgColor: "bg-red-50/50",    textColor: summary.activeAlerts === 0 ? "text-emerald-500" : "text-red-500" },
    ];

    return (
      <div className="space-y-8 max-w-[1400px] mx-auto animate-in fade-in duration-500 pb-16">

        {/* ── Profile Card ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm">
          <div className="p-8 lg:p-12">

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-10">
              <div className="flex items-center gap-6">
                <button
                  onClick={() => navigate("/branches")}
                  className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors shrink-0"
                >
                  <ArrowLeft className="w-5 h-5 text-slate-500" />
                </button>
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0"
                  style={{ backgroundColor: summary.color }}
                >
                  <Building2 className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="text-2xl lg:text-3xl font-bold text-[#111827] tracking-tight">{summary.name}</h2>
                  <p className="text-slate-400 font-medium text-sm mt-1">
                    {summary.studentCount.toLocaleString()} students
                    {summary.teacherCount > 0 && ` • ${summary.teacherCount} teachers`}
                    {summary.established !== "N/A" && ` • Established ${summary.established}`}
                    {summary.location !== "—" && ` • ${summary.location}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`px-5 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest text-white ${statusConfig(summary.status)}`}>
                  {summary.status}
                </span>
                <Button className="h-10 px-5 rounded-lg bg-[#1e294b] text-white text-[11px] font-bold hover:bg-[#1e3a8a] shadow-lg">
                  Generate Report
                </Button>
              </div>
            </div>

            {/* KPI Cards — matching screenshot: AHI, Fee Collection, Pass Rate, Active Alerts */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-12">
              {kpiCards.map((kpi, i) => (
                <div key={i} className={`p-6 rounded-[1.2rem] border ${kpi.borderColor} ${kpi.bgColor} transition-all hover:bg-white hover:shadow-lg`}>
                  <p className="text-slate-400 text-[11px] font-bold uppercase tracking-tight mb-3">{kpi.label}</p>
                  <h3 className={`text-3xl font-black tracking-tighter mb-1.5 ${kpi.textColor}`}>
                    {kpi.value}
                  </h3>
                  <p className={`text-[11px] font-bold ${kpi.textColor}`}>{kpi.note}</p>
                </div>
              ))}
            </div>

            {/* Charts — only render if at least one has data */}
            {(hasTrendData || benchmarkFiltered.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-12">

              {/* Historical Performance */}
              <div>
                <h3 className="text-base font-bold text-[#111827] mb-8">Historical Performance</h3>
                {!hasTrendData ? (
                  <div className="h-[260px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
                    <p className="text-sm text-slate-400 font-semibold">No attendance data yet</p>
                    <p className="text-xs text-slate-300">Appears once daily attendance is recorded</p>
                  </div>
                ) : (
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={historicalTrend} margin={{ left: -20, right: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="period" axisLine={false} tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} dy={10} />
                        <YAxis axisLine={false} tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} domain={[0, 100]} />
                        <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                        <Line type="monotone" dataKey="schoolAvg" name="School Avg"
                          stroke="#22c55e" strokeWidth={2} strokeDasharray="6 6" dot={false} />
                        <Line type="monotone" dataKey="score" name={summary.name}
                          stroke={summary.color} strokeWidth={3}
                          dot={{ r: 5, fill: "#fff", strokeWidth: 2.5, stroke: summary.color }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Benchmark Comparison */}
              <div>
                <h3 className="text-base font-bold text-[#111827] mb-8">Benchmark Comparison</h3>
                {benchmarkFiltered.length === 0 ? (
                  <div className="h-[260px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
                    <p className="text-sm text-slate-400 font-semibold">No benchmark data yet</p>
                    <p className="text-xs text-slate-300">Appears once results or attendance are recorded</p>
                  </div>
                ) : (
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={benchmarkFiltered} barGap={6} margin={{ bottom: 20 }}>
                        <XAxis dataKey="metric" axisLine={false} tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                        <YAxis axisLine={false} tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }}
                          domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} />
                        <Tooltip cursor={{ fill: "#f8fafc" }} contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                        <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: "10px" }}
                          content={({ payload }) => (
                            <div className="flex justify-center gap-6 mt-4">
                              {payload?.map((e: any, i: number) => (
                                <div key={i} className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: e.color }}></div>
                                  <span className="text-[10px] font-bold text-slate-500">{e.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        />
                        <Bar dataKey="branch" name={summary.name.split(" ")[0]} fill={summary.color}
                          radius={[3, 3, 0, 0]} barSize={18} />
                        <Bar dataKey="avg" name="School Avg" fill="#d1d5db"
                          radius={[3, 3, 0, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Strengths & Improvements */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-8 rounded-[1.5rem] border border-emerald-100 bg-[#f0fdf4]/50">
                <h4 className="text-base font-bold text-[#22c55e] mb-6 flex items-center gap-2.5">
                  <CheckCircle className="w-5 h-5" /> Strengths
                </h4>
                <ul className="space-y-3">
                  {strengths.map((s, i) => (
                    <li key={i} className="text-slate-700 font-medium text-sm leading-relaxed">• {s}</li>
                  ))}
                </ul>
              </div>
              <div className="p-8 rounded-[1.5rem] border border-rose-100 bg-[#fef2f2]/50">
                <h4 className="text-base font-bold text-[#ef4444] mb-6 flex items-center gap-2.5">
                  <AlertTriangle className="w-5 h-5" /> Areas for Improvement
                </h4>
                <ul className="space-y-3">
                  {improvements.map((s, i) => (
                    <li key={i} className="text-slate-700 font-medium text-sm leading-relaxed">• {s}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* ── Recommended Action Plan ──────────────────────────────────────── */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-10">
          <h3 className="text-xl font-bold text-[#111827] mb-10">Recommended Action Plan</h3>
          <div className="space-y-0 divide-y divide-slate-50">
            {actionPlan.map((plan, idx) => (
              <div key={idx} className="flex items-center justify-between py-7 gap-8 group">
                <div className="flex items-center gap-6">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm shrink-0"
                    style={{ backgroundColor: summary.color }}
                  >
                    {idx + 1}
                  </div>
                  <div>
                    <h4 className="text-[15px] font-bold text-[#111827] mb-1 group-hover:text-blue-600 transition-colors">
                      {plan.task}
                    </h4>
                    <p className="text-slate-400 text-xs font-medium">{plan.sub}</p>
                  </div>
                </div>
                <span className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-white whitespace-nowrap ${plan.prColor}`}>
                  {plan.priority}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
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

  const { branches, performanceRanking, comparativeTrends, efficiencyMetrics } = listData;

  // Show all ranking rows always (0 will render as short bar)
  const rankingWithData = performanceRanking;
  // Only show trends chart if any month has real attendance data
  const hasTrendsData = comparativeTrends.some(row =>
    branches.some((_, i) => (row[`b${i}`] as number) > 0)
  );

  return (
    <div className="space-y-10 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">

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
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteBranch} deleting={crudSaving}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-extrabold text-[#111827] tracking-tight">Branches Comparison</h1>
          <p className="text-slate-400 font-medium text-sm">Side-by-side performance analysis</p>
        </div>
        <button
          onClick={() => { setCrudForm(EMPTY_FORM); setAddOpen(true); }}
          className="flex items-center gap-2 h-11 px-5 rounded-2xl bg-[#1e294b] text-white text-sm font-black hover:bg-[#1e3a8a] transition-all shadow-lg shadow-slate-900/10 hover:scale-105 active:scale-95 shrink-0"
        >
          <Plus className="w-4 h-4" /> Add Branch
        </button>
      </div>

      {/* Branch Cards */}
      {branches.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center bg-white rounded-[2rem] border border-slate-100">
          <Building2 className="w-16 h-16 text-slate-200 mb-4" />
          <p className="text-sm font-bold text-slate-400">No branches yet</p>
          <p className="text-xs text-slate-300 mt-1 mb-6">Create your first branch to start comparing performance</p>
          <button
            onClick={() => { setCrudForm(EMPTY_FORM); setAddOpen(true); }}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#1e294b] text-white text-sm font-black hover:bg-[#1e3a8a] transition-all shadow-lg"
          >
            <Plus className="w-4 h-4" /> Add First Branch
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {branches.map(b => (
            <div
              key={b.id}
              className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-lg transition-all group relative"
            >
              {/* Edit / Delete buttons — top right */}
              <div className="absolute top-5 right-5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(b, b.id); }}
                  className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center hover:bg-blue-50 hover:border-blue-200 hover:text-[#1e3a8a] transition-all"
                  title="Edit branch"
                >
                  <Pencil className="w-3.5 h-3.5 text-slate-400" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); openDelete(b.id, b.name); }}
                  className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center hover:bg-rose-50 hover:border-rose-200 hover:text-rose-500 transition-all"
                  title="Delete branch"
                >
                  <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                </button>
              </div>

              <div
                className="cursor-pointer"
                onClick={() => navigate(`/branches/${b.id}`)}
              >
                <div className="flex items-center gap-4 mb-8">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0"
                    style={{ backgroundColor: b.color }}
                  >
                    <Building2 className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[#111827] group-hover:text-blue-600 transition-colors">{b.name}</h3>
                    <p className="text-xs font-bold text-slate-400">{b.studentCount.toLocaleString()} students</p>
                  </div>
                </div>

                {/* Always show all 4 metrics — N/A when data not yet available */}
                <div className="divide-y divide-slate-50">
                  {[
                    { label: "AHI",            value: b.ahi,           hasData: b.ahi > 0 },
                    { label: "Fee Collection", value: b.feeCollection, hasData: b.feeCollection > 0 },
                    { label: "Pass Rate",      value: b.passRate,      hasData: b.passRate > 0 },
                    { label: "Attendance",     value: b.attendance,    hasData: b.attendance > 0 },
                  ].map(m => (
                    <div key={m.label} className="flex justify-between items-center py-3.5">
                      <span className="text-sm text-slate-500">{m.label}</span>
                      {m.hasData ? (
                        <span className={`text-sm font-bold ${metricColor(m.value)}`}>{m.value}%</span>
                      ) : (
                        <span className="text-sm font-semibold text-slate-300">N/A</span>
                      )}
                    </div>
                  ))}
                </div>

                {b.activeAlerts > 0 && (
                  <div className="mt-4 px-4 py-2.5 rounded-xl bg-[#fef2f2] border border-rose-100 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span className="text-xs font-bold text-rose-500">{b.activeAlerts} student{b.activeAlerts > 1 ? "s" : ""} at risk</span>
                  </div>
                )}

                {/* Status badge — bottom */}
                {b.ahi > 0 && (
                  <div className="mt-4 flex">
                    <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest text-white ${statusConfig(b.status)}`}>
                      {b.status}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts — only render if at least one has data */}
      {branches.length > 0 && (rankingWithData.length > 0 || hasTrendsData) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Performance Ranking */}
          <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
            <h3 className="text-lg font-bold text-[#111827] mb-12">Performance Ranking</h3>
            {rankingWithData.length === 0 ? (
              <div className="h-[300px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
                <p className="text-sm text-slate-400 font-semibold">No performance data yet</p>
                <p className="text-xs text-slate-300">Appears once attendance or results are recorded</p>
              </div>
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rankingWithData} layout="vertical" barGap={4} margin={{ left: 0, right: 20 }}>
                    <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} ticks={[0, 20, 40, 60, 80, 100]} />
                    <YAxis dataKey="metric" type="category" axisLine={false} tickLine={false}
                      tick={{ fill: "#64748b", fontSize: 11, fontWeight: "bold" }} width={80} />
                    <Tooltip cursor={{ fill: "#f8fafc" }} contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: "20px" }}
                      content={({ payload }) => (
                        <div className="flex justify-center gap-6 mt-6">
                          {payload?.map((e: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: e.color }}></div>
                              <span className="text-[11px] font-bold text-slate-500">{e.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    />
                    {branches.map((b, i) => (
                      <Bar key={b.id} dataKey={`b${i}`} name={b.name.split(" ")[0]}
                        fill={b.color} radius={[0, 2, 2, 0]} barSize={10} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Comparative Trends */}
          <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
            <h3 className="text-lg font-bold text-[#111827] mb-12">Comparative Trends (Attendance %)</h3>
            {!hasTrendsData ? (
              <div className="h-[300px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
                <p className="text-sm text-slate-400 font-semibold">No attendance trend data yet</p>
                <p className="text-xs text-slate-300">Appears once daily attendance is recorded</p>
              </div>
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={comparativeTrends} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }} dy={10} />
                    <YAxis axisLine={false} tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: "bold" }}
                      domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} />
                    <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: "20px" }}
                      content={({ payload }) => (
                        <div className="flex justify-center gap-6 mt-6">
                          {payload?.map((e: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-full border-[2.5px] bg-white" style={{ borderColor: e.color }}></div>
                              <span className="text-[11px] font-bold text-slate-500">{e.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    />
                    {branches.map((b, i) => (
                      <Line key={b.id} type="monotone" dataKey={`b${i}`} name={b.name.split(" ")[0]}
                        stroke={b.color} strokeWidth={3}
                        dot={{ r: 5, fill: "#fff", strokeWidth: 2.5, stroke: b.color }}
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
        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-10">
          <h3 className="text-xl font-bold text-[#111827] mb-10">Efficiency Metrics</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {efficiencyMetrics.map((m, i) => (
              <div key={i} className="bg-[#f8fafc]/50 border border-slate-100 p-8 rounded-[1.5rem] text-center transition-all hover:bg-white hover:shadow-lg">
                <p className="text-slate-400 text-[11px] font-bold uppercase tracking-tight mb-4">{m.label}</p>
                <h3 className={`text-3xl font-black tracking-tighter mb-2 ${m.col}`}>{m.value}</h3>
                <p className={`text-[11px] font-bold ${m.col}`}>{m.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
