import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck, Clock, CheckCircle2, XCircle, User, Mail,
  Phone, Building2, Loader2, Search, Filter, RefreshCw,
  AlertCircle, ChevronDown, Eye, EyeOff, UserCheck, Users
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import {
  collection, query, where, onSnapshot, updateDoc, doc,
  getDocs, getDoc
} from "firebase/firestore";
import { toast } from "sonner";
import { addAuditLog } from "@/lib/auditService";

// ── Types ────────────────────────────────────────────────────────────────────
interface DEORequest {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role?: string;
  branchId: string;
  branchName: string;
  schoolId: string;
  status: "pending" | "approved" | "rejected";
  requestDate: any;
  approvedAt?: any;
  rejectedAt?: any;
  rejectionReason?: string;
  allowedPages?: string[];
}

const STATUS_CONFIG = {
  pending:  { label: "Pending",  bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",  icon: Clock,         dot: "bg-amber-400" },
  approved: { label: "Approved", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", icon: CheckCircle2, dot: "bg-emerald-400" },
  rejected: { label: "Rejected", bg: "bg-rose-50",    text: "text-rose-700",    border: "border-rose-200",    icon: XCircle,      dot: "bg-rose-400" },
};

const PAGE_LABELS: Record<string, string> = {
  "/students":     "Students",
  "/attendance":   "Attendance",
  "/assignments":  "Assignments",
  "/exams":        "Exams",
  "/teacher-notes":"Teacher Notes",
  "/classes":      "Classes",
};

// ── Empty State ───────────────────────────────────────────────────────────────
const EmptyDEO = ({ tab }: { tab: string }) => (
  <div className="flex flex-col items-center justify-center py-24 gap-4">
    <div className="w-20 h-20 rounded-3xl bg-slate-50 border border-slate-100 flex items-center justify-center">
      <ShieldCheck className="w-10 h-10 text-slate-200" />
    </div>
    <div className="text-center">
      <p className="text-sm font-bold text-slate-500">No {tab} DEO requests</p>
      <p className="text-xs text-slate-300 mt-1">
        {tab === "pending"
          ? "New requests from principals will appear here"
          : tab === "approved"
          ? "Approved DEOs will appear here"
          : "Rejected requests will appear here"
        }
      </p>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
export default function DEOManagement() {
  const navigate = useNavigate();
  const [requests, setRequests]     = useState<DEORequest[]>([]);
  const [branches, setBranches]     = useState<Record<string, string>>({});
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState<"pending" | "approved" | "rejected">("pending");
  const [search, setSearch]         = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [revoking, setRevoking]     = useState<string | null>(null);

  // ── Load branches ─────────────────────────────────────────────────────────
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDocs(collection(db, "schools", uid, "branches")).then(snap => {
      const map: Record<string, string> = {};
      snap.docs.forEach(d => {
        const bid = d.data().branchId || d.id;
        map[bid] = d.data().name || "Branch";
      });
      setBranches(map);
    });
  }, []);

  // ── Realtime DEO requests (access_requests where schoolId == ownerUid) ────
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const unsub = onSnapshot(
      query(collection(db, "access_requests"), where("schoolId", "==", uid)),
      snap => {
        const items: DEORequest[] = snap.docs.map(d => {
          const data = d.data();
          const branchId = data.branchId || "";
          return {
            id:              d.id,
            name:            data.name       || "Unknown",
            email:           data.email      || "—",
            phone:           data.phone      || "",
            role:            data.role       || "DEO",
            branchId,
            branchName:      data.branchName || branches[branchId] || "—",
            schoolId:        data.schoolId,
            status:          data.status     || "pending",
            requestDate:     data.requestDate || data.createdAt || null,
            approvedAt:      data.approvedAt  || null,
            rejectedAt:      data.rejectedAt  || null,
            rejectionReason: data.rejectionReason || "",
            allowedPages:    data.allowedPages    || [],
          };
        });
        // Sort newest first
        items.sort((a, b) => {
          const ta = a.requestDate?.toMillis?.() || 0;
          const tb = b.requestDate?.toMillis?.() || 0;
          return tb - ta;
        });
        setRequests(items);
        setLoading(false);
      },
      err => {
        console.error("DEO listener error:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [branches]);

  // ── Revoke access (approved → rejected) ───────────────────────────────────
  const handleRevoke = async (req: DEORequest) => {
    if (!window.confirm(`Revoke access for ${req.name}? They will lose access to the principal dashboard.`)) return;
    setRevoking(req.id);
    try {
      await updateDoc(doc(db, "access_requests", req.id), {
        status: "rejected",
        rejectionReason: "Access revoked by school owner",
        rejectedAt: new Date().toISOString(),
      });
      addAuditLog("deo_revoked", `DEO access revoked for ${req.name}`, req.branchName || req.email);
      toast.success(`Access revoked for ${req.name}`);
    } catch (e) {
      console.error(e);
      toast.error("Failed to revoke access. Try again.");
    } finally {
      setRevoking(null);
    }
  };

  // ── Reinstate (rejected → pending, so principal can re-approve) ──────────
  const handleReinstate = async (req: DEORequest) => {
    setRevoking(req.id);
    try {
      await updateDoc(doc(db, "access_requests", req.id), {
        status: "pending",
        rejectionReason: "",
        rejectedAt: null,
      });
      addAuditLog("deo_reinstated", `${req.name} reinstated to pending status`);
      toast.success(`${req.name} reinstated as pending — principal can now approve.`);
    } catch (e) {
      console.error(e);
      toast.error("Failed to reinstate.");
    } finally {
      setRevoking(null);
    }
  };

  // ── Derived lists ─────────────────────────────────────────────────────────
  const filtered = requests.filter(r => {
    if (r.status !== tab) return false;
    if (branchFilter !== "all" && r.branchId !== branchFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const counts = {
    pending:  requests.filter(r => r.status === "pending").length,
    approved: requests.filter(r => r.status === "approved").length,
    rejected: requests.filter(r => r.status === "rejected").length,
  };

  const branchList = Object.entries(branches);

  const formatDate = (ts: any) => {
    if (!ts) return "—";
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return "—"; }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#1e3a8a]" />
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Loading DEO Data...</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-black text-[#1e293b] tracking-tight">DEO Management</h1>
          <p className="text-slate-400 text-sm font-medium mt-1">
            Data Entry Operators across all branches — real-time access oversight
          </p>
        </div>
        {/* Summary pills */}
        <div className="flex items-center gap-3 flex-wrap">
          {(["pending", "approved", "rejected"] as const).map(s => {
            const cfg = STATUS_CONFIG[s];
            return (
              <div key={s} className={`flex items-center gap-2 px-4 py-2 rounded-2xl border ${cfg.bg} ${cfg.border}`}>
                <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                <span className={`text-xs font-black ${cfg.text}`}>{counts[s]} {cfg.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total DEOs",      value: requests.length,      icon: Users,       color: "text-[#1e3a8a]", bg: "bg-blue-50"    },
          { label: "Active (Approved)", value: counts.approved,   icon: UserCheck,   color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Awaiting Approval", value: counts.pending,    icon: Clock,       color: "text-amber-600",  bg: "bg-amber-50"   },
          { label: "Branches with DEOs",value: new Set(requests.filter(r=>r.status==="approved").map(r=>r.branchId)).size, icon: Building2, color: "text-purple-600", bg: "bg-purple-50" },
        ].map((s, i) => (
          <div
            key={i}
            onClick={() => navigate("/deo")}
            role="button"
            tabIndex={0}
            className="clickable-card bg-white rounded-[1.5rem] border border-slate-100 p-6 shadow-sm"
          >
            <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center mb-4`}>
              <s.icon className={`w-5 h-5 ${s.color}`} />
            </div>
            <p className="text-2xl font-black text-[#1e293b]">{s.value}</p>
            <p className="text-[11px] font-bold text-slate-400 mt-1 uppercase tracking-wide">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm">
        {/* Tabs */}
        <div className="flex items-center border-b border-slate-50 px-6 pt-2 gap-1">
          {(["pending", "approved", "rejected"] as const).map(s => {
            const cfg = STATUS_CONFIG[s];
            const active = tab === s;
            return (
              <button
                key={s}
                onClick={() => setTab(s)}
                className={`flex items-center gap-2 px-5 py-4 text-xs font-black uppercase tracking-widest transition-all border-b-2 -mb-px ${
                  active
                    ? `border-[#1e3a8a] ${cfg.text}`
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                {cfg.label}
                {counts[s] > 0 && (
                  <span className={`w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center ${active ? `${cfg.bg} ${cfg.text}` : "bg-slate-100 text-slate-400"}`}>
                    {counts[s]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search + branch filter */}
        <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-slate-50">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-100 bg-slate-50 text-sm font-medium text-[#1e293b] outline-none focus:border-blue-200 focus:bg-white transition-all"
            />
          </div>
          {branchList.length > 1 && (
            <div className="relative">
              <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
              <select
                value={branchFilter}
                onChange={e => setBranchFilter(e.target.value)}
                className="h-11 pl-10 pr-8 rounded-xl border border-slate-100 bg-slate-50 text-sm font-semibold text-[#1e293b] outline-none focus:border-blue-200 focus:bg-white transition-all appearance-none"
              >
                <option value="all">All Branches</option>
                {branchList.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <EmptyDEO tab={tab} />
        ) : (
          <div className="divide-y divide-slate-50">
            {filtered.map(req => {
              const cfg    = STATUS_CONFIG[req.status];
              const isOpen = expandedId === req.id;
              return (
                <div key={req.id} className="transition-all">
                  {/* Row */}
                  <div
                    className="flex items-center justify-between px-6 py-5 hover:bg-slate-50/50 transition-colors cursor-pointer gap-4"
                    onClick={() => setExpandedId(isOpen ? null : req.id)}
                  >
                    {/* Left: avatar + info */}
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-[#1e294b] text-white flex items-center justify-center text-sm font-black shrink-0">
                        {req.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-[#1e293b] truncate">{req.name}</p>
                        <p className="text-xs text-slate-400 font-medium truncate">{req.email}</p>
                      </div>
                    </div>

                    {/* Middle: branch + date */}
                    <div className="hidden md:flex items-center gap-6 text-xs text-slate-400 font-medium shrink-0">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-slate-300" />
                        <span>{req.branchName !== "—" ? req.branchName : (branches[req.branchId] || "—")}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-300" />
                        <span>{formatDate(req.requestDate)}</span>
                      </div>
                    </div>

                    {/* Right: status + expand */}
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-black uppercase tracking-widest ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                        <cfg.icon className="w-3 h-3" /> {cfg.label}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isOpen && (
                    <div className="px-6 pb-6 animate-in fade-in duration-200">
                      <div className="bg-slate-50/80 rounded-2xl border border-slate-100 p-6 space-y-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                          {[
                            { label: "Full Name",   value: req.name,                        icon: User },
                            { label: "Email",       value: req.email,                       icon: Mail },
                            { label: "Phone",       value: req.phone || "—",                icon: Phone },
                            { label: "Branch",      value: req.branchName !== "—" ? req.branchName : (branches[req.branchId] || "—"), icon: Building2 },
                          ].map((f, i) => (
                            <div key={i} className="space-y-1">
                              <p className="font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                <f.icon className="w-3 h-3" /> {f.label}
                              </p>
                              <p className="font-semibold text-[#1e293b] truncate">{f.value}</p>
                            </div>
                          ))}
                        </div>

                        {/* Allowed pages */}
                        {req.status === "approved" && req.allowedPages && req.allowedPages.length > 0 && (
                          <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Allowed Pages</p>
                            <div className="flex flex-wrap gap-2">
                              {req.allowedPages.map(p => (
                                <span key={p} className="px-3 py-1 rounded-lg bg-blue-50 border border-blue-100 text-[11px] font-bold text-[#1e3a8a]">
                                  {PAGE_LABELS[p] || p}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Rejection reason */}
                        {req.status === "rejected" && req.rejectionReason && (
                          <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-100">
                            <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-[11px] font-black text-rose-600 uppercase tracking-wide">Reason</p>
                              <p className="text-xs text-rose-500 font-medium mt-0.5">{req.rejectionReason}</p>
                            </div>
                          </div>
                        )}

                        {/* Action buttons — owner can revoke approved / reinstate rejected */}
                        {req.status === "approved" && (
                          <div className="flex justify-end pt-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRevoke(req); }}
                              disabled={revoking === req.id}
                              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 text-xs font-black hover:bg-rose-100 transition-all disabled:opacity-60"
                            >
                              {revoking === req.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <EyeOff className="w-3.5 h-3.5" />
                              }
                              Revoke Access
                            </button>
                          </div>
                        )}
                        {req.status === "rejected" && (
                          <div className="flex justify-end pt-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleReinstate(req); }}
                              disabled={revoking === req.id}
                              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-[#1e3a8a] text-xs font-black hover:bg-blue-100 transition-all disabled:opacity-60"
                            >
                              {revoking === req.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Eye className="w-3.5 h-3.5" />
                              }
                              Reinstate to Pending
                            </button>
                          </div>
                        )}
                        {req.status === "pending" && (
                          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100">
                            <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                            <p className="text-xs text-amber-600 font-semibold">
                              Awaiting approval by branch principal. You will be notified when they act.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info note */}
      <div className="flex items-start gap-3 p-5 rounded-2xl bg-blue-50 border border-blue-100">
        <ShieldCheck className="w-5 h-5 text-[#1e3a8a] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-[#1e3a8a]">DEO Access Flow</p>
          <p className="text-xs text-blue-600 font-medium mt-1 leading-relaxed">
            DEOs request access via their branch principal's dashboard. The principal approves or rejects with specific page permissions.
            As owner, you have oversight visibility and can revoke approved access or reinstate rejected requests across all branches.
          </p>
        </div>
      </div>
    </div>
  );
}
