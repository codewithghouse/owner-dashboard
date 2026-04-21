import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck, Clock, CheckCircle2, XCircle, User, Mail,
  Phone, Building2, Loader2, Search, Filter, RefreshCw,
  AlertCircle, ChevronDown, Eye, EyeOff, UserCheck, Users,
  Sparkles,
} from "lucide-react";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD, VIOLET,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, GRAD_RED,
  SHADOW_SM, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, Card3D, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";
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
  <div className="flex flex-col items-center justify-center py-14 md:py-24 gap-3 md:gap-4 px-4">
    <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl md:rounded-3xl bg-slate-50 border border-slate-100 flex items-center justify-center">
      <ShieldCheck className="w-8 h-8 md:w-10 md:h-10 text-slate-200" />
    </div>
    <div className="text-center">
      <p className="text-xs md:text-sm font-bold text-slate-500">No {tab} DEO requests</p>
      <p className="text-[11px] md:text-xs text-slate-300 mt-1 leading-snug">
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
  const isMobile = useIsMobile();
  const pageShellStyle = usePageShellStyle();
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
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14 }}>
        <Loader2 className="animate-spin" size={isMobile ? 30 : 38} color={B1}/>
        <p style={{ fontSize:10, fontWeight:800, color:T4, letterSpacing:"0.14em", textTransform:"uppercase" }}>Loading DEO Data...</p>
      </div>
    );
  }

  const totalApproved = counts.approved;
  const totalBranchesWithDEO = new Set(requests.filter(r=>r.status==="approved").map(r=>r.branchId)).size;

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 16 : 24 }}>

      <PageHead
        icon={ShieldCheck}
        title="DEO Management"
        subtitle={isMobile ? "Real-time oversight of all DEOs" : "Data Entry Operators across all branches — real-time oversight"}
        right={
          <div style={{ display:"flex", gap: isMobile ? 6 : 8, flexWrap:"wrap", width: isMobile ? "100%" : "auto" }}>
            {(["pending", "approved", "rejected"] as const).map(s => {
              const cfg = STATUS_CONFIG[s];
              const grad = s === "pending" ? GRAD_GOLD : s === "approved" ? GRAD_GREEN : GRAD_RED;
              return (
                <div key={s}
                  style={{
                    display:"inline-flex", alignItems:"center", gap: isMobile ? 5 : 6,
                    padding: isMobile ? "6px 10px" : "8px 14px", borderRadius: isMobile ? 10 : 12,
                    background:"#fff", border:"0.5px solid rgba(0,85,255,.1)",
                    fontSize: isMobile ? 9 : 10, fontWeight:800, color:T3,
                    letterSpacing:"0.08em", textTransform:"uppercase",
                    boxShadow:SHADOW_SM, flex: isMobile ? 1 : "none", justifyContent: isMobile ? "center" : "flex-start",
                  }}
                >
                  <div style={{ width: isMobile ? 6 : 8, height: isMobile ? 6 : 8, borderRadius:"50%", background:grad, flexShrink:0 }}/>
                  <span style={{ whiteSpace:"nowrap" }}>{counts[s]} {isMobile ? cfg.label.slice(0, 3) : cfg.label}</span>
                </div>
              );
            })}
          </div>
        }
      />

      <DarkHero
        icon={Users}
        eyebrow={<><Sparkles size={11} style={{ display:"inline", marginRight:4 }}/> DEO Intelligence</> as any}
        title={requests.length.toString()}
        subtitle={`Total DEO request${requests.length!==1?"s":""} across ${Object.keys(branches).length} branch${Object.keys(branches).length!==1?"es":""} · ${totalApproved} active`}
        stats={[
          { label:"Pending",   value: counts.pending.toString() },
          { label:"Approved",  value: counts.approved.toString() },
          { label:"Rejected",  value: counts.rejected.toString() },
        ]}
      />

      {/* Bright Stat Grid */}
      <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16 }}>
        <StatTile label="Total DEOs"         value={requests.length.toString()}     sub="All requests"       grad={GRAD_BLUE}   icon={Users}       onClick={()=>setTab("pending")} />
        <StatTile label="Active (Approved)"  value={counts.approved.toString()}     sub="Currently active"   grad={GRAD_GREEN}  icon={UserCheck}   onClick={()=>setTab("approved")} />
        <StatTile label="Awaiting Approval"  value={counts.pending.toString()}      sub="Pending review"     grad={GRAD_GOLD}   icon={Clock}       onClick={()=>setTab("pending")} />
        <StatTile label="Branches with DEOs" value={totalBranchesWithDEO.toString()} sub="Branch coverage"   grad={GRAD_VIOLET} icon={Building2}   />
      </div>

      {/* Filters panel */}
      <Card3D padding={0} style={{ overflow:"hidden" }}>
        {/* Tabs */}
        <div
          style={{
            display:"flex", gap:4, borderBottom:"0.5px solid rgba(0,85,255,.08)",
            padding: isMobile ? "6px 6px" : "6px 8px",
            overflowX:"auto", WebkitOverflowScrolling:"touch",
          }}
        >
          {(["pending", "approved", "rejected"] as const).map(s => {
            const cfg = STATUS_CONFIG[s];
            const active = tab === s;
            return (
              <button
                key={s}
                onClick={() => setTab(s)}
                className="dash-btn"
                style={{
                  display:"inline-flex", alignItems:"center", gap: isMobile ? 6 : 8,
                  padding: isMobile ? "8px 12px" : "10px 18px", borderRadius: isMobile ? 10 : 12,
                  background: active ? GRAD_PRIMARY : "transparent",
                  color: active ? "#fff" : T3,
                  fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
                  border:"none", cursor:"pointer", fontFamily:"inherit",
                  boxShadow: active ? SHADOW_BTN : "none",
                  whiteSpace:"nowrap", flexShrink:0,
                }}
              >
                {cfg.label}
                {counts[s] > 0 && (
                  <span style={{
                    fontSize: isMobile ? 9 : 10, fontWeight:800, padding: isMobile ? "1px 6px" : "2px 7px", borderRadius:999,
                    background: active ? "rgba(255,255,255,.3)" : "rgba(0,85,255,.08)",
                    color: active ? "#fff" : B1,
                  }}>
                    {counts[s]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search + branch filter */}
        <div style={{ display:"flex", gap: isMobile ? 8 : 10, padding: isMobile ? "10px 12px" : "14px 18px", borderBottom:"0.5px solid rgba(0,85,255,.08)", flexWrap:"wrap" }}>
          <div style={{ position:"relative", flex:1, minWidth: isMobile ? "100%" : 220 }}>
            <Search size={14} color={T4} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}/>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isMobile ? "Search name or email" : "Search by name or email..."}
              style={{
                width:"100%", padding: isMobile ? "9px 10px 9px 34px" : "10px 12px 10px 36px", borderRadius:12,
                border:"0.5px solid rgba(0,85,255,.14)", background:"#F5F9FF",
                fontSize: isMobile ? 12 : 13, fontWeight:500, color:T1, outline:"none", fontFamily:"inherit",
              }}
            />
          </div>
          {branchList.length > 1 && (
            <div style={{ position:"relative", width: isMobile ? "100%" : "auto" }}>
              <Filter size={14} color={T4} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}/>
              <select
                value={branchFilter}
                onChange={e => setBranchFilter(e.target.value)}
                style={{
                  appearance:"none", padding: isMobile ? "9px 34px 9px 34px" : "10px 36px 10px 36px", borderRadius:12,
                  border:"0.5px solid rgba(0,85,255,.14)", background:"#F5F9FF",
                  fontSize: isMobile ? 12 : 12, fontWeight:700, color:T3,
                  outline:"none", fontFamily:"inherit", cursor:"pointer",
                  minWidth: isMobile ? 0 : 180, width: isMobile ? "100%" : "auto",
                }}
              >
                <option value="all">All Branches</option>
                {branchList.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
              <ChevronDown size={13} color={T4} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}/>
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
              const branchDisplay = req.branchName !== "—" ? req.branchName : (branches[req.branchId] || "—");
              return (
                <div key={req.id} className="transition-all">
                  {/* Row */}
                  <div
                    className="flex items-center justify-between px-3 md:px-6 py-3.5 md:py-5 hover:bg-slate-50/50 transition-colors cursor-pointer gap-2.5 md:gap-4"
                    onClick={() => setExpandedId(isOpen ? null : req.id)}
                  >
                    {/* Left: avatar + info */}
                    <div className="flex items-center gap-3 md:gap-4 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-xl bg-[#1e294b] text-white flex items-center justify-center text-sm font-black shrink-0 relative">
                        {req.name.substring(0, 2).toUpperCase()}
                        {/* Mobile status dot */}
                        <span className={`md:hidden absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${cfg.dot}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] md:text-sm font-black text-[#1e293b] truncate">{req.name}</p>
                        <p className="text-[11px] md:text-xs text-slate-400 font-medium truncate">{req.email}</p>
                        {/* Mobile meta row */}
                        <div className="flex items-center gap-2 mt-1 md:hidden">
                          <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-semibold min-w-0">
                            <Building2 className="w-3 h-3 text-slate-300 shrink-0" />
                            <span className="truncate">{branchDisplay}</span>
                          </span>
                          <span className="text-slate-200">·</span>
                          <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-medium shrink-0">
                            <Clock className="w-3 h-3 text-slate-300" />
                            {formatDate(req.requestDate)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Middle: branch + date (desktop only) */}
                    <div className="hidden md:flex items-center gap-6 text-xs text-slate-400 font-medium shrink-0">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-slate-300" />
                        <span>{branchDisplay}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-300" />
                        <span>{formatDate(req.requestDate)}</span>
                      </div>
                    </div>

                    {/* Right: status + expand */}
                    <div className="flex items-center gap-2 md:gap-3 shrink-0">
                      <span className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-black uppercase tracking-widest ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                        <cfg.icon className="w-3 h-3" /> {cfg.label}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isOpen && (
                    <div className="px-3 md:px-6 pb-4 md:pb-6 animate-in fade-in duration-200">
                      <div className="bg-slate-50/80 rounded-xl md:rounded-2xl border border-slate-100 p-3 md:p-6 space-y-3 md:space-y-4">
                        {/* Mobile status pill (shown here since hidden in row) */}
                        <span className={`sm:hidden inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                          <cfg.icon className="w-3 h-3" /> {cfg.label}
                        </span>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 text-xs">
                          {[
                            { label: "Full Name",   value: req.name,                        icon: User },
                            { label: "Email",       value: req.email,                       icon: Mail },
                            { label: "Phone",       value: req.phone || "—",                icon: Phone },
                            { label: "Branch",      value: branchDisplay, icon: Building2 },
                          ].map((f, i) => (
                            <div key={i} className="space-y-1 min-w-0">
                              <p className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                <f.icon className="w-3 h-3 shrink-0" /> <span className="truncate">{f.label}</span>
                              </p>
                              <p className="text-[11px] md:text-xs font-semibold text-[#1e293b] truncate">{f.value}</p>
                            </div>
                          ))}
                        </div>

                        {/* Allowed pages */}
                        {req.status === "approved" && req.allowedPages && req.allowedPages.length > 0 && (
                          <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Allowed Pages</p>
                            <div className="flex flex-wrap gap-1.5 md:gap-2">
                              {req.allowedPages.map(p => (
                                <span key={p} className="px-2.5 md:px-3 py-1 rounded-lg bg-blue-50 border border-blue-100 text-[10px] md:text-[11px] font-bold text-[#1e3a8a]">
                                  {PAGE_LABELS[p] || p}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Rejection reason */}
                        {req.status === "rejected" && req.rejectionReason && (
                          <div className="flex items-start gap-2 p-2.5 md:p-3 rounded-xl bg-rose-50 border border-rose-100">
                            <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-[11px] font-black text-rose-600 uppercase tracking-wide">Reason</p>
                              <p className="text-[11px] md:text-xs text-rose-500 font-medium mt-0.5 break-words">{req.rejectionReason}</p>
                            </div>
                          </div>
                        )}

                        {/* Action buttons — owner can revoke approved / reinstate rejected */}
                        {req.status === "approved" && (
                          <div className="flex justify-stretch md:justify-end pt-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRevoke(req); }}
                              disabled={revoking === req.id}
                              className="flex items-center justify-center gap-2 px-4 md:px-5 py-2.5 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 text-[11px] md:text-xs font-black hover:bg-rose-100 transition-all disabled:opacity-60 w-full md:w-auto"
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
                          <div className="flex justify-stretch md:justify-end pt-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleReinstate(req); }}
                              disabled={revoking === req.id}
                              className="flex items-center justify-center gap-2 px-4 md:px-5 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-[#1e3a8a] text-[11px] md:text-xs font-black hover:bg-blue-100 transition-all disabled:opacity-60 w-full md:w-auto"
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
                          <div className="flex items-start gap-2 p-2.5 md:p-3 rounded-xl bg-amber-50 border border-amber-100">
                            <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <p className="text-[11px] md:text-xs text-amber-600 font-semibold leading-snug">
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
      </Card3D>

      {/* Info banner */}
      <div
        style={{
          background:"#fff", borderRadius: isMobile ? 14 : 18, padding: isMobile ? "12px 14px" : "16px 18px",
          border:"0.5px solid rgba(0,85,255,.1)", boxShadow:SHADOW_SM,
          display:"flex", alignItems:"flex-start", gap: isMobile ? 10 : 12,
        }}
      >
        <div style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: isMobile ? 10 : 11, background:GRAD_PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 6px 14px rgba(0,85,255,.28)", flexShrink:0 }}>
          <ShieldCheck size={isMobile ? 16 : 18} color="#fff" strokeWidth={2.3}/>
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: isMobile ? 12 : 13, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.2px" }}>DEO Access Flow</p>
          <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:500, color:T3, margin:"4px 0 0 0", lineHeight:1.55 }}>
            DEOs request access via their branch principal's dashboard. The principal approves or rejects with specific page permissions.
            As owner, you have oversight visibility and can revoke approved access or reinstate rejected requests across all branches.
          </p>
        </div>
      </div>

      <AIInsightCard
        title="DEO Intelligence Summary"
        items={[
          { label:"Access Queue",     value: counts.pending > 0 ? `${counts.pending} pending` : "No pending", sub: counts.pending > 0 ? "Principal action needed" : "All caught up" },
          { label:"Active Workforce", value: `${counts.approved} active DEO${counts.approved!==1?"s":""}`, sub: `Across ${totalBranchesWithDEO} branch${totalBranchesWithDEO!==1?"es":""}` },
          { label:"Rejection Rate",   value: requests.length > 0 ? `${Math.round((counts.rejected/requests.length)*100)}%` : "—", sub: counts.rejected > 0 ? `${counts.rejected} rejected` : "No rejections" },
        ]}
      />
      </div>
    </>
  );
}
