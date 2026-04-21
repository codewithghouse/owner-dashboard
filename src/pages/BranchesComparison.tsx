import { useState, useEffect, useRef } from "react";
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
  SHADOW_SM, SHADOW_LG, SHADOW_BTN, pageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, Card3D, AIInsightCard,
} from "@/lib/dashboardTokens";
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

/* ══════════════════════════════════════════════════════════════════════════
   BranchTiltCard — 3D mouse-tracking wrapper.
   Each instance tracks its own tilt + cursor position.
   Adds: perspective rotation, subtle Z-lift on hover, cursor spotlight.
   ══════════════════════════════════════════════════════════════════════════ */
function BranchTiltCard({
  children, onClick, outerStyle, outerClassName, isDark,
}: {
  children: React.ReactNode;
  onClick: () => void;
  outerStyle: React.CSSProperties;
  outerClassName: string;
  isDark: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt]     = useState({ x: 0, y: 0 });
  const [mouse, setMouse]   = useState({ x: 50, y: 50 }); // percent
  const [hovered, setHovered] = useState(false);

  const MAX_TILT = 8;    // degrees
  const LIFT_Z   = 20;   // pixels on hover

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;   // 0..1
    const relY = (e.clientY - rect.top)  / rect.height;  // 0..1
    /* Invert Y so moving up tilts forward */
    setTilt({
      x: (0.5 - relY) * MAX_TILT * 2,
      y: (relX - 0.5) * MAX_TILT * 2,
    });
    setMouse({ x: relX * 100, y: relY * 100 });
  };

  const handleLeave = () => {
    setTilt({ x: 0, y: 0 });
    setHovered(false);
  };

  return (
    <div
      style={{ perspective: 1400 }}
      className="[transform-style:preserve-3d]"
    >
      <div
        ref={ref}
        onClick={onClick}
        onMouseMove={handleMove}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={handleLeave}
        role="button"
        tabIndex={0}
        style={{
          ...outerStyle,
          transform:
            `perspective(1400px) ` +
            `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) ` +
            `translateZ(${hovered ? LIFT_Z : 0}px)`,
          transition: hovered
            ? "transform 80ms linear, box-shadow 200ms ease-out"
            : "transform 400ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 300ms ease-out",
          transformStyle: "preserve-3d",
          willChange: "transform",
        }}
        className={outerClassName}
      >
        {children}

        {/* Cursor-following spotlight — an extra sheen that chases the pointer */}
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-200 rounded-[1.65rem]"
          style={{
            opacity: hovered ? 1 : 0,
            background: `radial-gradient(420px circle at ${mouse.x}% ${mouse.y}%, ${
              isDark ? "rgba(197,167,112,0.22)" : "rgba(30,58,138,0.10)"
            } 0%, transparent 55%)`,
            mixBlendMode: isDark ? "screen" : "multiply",
            zIndex: 5,
          }}
        />
      </div>
    </div>
  );
}

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

  /* ── Luxury-metal theme: looks like real platinum / gold / onyx ──
     Each tier uses MULTI-STOP gradients to fake the way light hits metal,
     plus an overlay specular highlight + noise grain layered on top. */
  const tierTheme = (status: string, hasData: boolean) => {

    if (!hasData) {
      /* PEARL — iridescent mother-of-pearl finish for empty branches */
      return {
        key: "neutral",
        label: "AWAITING DATA",
        bg:
          /* Soft pearl with subtle pink-blue iridescence */
          "linear-gradient(135deg," +
            "#fdfdfd 0%," +
            "#f8fafc 22%," +
            "#f0eef5 48%," +
            "#f6f4f8 72%," +
            "#eef2f7 100%)",
        /* Specular highlight — diagonal gloss band near top-left */
        gloss:
          "linear-gradient(125deg," +
            "rgba(255,255,255,0) 0%," +
            "rgba(255,255,255,0.55) 18%," +
            "rgba(255,255,255,0.0) 38%)",
        ringBorder:
          "linear-gradient(135deg,#ffffff 0%,#cfd6e0 50%,#9aa4b2 100%)",
        border: "border-transparent",
        title:      "text-[#1e294b]",
        subtitle:   "text-slate-500",
        metricLabel:"text-slate-500",
        divider:    "border-slate-100",
        iconBg:     "linear-gradient(135deg,#cbd5e1 0%,#94a3b8 50%,#64748b 100%)",
        patternOpacity: 0.55,
        badgeBg:    "bg-gradient-to-r from-slate-100 to-slate-200",
        badgeText:  "text-slate-700",
        accent:     "#B8985F",
        noiseOpacity: 0.18,
      };
    }

    if (status === "Strong") {
      /* OBSIDIAN + 24K — black-platinum tile with deep gold trim (Luxury) */
      return {
        key: "luxury",
        label: "LUXURY",
        bg:
          /* Layered: radial highlight near top-right + diagonal black-gradient */
          "radial-gradient(120% 80% at 100% 0%, rgba(197,167,112,0.18) 0%, rgba(197,167,112,0) 45%)," +
          "linear-gradient(135deg," +
            "#0A1424 0%," +
            "#0F1E36 25%," +
            "#15264B 50%," +
            "#0F1E36 75%," +
            "#070D18 100%)",
        gloss:
          "linear-gradient(120deg," +
            "rgba(255,255,255,0) 0%," +
            "rgba(229,212,177,0.18) 12%," +
            "rgba(255,255,255,0) 28%)",
        ringBorder:
          "linear-gradient(135deg,#E5D4B1 0%,#C5A770 30%,#8B6D3E 60%,#C5A770 100%)",
        border: "border-transparent",
        title:      "text-white",
        subtitle:   "text-[#E5D4B1]",
        metricLabel:"text-[#C5A770]/85",
        divider:    "border-[#C5A770]/15",
        iconBg:
          "linear-gradient(135deg," +
            "#F4E5BE 0%," +
            "#D4B26A 30%," +
            "#A07F3B 65%," +
            "#7A5A24 100%)",
        patternOpacity: 1,
        badgeBg:
          "bg-gradient-to-r from-[#F4E5BE] via-[#C5A770] to-[#8B6D3E]",
        badgeText:  "text-[#0A1424]",
        accent:     "#C5A770",
        noiseOpacity: 0.12,
      };
    }

    if (status === "Good") {
      /* 24K LIQUID GOLD — molten gold finish with bright reflection band (Premium) */
      return {
        key: "premium",
        label: "PREMIUM",
        bg:
          /* Reflection band near top + smooth gold gradient */
          "radial-gradient(120% 90% at 0% 0%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 40%)," +
          "linear-gradient(135deg," +
            "#D4A85F 0%," +
            "#C09255 22%," +
            "#A57B45 50%," +
            "#8E6938 78%," +
            "#7A5926 100%)",
        gloss:
          "linear-gradient(115deg," +
            "rgba(255,255,255,0) 0%," +
            "rgba(255,255,255,0.32) 14%," +
            "rgba(255,255,255,0) 32%)",
        ringBorder:
          "linear-gradient(135deg,#FFE9B8 0%,#D4A85F 35%,#7A5926 65%,#D4A85F 100%)",
        border: "border-transparent",
        title:      "text-white",
        subtitle:   "text-white/90",
        metricLabel:"text-white/78",
        divider:    "border-white/20",
        iconBg:
          "linear-gradient(135deg," +
            "#ffffff 0%," +
            "#FFF4DC 35%," +
            "#F4E5BE 100%)",
        patternOpacity: 0.95,
        badgeBg:    "bg-gradient-to-r from-white to-[#FFF4DC]",
        badgeText:  "text-[#7A5926]",
        accent:     "#ffffff",
        noiseOpacity: 0.12,
      };
    }

    /* OBSIDIAN + GOLD — same luxury navy-gold palette for "Needs Focus",
       distinguished from LUXURY only by the red icon + red status pill. */
    return {
      key: "standard",
      label: "NEEDS FOCUS",
      bg:
        /* Same layered navy as LUXURY, but the radial tint uses a rose hint
           near top-right so the "alert" mood is subtly embedded in the finish. */
        "radial-gradient(120% 80% at 100% 0%, rgba(239,68,68,0.14) 0%, rgba(239,68,68,0) 45%)," +
        "linear-gradient(135deg," +
          "#0A1424 0%," +
          "#0F1E36 25%," +
          "#15264B 50%," +
          "#0F1E36 75%," +
          "#070D18 100%)",
      gloss:
        "linear-gradient(120deg," +
          "rgba(255,255,255,0) 0%," +
          "rgba(229,212,177,0.18) 12%," +
          "rgba(255,255,255,0) 28%)",
      ringBorder:
        "linear-gradient(135deg,#E5D4B1 0%,#C5A770 30%,#8B6D3E 60%,#C5A770 100%)",
      border: "border-transparent",
      title:      "text-white",
      subtitle:   "text-[#E5D4B1]",
      metricLabel:"text-[#C5A770]/80",
      divider:    "border-[#C5A770]/15",
      iconBg:
        /* Rose-red icon tile — retains "Needs Focus" signal against gold theme */
        "linear-gradient(135deg," +
          "#fb7185 0%," +
          "#ef4444 50%," +
          "#b91c1c 100%)",
      patternOpacity: 1,
      badgeBg:    "bg-gradient-to-r from-rose-500 to-rose-600",
      badgeText:  "text-white",
      accent:     "#C5A770",
      noiseOpacity: 0.12,
    };
  };

  /* Subtle film-grain noise to give cards a real "metal" texture (no API call — pure SVG) */
  const NOISE_SVG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'>
        <filter id='n'>
          <feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='4'/>
          <feColorMatrix values='0 0 0 0 1   0 0 0 0 1   0 0 0 0 1   0 0 0 0.6 0'/>
        </filter>
        <rect width='180' height='180' filter='url(#n)'/>
      </svg>`
    );

  /* Decorative flowing-lines SVG pattern — dense silk curves (right half of card) */
  const LINES_PATTERN =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400' fill='none' preserveAspectRatio='xMaxYMid slice'>
        <g stroke='currentColor' stroke-width='0.55' fill='none'>
          <path stroke-opacity='0.18' d='M 420 -60 C 280 40, 180 180, 360 440' />
          <path stroke-opacity='0.22' d='M 420 -40 C 290 50, 195 195, 370 440' />
          <path stroke-opacity='0.26' d='M 420 -20 C 300 60, 210 210, 380 440' />
          <path stroke-opacity='0.30' d='M 420   0 C 310 70, 225 225, 390 440' />
          <path stroke-opacity='0.34' d='M 420  20 C 320 80, 240 240, 400 440' />
          <path stroke-opacity='0.38' d='M 420  40 C 330 90, 250 250, 405 440' />
          <path stroke-opacity='0.42' d='M 420  60 C 340 100, 260 260, 410 440' />
          <path stroke-opacity='0.46' d='M 420  80 C 350 110, 270 270, 413 440' />
          <path stroke-opacity='0.50' d='M 420 100 C 355 120, 280 280, 416 440' />
          <path stroke-opacity='0.54' d='M 420 120 C 360 130, 290 290, 418 440' />
          <path stroke-opacity='0.55' d='M 420 140 C 365 140, 300 300, 420 440' />
          <path stroke-opacity='0.55' d='M 420 160 C 370 150, 310 310, 422 440' />
          <path stroke-opacity='0.54' d='M 420 180 C 375 160, 318 320, 424 440' />
          <path stroke-opacity='0.50' d='M 420 200 C 380 170, 326 330, 426 440' />
          <path stroke-opacity='0.46' d='M 420 220 C 385 180, 332 340, 428 440' />
          <path stroke-opacity='0.42' d='M 420 240 C 388 192, 338 350, 430 440' />
          <path stroke-opacity='0.38' d='M 420 260 C 390 204, 344 358, 432 440' />
          <path stroke-opacity='0.34' d='M 420 280 C 392 216, 350 366, 434 440' />
          <path stroke-opacity='0.30' d='M 420 300 C 394 228, 356 374, 436 440' />
          <path stroke-opacity='0.26' d='M 420 320 C 396 240, 362 382, 438 440' />
          <path stroke-opacity='0.22' d='M 420 340 C 398 252, 368 390, 440 440' />
        </g>
      </svg>`
    );

  const statusConfig = (status: string) => {
    if (status === "Strong")      return "bg-emerald-500";
    if (status === "Good")        return "bg-blue-500";
    return "bg-[#ef4444]";
  };

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
    const hasTrendData    = historicalTrend.some(t => t.score > 0);
    const benchmarkFiltered = benchmarkComparison.filter(row => row.branch > 0);

    // KPI cards matching screenshot: AHI, Fee Collection, Pass Rate, Active Alerts
    const kpiCards = [
      { label: "Academic Health Index", value: `${summary.ahi}%`,           note: kpiNotes.ahi,      borderColor: "border-amber-200",  bgColor: "bg-amber-50/50",  textColor: summary.ahi >= 85 ? "text-emerald-500" : summary.ahi >= 70 ? "text-amber-500" : "text-red-500" },
      { label: "Fee Collection",        value: summary.feeCollection > 0 ? `${summary.feeCollection}%` : "N/A", note: kpiNotes.fee, borderColor: "border-amber-200", bgColor: "bg-amber-50/50", textColor: summary.feeCollection >= 90 ? "text-emerald-500" : "text-amber-500" },
      { label: "Pass Rate",             value: summary.passRate > 0 ? `${summary.passRate}%` : "N/A", note: kpiNotes.passRate, borderColor: "border-amber-200", bgColor: "bg-amber-50/50", textColor: summary.passRate >= 85 ? "text-emerald-500" : "text-amber-500" },
      { label: "Active Alerts",         value: summary.activeAlerts.toString(), note: kpiNotes.alerts, borderColor: "border-red-200",  bgColor: "bg-red-50/50",    textColor: summary.activeAlerts === 0 ? "text-emerald-500" : "text-red-500" },
    ];

    // Build bright KPI tiles with gradient
    const kpiTiles = [
      { label:"Academic Health", value:`${summary.ahi}%`, sub:kpiNotes.ahi, grad: summary.ahi >= 85 ? GRAD_GREEN : summary.ahi >= 70 ? GRAD_BLUE : GRAD_RED, icon:Activity },
      { label:"Fee Collection", value:summary.feeCollection > 0 ? `${summary.feeCollection}%` : "N/A", sub:kpiNotes.fee, grad: summary.feeCollection >= 90 ? GRAD_GREEN : summary.feeCollection > 0 ? GRAD_GOLD : GRAD_BLUE, icon:CircleDollarSign },
      { label:"Pass Rate", value:summary.passRate > 0 ? `${summary.passRate}%` : "N/A", sub:kpiNotes.passRate, grad: summary.passRate >= 85 ? GRAD_GREEN : summary.passRate > 0 ? GRAD_GOLD : GRAD_BLUE, icon:GraduationCap },
      { label:"Active Alerts", value:summary.activeAlerts.toString(), sub:kpiNotes.alerts, grad: summary.activeAlerts === 0 ? GRAD_GREEN : GRAD_RED, icon:AlertTriangle },
    ];

    return (
      <>
        <DashGlobalStyles />
        <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap:24 }}>

          <button
            onClick={() => navigate("/branches")}
            className="dash-btn"
            style={{
              display:"inline-flex", alignItems:"center", gap:7, alignSelf:"flex-start",
              padding:"8px 14px", borderRadius:12,
              background:"#fff", border:"0.5px solid rgba(0,85,255,.12)",
              fontSize:11, fontWeight:700, color:T3,
              letterSpacing:"0.06em", textTransform:"uppercase",
              cursor:"pointer", boxShadow:SHADOW_SM, fontFamily:"inherit",
            }}
          >
            <ArrowLeft size={14}/> Back to Branches
          </button>

          {/* Dark Hero */}
          <div
            style={{
              background:"linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)",
              borderRadius:24, padding:"24px 28px", color:"#fff",
              position:"relative", overflow:"hidden",
              boxShadow:"0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)",
            }}
          >
            <div style={{ position:"absolute", top:-60, right:-40, width:280, height:280, background:"radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 65%)", borderRadius:"50%", pointerEvents:"none" }}/>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:20, flexWrap:"wrap", position:"relative", zIndex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                <div
                  style={{
                    width:60, height:60, borderRadius:17,
                    background:summary.color || GRAD_PRIMARY,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    boxShadow:"0 10px 28px rgba(0,0,0,.26), 0 0 0 2px rgba(255,255,255,.2)",
                    flexShrink:0,
                  }}
                >
                  <Building2 size={30} color="#fff" strokeWidth={2.2}/>
                </div>
                <div>
                  <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"3px 10px", borderRadius:999, background:"rgba(255,255,255,.14)", border:"0.5px solid rgba(255,255,255,.22)", fontSize:9, fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:8 }}>
                    <Sparkles size={10}/> Branch Profile
                  </div>
                  <h2 style={{ fontSize:30, fontWeight:800, letterSpacing:"-0.8px", margin:0, color:"#fff", lineHeight:1 }}>{summary.name}</h2>
                  <p style={{ fontSize:12, color:"rgba(255,255,255,.72)", fontWeight:500, margin:"8px 0 0 0", letterSpacing:"0.04em" }}>
                    {summary.studentCount.toLocaleString()} students
                    {summary.teacherCount > 0 && ` · ${summary.teacherCount} teachers`}
                    {summary.established !== "N/A" && ` · Est. ${summary.established}`}
                    {summary.location !== "—" && ` · ${summary.location}`}
                  </p>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                <span style={{
                  fontSize:10, fontWeight:800, padding:"8px 14px", borderRadius:10,
                  background: summary.status === "High Risk" ? GRAD_RED : summary.status === "Low Risk" ? GRAD_GREEN : GRAD_GOLD,
                  color:"#fff", letterSpacing:"0.12em", textTransform:"uppercase",
                  boxShadow:"0 4px 12px rgba(0,0,0,.24)",
                }}>
                  {summary.status}
                </span>
                <button
                  onClick={() => navigate("/reports")}
                  className="dash-btn"
                  style={{
                    display:"inline-flex", alignItems:"center", gap:6,
                    padding:"10px 18px", borderRadius:12,
                    background:"#fff", color:T1,
                    fontSize:11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                    border:"none", cursor:"pointer", fontFamily:"inherit",
                    boxShadow:"0 4px 12px rgba(0,0,0,.18)",
                  }}
                >
                  <FileText size={13}/> Generate Report
                </button>
              </div>
            </div>
          </div>

          {/* Bright KPI Grid */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:16 }}>
            {kpiTiles.map(k => (
              <StatTile key={k.label} label={k.label} value={k.value} sub={k.sub} grad={k.grad} icon={k.icon} />
            ))}
          </div>

        {/* Wrapper for remaining legacy content */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm">
          <div className="p-8 lg:p-12">

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

  const { branches, performanceRanking, comparativeTrends, efficiencyMetrics } = listData;

  // Show all ranking rows always (0 will render as short bar)
  const rankingWithData = performanceRanking;
  // Only show trends chart if any month has real attendance data
  const hasTrendsData = comparativeTrends.some(row =>
    branches.some((_, i) => (row[`b${i}`] as number) > 0)
  );

  // Compute list-view AHI avg for hero
  const listAhiAvg = branches.length > 0
    ? Math.round(branches.reduce((a, b) => a + (b.ahi || 0), 0) / branches.length)
    : 0;
  const totalAlertsList = branches.reduce((a, b) => a + (b.activeAlerts || 0), 0);
  const totalStudentsList = branches.reduce((a, b) => a + (b.studentCount || 0), 0);

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap:24 }}>

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

      <PageHead
        icon={Building2}
        title="Branches Comparison"
        subtitle="Side-by-side performance analysis"
        right={
          <button
            onClick={() => { setCrudForm(EMPTY_FORM); setAddOpen(true); }}
            className="dash-btn"
            style={{
              display:"inline-flex", alignItems:"center", gap:7,
              padding:"11px 18px", borderRadius:14,
              background:GRAD_PRIMARY, color:"#fff",
              fontSize:12, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
              border:"none", cursor:"pointer", boxShadow:SHADOW_BTN, fontFamily:"inherit",
            }}
          >
            <Plus size={15} strokeWidth={2.4}/> Add Branch
          </button>
        }
      />

      {branches.length > 0 && (
        <DarkHero
          icon={BarChart3}
          eyebrow="Branch Intelligence"
          title={`${listAhiAvg}%`}
          subtitle={`Average academic health across ${branches.length} branch${branches.length!==1?"es":""} · ${totalStudentsList.toLocaleString()} students`}
          stats={[
            { label:"Branches", value: branches.length.toString() },
            { label:"Students", value: totalStudentsList.toLocaleString() },
            { label:"Alerts",   value: totalAlertsList.toString() },
          ]}
        />
      )}

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7">
          {branches.map(b => {
            const hasData = b.ahi > 0 || b.feeCollection > 0 || b.passRate > 0 || b.attendance > 0;
            const theme   = tierTheme(b.status, hasData);
            const isDark  = theme.key === "luxury" || theme.key === "premium" || theme.key === "standard";

            /* Color for metric value text — tier-aware */
            const metricValColor = (v: number) => {
              if (!isDark) return metricColor(v);
              if (v >= 85) return "text-emerald-300";
              if (v >= 70) return theme.key === "luxury" ? "text-[#C5A770]" : "text-white";
              return "text-rose-300";
            };

            /* Tier-specific HUGE title text (top-left, like LUXURY / PREMIUM / STANDARD) */
            const tierTitleText =
              theme.key === "luxury"  ? "LUXURY"   :
              theme.key === "premium" ? "PREMIUM"  :
              theme.key === "standard"? "STANDARD" :
                                        "BRANCH";

            const tierTitleColor =
              theme.key === "luxury"  ? "text-[#C5A770]" :
              isDark                  ? "text-white"     :
                                        "text-[#1e294b]";

            /* Tier descriptive tagline — same slot as Hajj card's description */
            const tagline =
              theme.key === "luxury"  ? "Top-performing branch · highest academic health &\u00A0pass rates" :
              theme.key === "premium" ? "Well-rounded performance · healthy balance of attendance &\u00A0results" :
              theme.key === "standard"? "Needs focus · boost attendance &\u00A0results to raise tier" :
                                        "Awaiting performance data · track will appear here";

            const metrics = [
              { icon: Building2,     label: "AHI",             value: b.ahi,           has: b.ahi > 0 },
              { icon: CircleDollarSign, label: "Fee Collection", value: b.feeCollection, has: b.feeCollection > 0 },
              { icon: GraduationCap, label: "Pass Rate",       value: b.passRate,      has: b.passRate > 0 },
              { icon: CalendarCheck2,label: "Attendance",      value: b.attendance,    has: b.attendance > 0 },
            ];

            return (
              <BranchTiltCard
                key={b.id}
                onClick={() => navigate(`/branches/${b.id}`)}
                isDark={isDark}
                outerStyle={{
                  background: theme.bg,
                  /* Layered shadow:
                     ① outer drop (lift) ② tight depth ③ inner top-edge highlight
                        ④ inner bottom-edge gloom — gives the card metal-edge bevel */
                  boxShadow: isDark
                    ? [
                        "0 30px 60px -18px rgba(8,14,28,0.55)",
                        "0 12px 24px -10px rgba(0,0,0,0.30)",
                        "inset 0 1px 0 rgba(255,255,255,0.18)",
                        "inset 0 -1px 0 rgba(0,0,0,0.35)",
                      ].join(",")
                    : [
                        "0 18px 38px -14px rgba(15,23,42,0.18)",
                        "0 6px 14px -8px rgba(15,23,42,0.10)",
                        "inset 0 1px 0 rgba(255,255,255,0.85)",
                        "inset 0 -1px 0 rgba(15,23,42,0.05)",
                      ].join(","),
                  minHeight: 340,
                  /* Gradient ring border via padding-trick: inner card sits inside */
                  padding: 1.5,
                  backgroundImage: theme.ringBorder,
                }}
                outerClassName={`clickable-card relative overflow-hidden rounded-[1.75rem] border ${theme.border} group cursor-pointer`}
              >
                {/* Inner card surface — the "metal plate" itself */}
                <div
                  className="relative h-full w-full overflow-hidden rounded-[1.65rem]"
                  style={{
                    background: theme.bg,
                    transform: "translateZ(0)",
                  }}
                >

                {/* ── Layer 1: noise grain — gives real metal texture ── */}
                <div
                  className="absolute inset-0 pointer-events-none mix-blend-overlay"
                  style={{
                    backgroundImage: `url("${NOISE_SVG}")`,
                    backgroundSize: "180px 180px",
                    opacity: theme.noiseOpacity,
                  }}
                />

                {/* ── Layer 2: specular gloss highlight (the "shine") ── */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: theme.gloss }}
                />

                {/* ── Layer 3: decorative flowing silk curves ── */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    color: theme.accent,
                    backgroundImage: `url("${LINES_PATTERN}")`,
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "right -30px center",
                    backgroundSize: "70% 120%",
                    opacity: theme.patternOpacity,
                    mixBlendMode: isDark ? "screen" : "multiply",
                  }}
                />

                {/* ── Edit / Delete — appear on hover, glass/subtle depending on tier ── */}
                <div className="absolute top-5 right-5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 z-[3]">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEdit(b, b.id); }}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                      isDark
                        ? "bg-white/15 border border-white/25 hover:bg-white/25 text-white backdrop-blur"
                        : "bg-slate-50 border border-slate-100 hover:bg-blue-50 hover:border-blue-200 hover:text-[#1e3a8a] text-slate-400"
                    }`}
                    title="Edit branch"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); openDelete(b.id, b.name); }}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                      isDark
                        ? "bg-white/15 border border-white/25 hover:bg-rose-500/40 text-white backdrop-blur"
                        : "bg-slate-50 border border-slate-100 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-500 text-slate-400"
                    }`}
                    title="Delete branch"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* ── Card body — content on LEFT, decorative pattern flows on RIGHT ── */}
                <div
                  className="relative z-[2] p-7 md:p-8 flex flex-col h-full"
                  style={{ transform: "translateZ(30px)", transformStyle: "preserve-3d" }}
                >

                  {/* Big tier title — mirrors LUXURY/PREMIUM/STANDARD in ref image */}
                  <h2
                    className={`text-[32px] md:text-[40px] leading-[1.05] font-black tracking-tight ${tierTitleColor} mb-3 uppercase`}
                    style={{ letterSpacing: "-0.015em" }}
                  >
                    {tierTitleText}
                  </h2>

                  {/* Description/tagline — max two lines, like ref image */}
                  <p className={`text-[13px] leading-relaxed font-medium max-w-[85%] ${theme.subtitle} mb-7`}>
                    {tagline}
                  </p>

                  {/* Branch name + student count — compact line beneath tagline */}
                  <div className="flex items-center gap-2.5 mb-6">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-md"
                      style={{
                        background: theme.iconBg,
                        color: theme.key === "premium" ? "#A57B45" : "#ffffff",
                      }}
                    >
                      <Building2 className="w-4.5 h-4.5" strokeWidth={2.2} />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[13px] font-extrabold ${theme.title} truncate`}>{b.name}</p>
                      <p className={`text-[10px] font-bold uppercase tracking-wider ${theme.metricLabel}`}>
                        {b.studentCount.toLocaleString()} student{b.studentCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>

                  {/* 2-column feature grid — metrics as icon + label/value (Hajj card style) */}
                  <div className="grid grid-cols-2 gap-x-5 gap-y-3.5 mb-6">
                    {metrics.map(m => (
                      <div key={m.label} className="flex items-start gap-2.5">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                            isDark ? "bg-white/10 border border-white/15" : "bg-slate-50 border border-slate-100"
                          }`}
                        >
                          <m.icon className={`w-3.5 h-3.5 ${isDark ? "text-white/90" : "text-slate-500"}`} strokeWidth={2} />
                        </div>
                        <div className="min-w-0">
                          <p className={`text-[10px] font-bold uppercase tracking-wider ${theme.metricLabel} leading-tight`}>
                            {m.label}
                          </p>
                          <p className={`text-[14px] font-extrabold leading-tight mt-0.5 ${
                            m.has ? metricValColor(m.value) : (isDark ? "text-white/45" : "text-slate-400")
                          }`}>
                            {m.has ? `${m.value}%` : "N/A"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Spacer to push footer down */}
                  <div className="flex-1" />

                  {/* Footer: alerts + tier pill */}
                  <div className="flex items-center justify-between gap-3 flex-wrap mt-2">
                    {hasData ? (
                      <span
                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-[0.2em] shadow ${theme.badgeBg} ${theme.badgeText}`}
                      >
                        {b.status}
                      </span>
                    ) : (
                      <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${theme.metricLabel}`}>
                        {theme.label}
                      </span>
                    )}

                    {b.activeAlerts > 0 && (
                      <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[10px] font-bold ${
                        isDark
                          ? "bg-rose-500/15 border-rose-400/30 text-rose-200"
                          : "bg-[#fef2f2] border-rose-100 text-rose-500"
                      }`}>
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        {b.activeAlerts} at&nbsp;risk
                      </span>
                    )}
                  </div>
                </div>
                </div>{/* /inner metal plate */}
              </BranchTiltCard>
            );
          })}
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
