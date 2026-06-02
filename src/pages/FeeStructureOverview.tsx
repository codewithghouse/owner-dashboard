import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where, addDoc, doc, getDoc, serverTimestamp } from "firebase/firestore";
import { sendPrincipalNotificationEmail } from "@/lib/resend";
import {
  Download, Loader2, Building2, DollarSign, Calendar, Filter,
  ChevronDown, FileSpreadsheet, AlertCircle, TrendingUp, X, Users,
  Bell, Megaphone, Send, Layers, MessageCircle,
} from "lucide-react";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD, VIOLET,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, GRAD_RED,
  SHADOW_SM, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";
import { tilt3D, tilt3DStyle, BLUE_SHADOW } from "@/lib/use3DTilt";
import { toast } from "sonner";
// xlsx is lazy-loaded inside the Excel export handler — saves ~600KB on initial load.
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

/* ── types ──────────────────────────────────────────────── */
interface FeeRow {
  className: string;
  amounts: Record<string, number>;
}

interface StudentFeeRow {
  className: string;
  rollNo: string;
  studentName: string;
  amounts: Record<string, number>;
  discount: number;
  paid: number;
  pending: number;
  parentPhone?: string;
  parentName?: string;
}

interface FeeStructure {
  id: string;
  schoolId: string;
  branchId: string;
  branchName?: string;
  mode?: "class" | "student";
  termTypes: string[];
  rows: FeeRow[];
  studentRows?: StudentFeeRow[];
  uploadedBy?: string;
  uploadedAt?: any;
  academicYear?: string;
  notes?: string;
  isActive: boolean;
}

const currency = (n: number) => n.toLocaleString("en-IN");

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/* ══════════════════════════════════════════════════════════ */
export default function FeeStructureOverview() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const pageShellStyle = usePageShellStyle();
  const [loading, setLoading]         = useState(true);
  const [structures, setStructures]   = useState<FeeStructure[]>([]);
  const [branchMap, setBranchMap]     = useState<Map<string, string>>(new Map());
  const [branchFilter, setBranchFilter] = useState<string>("All");
  const [defaulterBranchFilter, setDefaulterBranchFilter] = useState<string>("All");
  const [viewMode, setViewMode]       = useState<"table" | "chart">("table");
  const [activeBarKey, setActiveBarKey] = useState<string | null>(null);
  const [principals, setPrincipals]   = useState<{ id: string; email: string; name: string; branchId: string; branchName?: string }[]>([]);
  // School-wide logoUrl from schools/{uid}.logoUrl (set in SettingsPage).
  // Used in the defaulter branch card header — the previous Building2
  // icon-only placeholder rendered as an empty white square in the
  // founder's screenshot (2026-05-26).
  const [ownerLogoUrl, setOwnerLogoUrl] = useState<string>("");
  // Tracks a failed logo load so we fall back to the Building2 icon
  // instead of leaving an empty white square (founder screenshot 2026-06-02).
  const [logoBroken, setLogoBroken] = useState<boolean>(false);
  const [notifyState, setNotifyState] = useState<{
    mode: "single" | "bulk";
    branchName: string;
    students: (StudentFeeRow & { branchName: string })[];
  } | null>(null);
  const [notifyMessage, setNotifyMessage] = useState<string>("");
  const [notifySending, setNotifySending] = useState(false);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }

    const load = async () => {
      try {
        /* 1. Branches */
        const bMap = new Map<string, string>();
        const bSnap = await getDocs(collection(db, "schools", uid, "branches"));
        bSnap.docs.forEach(d => {
          const data = d.data() as any;
          const bid  = data.branchId || d.id;
          const bn   = data.name || data.branchName || "";
          if (bid && bn) bMap.set(bid, bn);
        });
        setBranchMap(bMap);

        /* 2. All fee_structure docs for this school */
        const fSnap = await getDocs(
          query(
            collection(db, "fee_structure"),
            where("schoolId", "==", uid),
            where("isActive", "==", true),
          )
        );
        const list: FeeStructure[] = fSnap.docs.map(d => {
          const data = d.data() as any;
          return {
            id: d.id,
            ...data,
            branchName: data.branchName || bMap.get(data.branchId) || "Unknown Branch",
          };
        });
        setStructures(list);

        /* 3. Principals for this school (for notify targeting) */
        const pSnap = await getDocs(
          query(collection(db, "principals"), where("schoolId", "==", uid))
        );
        const pList = pSnap.docs.map(d => {
          const data = d.data() as any;
          return {
            id: d.id,
            email: (data.email || "").toLowerCase(),
            name: data.name || "",
            branchId: data.branchId || "",
            branchName: data.branchName || bMap.get(data.branchId) || "",
          };
        });
        setPrincipals(pList);

        /* 4. School logoUrl for the defaulter-card header avatar */
        try {
          const sSnap = await getDoc(doc(db, "schools", uid));
          const sData = sSnap.exists() ? (sSnap.data() as any) : null;
          if (sData?.logoUrl) setOwnerLogoUrl(sData.logoUrl as string);
        } catch (e) {
          console.warn("[FeeStructureOverview] logo fetch failed:", e);
        }
      } catch (e) {
        console.error("[FeeStructureOverview] load error:", e);
      }
      setLoading(false);
    };
    load();
  }, []);

  /* ── resolve principal for a branch (by branchName first, then branchId) ── */
  const principalForBranch = (branchName: string) => {
    return (
      principals.find(p => (p.branchName || "").toLowerCase() === branchName.toLowerCase()) ||
      principals.find(p => p.branchId && p.branchId.toLowerCase() === branchName.toLowerCase()) ||
      null
    );
  };

  /* ── Send msg to parent — writes a principal_to_parent_notes doc directly
   * addressed to the defaulter's parent. Looks up the student in the
   * `students` collection (scoped by branchId + name + className) to get
   * studentId + studentEmail, which the parent dashboard's reader requires
   * via the dual-query pattern. The note appears in the parent's Principal
   * Notes feed instantly via the real-time listener there.
   *
   * Per-row sending state keeps the spinner local to the clicked button so
   * the rest of the table stays responsive.
   */
  const [msgSendingKey, setMsgSendingKey] = useState<string | null>(null);
  const handleSendMsgToParent = async (
    branchName: string,
    d: StudentFeeRow & { branchName: string },
  ) => {
    const rowKey = `${branchName}::${d.studentName}::${d.className}::${d.rollNo || ""}`;
    if (msgSendingKey) return;
    const uid = auth.currentUser?.uid;
    if (!uid) { toast.error("Not authenticated"); return; }
    const principal = principalForBranch(branchName);
    if (!principal) {
      toast.error(`No principal assigned to "${branchName}". Assign one in Principal Management first.`);
      return;
    }
    setMsgSendingKey(rowKey);
    try {
      // Resolve the student doc — need studentId + studentEmail so the
      // parent's dual-key reader matches. Scope by branchId to avoid
      // cross-branch collisions on common names.
      const branchId = principal.branchId || "";
      const studentsQ = branchId
        ? query(
            collection(db, "students"),
            where("schoolId", "==", uid),
            where("branchId", "==", branchId),
          )
        : query(collection(db, "students"), where("schoolId", "==", uid));
      const sSnap = await getDocs(studentsQ);
      const target = sSnap.docs.find(sd => {
        const data = sd.data() as any;
        const nameMatch = (data.name || "").toString().toLowerCase().trim() === d.studentName.toLowerCase().trim();
        const classMatch = !d.className || (data.className || "").toString().toLowerCase().trim() === d.className.toLowerCase().trim();
        return nameMatch && classMatch;
      }) || sSnap.docs.find(sd => {
        // Fallback — name-only match if className didn't line up.
        const data = sd.data() as any;
        return (data.name || "").toString().toLowerCase().trim() === d.studentName.toLowerCase().trim();
      });

      const studentId    = target?.id || "";
      const studentEmail = ((target?.data() as any)?.email || "").toString().toLowerCase().trim();
      const parentName   = (d.parentName || (target?.data() as any)?.parentName || "Parent").toString();

      if (!studentId && !studentEmail) {
        toast.error(`Couldn't find a student record for ${d.studentName}. Check Students Intelligence first.`);
        return;
      }

      // Compose a polite-but-firm fee reminder. Includes the headline numbers
      // and a clear ask. The parent sees this in their Principal Notes tab as
      // a normal principal message.
      const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const message =
        `Dear Parent,\n\n` +
        `This is a friendly reminder that the school fees for ${d.studentName}` +
        `${d.className ? ` (Class ${d.className}${d.rollNo ? `, Roll ${d.rollNo}` : ""})` : ""} ` +
        `are currently overdue.\n\n` +
        `Pending balance: ₹ ${currency(d.pending)}\n` +
        `Paid till date: ₹ ${currency(d.paid)}\n` +
        `As on: ${today}\n\n` +
        `Please clear the pending amount at your earliest convenience or contact the school office if you need help with a payment plan.\n\n` +
        `— Principal, ${branchName}`;

      await addDoc(collection(db, "principal_to_parent_notes"), {
        // Identity / addressing
        principalId:   principal.id,
        principalName: principal.name || "Principal",
        studentId:     studentId || "",
        studentEmail:  studentEmail || "",
        studentName:   d.studentName,
        parentName,
        className:     d.className || "",
        schoolId:      uid,
        branchId,
        // Payload
        subject: "Fee Reminder",
        message,
        from: "principal",
        timestamp: serverTimestamp(),
        read: false,
        // Provenance — useful when auditing who triggered the auto-message
        source: "owner_fee_defaulter_quick_send",
        triggeredByOwnerUid: uid,
      });

      toast.success(`Fee reminder sent to ${parentName} (${d.studentName}'s parent).`);
    } catch (err: any) {
      console.error("[FeeStructure] send-msg-to-parent failed", err);
      toast.error("Couldn't send message. Please try again.");
    } finally {
      setMsgSendingKey(null);
    }
  };

  /* ── open notify modal (single or bulk) ─────────────────── */
  const openNotify = (
    mode: "single" | "bulk",
    branchName: string,
    students: (StudentFeeRow & { branchName: string })[],
  ) => {
    const principal = principalForBranch(branchName);
    if (!principal) {
      toast.error(`No principal assigned to "${branchName}". Assign one in Principal Management first.`);
      return;
    }
    const totalPending = students.reduce((a, b) => a + b.pending, 0);
    const defaultMsg = mode === "single"
      ? `ACTION REQUIRED — FEE DEFAULTER ALERT\n\n${students[0].studentName} (${students[0].className}${students[0].rollNo ? `, Roll ${students[0].rollNo}` : ""}) has ₹ ${currency(students[0].pending)} pending as of ${new Date().toLocaleDateString("en-IN")}.\n\nPlease contact the parent within 48 hours, document your outreach, and report the outcome. Failure to respond will be recorded.\n\n— Owner Office`
      : `ACTION REQUIRED — BRANCH-WIDE FEE DEFAULTER REVIEW\n\n${branchName} currently has ${students.length} fee defaulter(s) with a combined pending balance of ₹ ${currency(totalPending)} as of ${new Date().toLocaleDateString("en-IN")}.\n\nYou are required to:\n1. Review the full list below.\n2. Contact each defaulting parent within 72 hours.\n3. Submit a status report to the owner office.\n\nFailure to respond will be recorded in your performance review.\n\n— Owner Office`;
    setNotifyMessage(defaultMsg);
    setNotifyState({ mode, branchName, students });
  };

  const sendNotify = async () => {
    if (!notifyState) return;
    const uid = auth.currentUser?.uid;
    if (!uid) { toast.error("Not authenticated"); return; }
    const principal = principalForBranch(notifyState.branchName);
    if (!principal) { toast.error("Principal not found"); return; }
    if (!notifyMessage.trim()) { toast.error("Message cannot be empty"); return; }

    setNotifySending(true);
    try {
      const totalPending = notifyState.students.reduce((a, b) => a + b.pending, 0);
      const totalPaid    = notifyState.students.reduce((a, b) => a + b.paid, 0);
      const subject = notifyState.mode === "single"
        ? `Fee Defaulter Alert — ${notifyState.students[0].studentName}`
        : `Branch Fee Defaulters — ${notifyState.branchName} (${notifyState.students.length} students)`;

      await addDoc(collection(db, "owner_to_principal_notes"), {
        schoolId: uid,
        ownerUid: uid,
        principalId: principal.id,
        principalEmail: principal.email,
        principalName: principal.name,
        branchId: principal.branchId,
        branchName: notifyState.branchName,
        type: notifyState.mode === "single" ? "fee_defaulter" : "fee_defaulter_bulk",
        subject,
        message: notifyMessage,
        content: notifyMessage,
        students: notifyState.students.map(s => ({
          rollNo: s.rollNo || "",
          studentName: s.studentName,
          className: s.className,
          paid: s.paid,
          pending: s.pending,
        })),
        totalPending,
        totalPaid,
        studentCount: notifyState.students.length,
        status: "unread",
        createdAt: serverTimestamp(),
        _lastModifiedAt: serverTimestamp(),
        _lastModifiedBy: uid,
      });

      toast.success(
        notifyState.mode === "single"
          ? `Notified ${principal.name || principal.email} for ${notifyState.students[0].studentName}`
          : `Notified ${principal.name || principal.email} — ${notifyState.students.length} defaulters in ${notifyState.branchName}`
      );
      setNotifyState(null);
      setNotifyMessage("");

      /* Fire-and-forget email — principal gets the same notification via
         BOTH dashboard inbox AND email. Done AFTER the modal closes so
         email-network latency doesn't block the UI. Failures show a
         secondary toast but don't roll back the in-app notification —
         dashboard delivery already succeeded, that's the source of truth.
         School name fetched at notify-time (single doc read) instead of
         being kept in state — avoids a separate page-load read every
         time the page mounts. */
      (async () => {
        if (!principal.email) {
          toast.warning("Notification saved — but principal has no email on file. Email skipped.");
          return;
        }
        let schoolName = "your school";
        try {
          const sSnap = await getDoc(doc(db, "schools", uid));
          if (sSnap.exists()) {
            const sd = sSnap.data() as any;
            schoolName = sd.schoolName || sd.name || schoolName;
          }
        } catch { /* fall back to default — non-critical */ }

        const emailRes = await sendPrincipalNotificationEmail({
          to:      principal.email,
          subject,
          body:    notifyMessage,
          schoolName,
        });
        if (!emailRes.success) {
          toast.warning(`Saved to dashboard, but email delivery failed (${emailRes.error}).`);
        } else {
          toast.success(`Email also delivered to ${principal.email}`);
        }
      })();
    } catch (e: any) {
      console.error("[FeeStructureOverview] notify error:", e);
      toast.error(e.message || "Failed to send notification");
    } finally {
      setNotifySending(false);
    }
  };

  /* ── filtered list ──────────────────────────────────── */
  const filtered = useMemo(() =>
    branchFilter === "All"
      ? structures
      : structures.filter(s => s.branchName === branchFilter),
    [structures, branchFilter]
  );

  /* ── union of all term types across all branches ─────── */
  const allTerms = useMemo(() => {
    const set = new Set<string>();
    structures.forEach(s => s.termTypes.forEach(t => set.add(t)));
    return [...set];
  }, [structures]);

  /* ── branch totals (for stat cards + chart) ──────────── */
  const branchTotals = useMemo(() =>
    filtered.map(s => {
      const total = s.rows.reduce((sum, r) =>
        sum + s.termTypes.reduce((t, term) => t + (r.amounts[term] || 0), 0), 0);
      return { branchId: s.branchId, branchName: s.branchName || "—", total, rowCount: s.rows.length };
    }),
    [filtered]
  );

  const grandTotal = branchTotals.reduce((a, b) => a + b.total, 0);
  const totalClasses = branchTotals.reduce((a, b) => a + b.rowCount, 0);

  /* ── student-level aggregate (only for branches in student mode) ─────── */
  const studentAgg = useMemo(() => {
    let totalStudents = 0, totalPaid = 0, totalPending = 0, defaulters = 0;
    const defaulterList: (StudentFeeRow & { branchName: string })[] = [];
    filtered.forEach(s => {
      if (!s.studentRows) return;
      s.studentRows.forEach(st => {
        totalStudents++;
        totalPaid    += st.paid;
        totalPending += st.pending;
        if (st.pending > 0) {
          defaulters++;
          defaulterList.push({ ...st, branchName: s.branchName || "—" });
        }
      });
    });
    defaulterList.sort((a, b) => b.pending - a.pending);
    return { totalStudents, totalPaid, totalPending, defaulters, defaulterList };
  }, [filtered]);
  const hasStudentData = studentAgg.totalStudents > 0;

  /* ── defaulters grouped by branch ─────────────────────── */
  const defaultersByBranch = useMemo(() => {
    const map = new Map<string, (StudentFeeRow & { branchName: string })[]>();
    studentAgg.defaulterList.forEach(d => {
      const key = d.branchName || "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    });
    return [...map.entries()]
      .map(([branchName, list]) => ({
        branchName,
        list,
        count: list.length,
        pending: list.reduce((a, b) => a + b.pending, 0),
        paid: list.reduce((a, b) => a + b.paid, 0),
      }))
      .sort((a, b) => b.pending - a.pending);
  }, [studentAgg.defaulterList]);

  /* ── chart data: term vs branch amount ────────────────── */
  const chartData = useMemo(() => {
    /* For each branch, sum by term */
    return filtered.map(s => {
      const row: any = { branch: s.branchName };
      s.termTypes.forEach(term => {
        row[term] = s.rows.reduce((sum, r) => sum + (r.amounts[term] || 0), 0);
      });
      return row;
    });
  }, [filtered]);

  /* ── export combined Excel ─────────────────────────────── */
  const exportCombined = async () => {
    const XLSX = await import("xlsx");
    const safe = (n: string) => (n || "Sheet").replace(/[\\/*?:[\]]/g, "_").slice(0, 31);
    const wb = XLSX.utils.book_new();

    filtered.forEach(s => {
      const branchSafe = safe(s.branchName || "Branch");

      /* Always include a class-level aggregate sheet */
      const aoa = s.rows.map(r => {
        const row: any = { Class: r.className };
        s.termTypes.forEach(t => { row[t] = r.amounts[t] || 0; });
        row["Total"] = s.termTypes.reduce((a, t) => a + (r.amounts[t] || 0), 0);
        return row;
      });
      const wsAgg = XLSX.utils.json_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, wsAgg, branchSafe);

      /* If student-level data exists, add one sheet per class */
      if (s.studentRows && s.studentRows.length > 0) {
        const byClass = new Map<string, StudentFeeRow[]>();
        s.studentRows.forEach(st => {
          if (!byClass.has(st.className)) byClass.set(st.className, []);
          byClass.get(st.className)!.push(st);
        });
        [...byClass.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([className, list]) => {
          const rows = list.map(st => {
            const row: any = { "Roll No": st.rollNo, "Student Name": st.studentName };
            s.termTypes.forEach(t => { row[t] = st.amounts[t] || 0; });
            row["Discount"] = st.discount;
            row["Paid"]     = st.paid;
            row["Pending"]  = st.pending;
            return row;
          });
          const ws = XLSX.utils.json_to_sheet(rows);
          /* Prefix sheet name with branch short-code so sheet names remain unique */
          const prefix = branchSafe.slice(0, 6);
          XLSX.utils.book_append_sheet(wb, ws, safe(`${prefix}-${className}`));
        });
      }
    });
    XLSX.writeFile(wb, "fee_structures_all_branches.xlsx");
  };

  /* ─────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={{ ...pageShellStyle, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <Loader2 className="animate-spin" size={32} color={B1}/>
      </div>
    );
  }

  /* Branch options come from the canonical `branches` subcollection (already
     loaded into branchMap). Sourcing from `structures` would silently hide
     branches that haven't uploaded a fee structure yet — the Owner couldn't
     even tell from this page that a new branch exists, which is misleading
     for decisions about which branches need attention. */
  const branchOptions = ["All", ...[...branchMap.values()].filter(Boolean).sort()];
  const chartColors = [B1, GREEN, GOLD, RED, VIOLET, "#14b8a6", "#f97316", "#ec4899"];

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 16 : 24 }}>

      <PageHead
        icon={DollarSign}
        title="Fee Structure"
        subtitle="Branch-wise fee plans uploaded by principals & DEOs"
        right={
          structures.length > 0 ? (
            <button
              onClick={exportCombined}
              className="dash-btn"
              style={{
                display:"inline-flex", alignItems:"center", justifyContent:"center", gap: isMobile ? 6 : 7,
                padding: isMobile ? "9px 12px" : "10px 16px", borderRadius: isMobile ? 10 : 12,
                background:GRAD_PRIMARY, color:"#fff",
                fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                border:"none", cursor:"pointer", boxShadow:SHADOW_BTN, fontFamily:"inherit",
                whiteSpace:"nowrap",
              }}
            >
              <Download size={isMobile ? 12 : 13}/> {isMobile ? "Export" : "Export All"}
            </button>
          ) : null
        }
      />

      {structures.length === 0 ? (
        <div
          style={{
            background:"#fff", borderRadius: isMobile ? 18 : 22, padding: isMobile ? "32px 20px" : "48px 32px",
            border:"0.5px solid rgba(0,85,255,.08)", boxShadow:SHADOW_SM,
            display:"flex", flexDirection:"column", alignItems:"center", gap: isMobile ? 12 : 16, textAlign:"center",
          }}
        >
          <div style={{ width: isMobile ? 60 : 72, height: isMobile ? 60 : 72, borderRadius: isMobile ? 16 : 20, background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <FileSpreadsheet size={isMobile ? 28 : 34} color={T4}/>
          </div>
          <div>
            <h3 style={{ fontSize: isMobile ? 14 : 16, fontWeight:800, color:T1, margin:"0 0 6px 0", letterSpacing:"-0.3px" }}>No fee structures published yet</h3>
            <p style={{ fontSize: isMobile ? 12 : 13, fontWeight:500, color:T3, margin:0, maxWidth:420, lineHeight:1.5 }}>
              Ask your principal or DEO to upload the class-wise fee Excel from the Principal Dashboard → Fee Structure page.
            </p>
          </div>
        </div>
      ) : (
        <>
          <DarkHero
            icon={DollarSign}
            eyebrow="Fee Planner"
            title={`₹${currency(grandTotal)}`}
            subtitle={`Combined annual across ${branchTotals.length} branch${branchTotals.length!==1?"es":""} · ${totalClasses} classes · ${allTerms.length} term type${allTerms.length!==1?"s":""}`}
            stats={[
              { label:"Branches", value:branchTotals.length.toString() },
              { label:"Classes",  value:totalClasses.toString() },
              { label:"Terms",    value:allTerms.length.toString() },
            ]}
          />

          {/* Bright Stat Grid */}
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16 }}>
            <StatTile label="Branches"        value={branchTotals.length.toString()} sub="Active"             grad={GRAD_BLUE}   icon={Building2} onClick={()=>navigate("/fee-structure")} />
            <StatTile label="Total Classes"   value={totalClasses.toString()}        sub="Across branches"    grad={GRAD_VIOLET} icon={Calendar}  onClick={()=>navigate("/fee-structure")} />
            <StatTile label="Total Terms"     value={allTerms.length.toString()}     sub="Term types"         grad={GRAD_GOLD}   icon={Layers}    onClick={()=>navigate("/fee-structure")} />
            <StatTile label="Combined Annual" value={`₹${currency(grandTotal)}`}     sub="All branches"       grad={GRAD_GREEN}  icon={DollarSign} onClick={()=>navigate("/fee-structure")} />
          </div>

          {/* Student-level aggregates */}
          {hasStudentData && (
            <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16 }}>
              <StatTile label="Total Students" value={studentAgg.totalStudents.toString()}              sub="Enrolled in plans"   grad={GRAD_VIOLET} icon={Users}       onClick={()=>navigate("/finance")} />
              <StatTile label="Fees Collected" value={`₹${currency(studentAgg.totalPaid)}`}             sub="Paid to date"        grad={GRAD_GREEN}  icon={DollarSign}  onClick={()=>navigate("/finance")} />
              <StatTile label="Fees Pending"   value={`₹${currency(studentAgg.totalPending)}`}          sub="Outstanding"         grad={GRAD_RED}    icon={AlertCircle} onClick={()=>navigate("/finance")} />
              <StatTile label="Defaulters"     value={studentAgg.defaulters.toString()}                 sub="Need follow-up"      grad={studentAgg.defaulters > 0 ? GRAD_RED : GRAD_GOLD} icon={TrendingUp} onClick={()=>navigate("/finance")} />
            </div>
          )}

          {/* Defaulters grouped branch-wise */}
          {hasStudentData && studentAgg.defaulterList.length > 0 && (
            <div className="space-y-3 md:space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 md:gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-red-600 flex items-center justify-center shrink-0">
                    <AlertCircle className="w-4 h-4 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[13px] md:text-sm font-extrabold text-red-900">Defaulters by Branch</h3>
                    <p className="text-[10px] md:text-[11px] text-red-700 font-semibold leading-snug">
                      {studentAgg.defaulterList.length} students · ₹ {currency(studentAgg.totalPending)} pending · {defaultersByBranch.length} branch(es)
                    </p>
                  </div>
                </div>
                <div className="relative w-full sm:w-56">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-400 pointer-events-none" />
                  <select
                    value={defaulterBranchFilter}
                    onChange={e => setDefaulterBranchFilter(e.target.value)}
                    className="w-full appearance-none border border-red-200 rounded-xl pl-9 pr-10 py-2 text-xs font-bold text-red-700 bg-white outline-none focus:ring-2 focus:ring-red-200"
                  >
                    <option value="All">All Branches</option>
                    {defaultersByBranch.map(g => (
                      <option key={g.branchName} value={g.branchName}>{g.branchName}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-red-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {defaultersByBranch
                .filter(g => defaulterBranchFilter === "All" || g.branchName === defaulterBranchFilter)
                .map(group => (
                <div key={group.branchName} {...tilt3D} className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
                  <div className="px-3 md:px-5 py-3 md:py-3.5 border-b border-red-100 bg-gradient-to-r from-red-50 to-orange-50 flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-2.5 md:gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-white border border-red-200 flex items-center justify-center shrink-0 overflow-hidden">
                        {ownerLogoUrl && !logoBroken ? (
                          <img
                            src={ownerLogoUrl}
                            alt="School logo"
                            className="w-full h-full object-cover"
                            onError={() => setLogoBroken(true)}
                          />
                        ) : (
                          <Building2 className="w-4 h-4 text-red-600" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-[13px] md:text-sm font-extrabold text-[#1e294b] truncate">{group.branchName}</h4>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          {group.count} defaulter{group.count !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 md:gap-4 flex-wrap">
                      <div className="text-left sm:text-right">
                        <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Paid</p>
                        <p className="text-xs md:text-sm font-extrabold text-emerald-600">₹ {currency(group.paid)}</p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-[9px] font-black text-red-600 uppercase tracking-widest">Pending</p>
                        <p className="text-xs md:text-sm font-extrabold text-red-600">₹ {currency(group.pending)}</p>
                      </div>
                      <button
                        onClick={() => openNotify("bulk", group.branchName, group.list)}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 text-white text-[10px] font-black uppercase tracking-wider hover:bg-red-700 transition-all shadow-sm w-full sm:w-auto"
                        title="Notify principal about all defaulters in this branch"
                      >
                        <Megaphone className="w-3.5 h-3.5" /> {isMobile ? "Notify All" : "Notify Principal"}
                      </button>
                    </div>
                  </div>

                  {isMobile ? (
                    <div className="flex flex-col gap-2 p-3 max-h-[420px] overflow-y-auto">
                      {group.list.slice(0, 50).map((d, i) => (
                        <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/40 p-3">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-extrabold text-[#1e294b] truncate">{d.studentName}</p>
                              <p className="text-[10px] font-semibold text-slate-500 truncate">
                                {d.className}{d.rollNo ? ` · Roll ${d.rollNo}` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => openNotify("single", group.branchName, [d])}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-[10px] font-bold uppercase tracking-wider transition-all"
                                title="Notify principal"
                              >
                                <Bell className="w-3 h-3" /> Notify
                              </button>
                              <button
                                onClick={() => {
                                  const principal = principalForBranch(group.branchName);
                                  if (!principal) {
                                    toast.error(`No principal assigned to "${group.branchName}". Assign one in Principal Management first.`);
                                    return;
                                  }
                                  navigate(`/principal-notes?principal=${encodeURIComponent(principal.id)}`);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-[10px] font-bold uppercase tracking-wider transition-all"
                                title="Open the principal's notes thread for this branch"
                              >
                                <MessageCircle className="w-3 h-3" />
                                Send msg
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-1.5">
                              <p className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">Paid</p>
                              <p className="text-[12px] font-extrabold text-emerald-700">₹ {currency(d.paid)}</p>
                            </div>
                            <div className="rounded-lg bg-red-50 border border-red-100 px-2.5 py-1.5">
                              <p className="text-[8px] font-black text-red-600 uppercase tracking-widest">Pending</p>
                              <p className="text-[12px] font-extrabold text-red-700">₹ {currency(d.pending)}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                      {group.list.length > 50 && (
                        <p className="text-[10px] text-slate-400 text-center py-1 font-semibold">
                          Showing top 50 of {group.list.length}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                      <table className="w-full text-left min-w-[600px]">
                        <thead className="bg-slate-50 sticky top-0 z-10 shadow-[0_1px_0_0_rgb(226_232_240)]">
                          <tr>
                            <th className="py-3 px-5 text-left text-[9px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">Class</th>
                            <th className="py-3 px-5 text-left text-[9px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">Roll</th>
                            <th className="py-3 px-5 text-left text-[9px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">Student</th>
                            <th className="py-3 px-5 text-left text-[9px] font-black text-emerald-600 uppercase tracking-widest whitespace-nowrap">Paid</th>
                            <th className="py-3 px-5 text-left text-[9px] font-black text-red-600 uppercase tracking-widest whitespace-nowrap">Pending</th>
                            <th className="py-3 px-5 text-right text-[9px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {group.list.slice(0, 50).map((d, i) => (
                            <tr key={i} className="hover:bg-slate-50/40">
                              <td className="py-2.5 px-5 text-xs font-semibold text-slate-600">{d.className}</td>
                              <td className="py-2.5 px-5 text-xs font-bold text-slate-600">{d.rollNo || "—"}</td>
                              <td className="py-2.5 px-5 text-sm font-bold text-[#1e294b]">{d.studentName}</td>
                              <td className="py-2.5 px-5 text-xs font-extrabold text-emerald-600">₹ {currency(d.paid)}</td>
                              <td className="py-2.5 px-5 text-xs font-extrabold text-red-600">₹ {currency(d.pending)}</td>
                              <td className="py-2.5 px-5 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    onClick={() => openNotify("single", group.branchName, [d])}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-[10px] font-bold uppercase tracking-wider transition-all"
                                    title="Notify principal about this defaulter"
                                  >
                                    <Bell className="w-3 h-3" /> Notify
                                  </button>
                                  <button
                                    onClick={() => {
                                      const principal = principalForBranch(group.branchName);
                                      if (!principal) {
                                        toast.error(`No principal assigned to "${group.branchName}". Assign one in Principal Management first.`);
                                        return;
                                      }
                                      navigate(`/principal-notes?principal=${encodeURIComponent(principal.id)}`);
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-[10px] font-bold uppercase tracking-wider transition-all"
                                    title="Open the principal's notes thread for this branch"
                                  >
                                    <MessageCircle className="w-3 h-3" />
                                    Send msg
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {group.list.length > 50 && (
                        <p className="text-[10px] text-slate-400 text-center py-2 font-semibold">
                          Showing top 50 of {group.list.length} defaulters in this branch
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Filters + view toggle */}
          <div {...tilt3D} className="bg-white rounded-2xl p-3 md:p-4 flex flex-col md:flex-row md:items-center gap-2.5 md:gap-3" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Filter</span>
            </div>
            <div className="relative flex-1 md:max-w-xs">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <select
                value={branchFilter}
                onChange={e => setBranchFilter(e.target.value)}
                className="w-full appearance-none border border-slate-200 rounded-xl pl-9 pr-10 py-2 text-xs font-bold text-slate-600 bg-slate-50 outline-none focus:ring-2 focus:ring-[#1e3a8a]/10"
              >
                {branchOptions.map(b => (
                  <option key={b} value={b}>{b === "All" ? "All Branches" : b}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <div className="flex items-center gap-2 md:ml-auto">
              {branchFilter !== "All" && (
                <button
                  onClick={() => setBranchFilter("All")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-wider transition-all"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
              <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 ml-auto">
                <button
                  onClick={() => setViewMode("table")}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                    viewMode === "table" ? "bg-white text-[#1e3a8a] shadow-sm" : "text-slate-500"
                  }`}
                >
                  Table
                </button>
                <button
                  onClick={() => setViewMode("chart")}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                    viewMode === "chart" ? "bg-white text-[#1e3a8a] shadow-sm" : "text-slate-500"
                  }`}
                >
                  Chart
                </button>
              </div>
            </div>
          </div>

          {/* Chart view — term-wise by branch */}
          {viewMode === "chart" && (
            <div {...tilt3D} className="bg-white rounded-2xl p-4 md:p-6" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
              <h3 className="text-[13px] md:text-sm font-extrabold text-[#1e294b] mb-3 md:mb-4">Fee Breakdown by Branch & Term</h3>
              {chartData.length === 0 ? (
                <div className="h-60 md:h-80 flex items-center justify-center text-xs md:text-sm text-slate-400 font-semibold">No branches match filter</div>
              ) : (
                <div className="h-[280px] md:h-[380px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: isMobile ? 5 : 20, left: isMobile ? -20 : -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="branch" tick={{ fill: "#64748b", fontSize: isMobile ? 9 : 11, fontWeight: 600 }} interval={0} angle={isMobile ? -20 : 0} textAnchor={isMobile ? "end" : "middle"} height={isMobile ? 50 : 30} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: isMobile ? 9 : 11 }}
                        tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                      <Tooltip
                        cursor={false}
                        content={({ active, payload, label }) => {
                          if (!active || !payload || payload.length === 0 || !activeBarKey) return null;
                          const entry = payload.find((p: any) => p.dataKey === activeBarKey);
                          if (!entry) return null;
                          const value = Number(entry.value || 0);
                          return (
                            <div style={{
                              background: "#ffffff",
                              borderRadius: 12,
                              boxShadow: "0 10px 15px rgba(0,0,0,0.1)",
                              padding: "8px 12px",
                              fontSize: isMobile ? 11 : 12,
                              fontWeight: 700,
                              color: "#1e294b",
                            }}>
                              <div style={{ fontWeight: 800, marginBottom: 2 }}>{String(label)}</div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{
                                  display: "inline-block",
                                  width: 10,
                                  height: 10,
                                  borderRadius: 2,
                                  background: (entry as any).color || (entry as any).fill || "#1e3a8a",
                                }} />
                                <span style={{ fontWeight: 600, color: "#64748b" }}>{String(entry.dataKey)}:</span>
                                <span style={{ fontWeight: 800 }}>{`₹ ${currency(value)}`}</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: isMobile ? "9px" : "10px", fontWeight: 700, paddingTop: "8px" }} />
                      {allTerms.map((t, i) => (
                        <Bar
                          key={t}
                          dataKey={t}
                          fill={chartColors[i % chartColors.length]}
                          radius={[4,4,0,0]}
                          onMouseEnter={() => setActiveBarKey(t)}
                          onMouseLeave={() => setActiveBarKey(null)}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Table view — one card per branch */}
          {viewMode === "table" && (
            <div className="space-y-3 md:space-y-4">
              {filtered.length === 0 ? (
                <div className="bg-white rounded-2xl p-6 md:p-8 text-center text-xs md:text-sm text-slate-400 font-semibold" style={{ boxShadow: BLUE_SHADOW }}>
                  No branches match the filter
                </div>
              ) : filtered.map(s => {
                const perTermTotal: Record<string, number> = {};
                s.termTypes.forEach(t => {
                  perTermTotal[t] = s.rows.reduce((sum, r) => sum + (r.amounts[t] || 0), 0);
                });
                const branchTotal = Object.values(perTermTotal).reduce((a, b) => a + b, 0);
                const ts = toDate(s.uploadedAt);
                return (
                  <div key={s.id} {...tilt3D} className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: BLUE_SHADOW, ...tilt3DStyle }}>
                    <div className="px-3 md:px-5 py-3 md:py-4 border-b border-slate-100 flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2.5 md:gap-3 min-w-0">
                        <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-[#1e3a8a] flex items-center justify-center shrink-0">
                          <Building2 className="w-4 h-4 md:w-5 md:h-5 text-white" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm md:text-base font-extrabold text-[#1e294b] truncate">{s.branchName}</h3>
                            {/* Academic Year — promoted from inline text to a vivid chip
                                so the value Principal entered on the upload form is
                                immediately visible at the top of the card. */}
                            {s.academicYear && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-[10px] md:text-[11px] font-extrabold text-emerald-700 tracking-wide whitespace-nowrap">
                                AY {s.academicYear}
                              </span>
                            )}
                          </div>
                          <p className="text-[9px] md:text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-1">
                            {s.rows.length} classes · {s.termTypes.length} terms
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs md:text-sm font-black text-emerald-600">₹ {currency(branchTotal)}</div>
                        <p className="text-[9px] md:text-[10px] font-semibold text-slate-400 mt-0.5">
                          {ts ? `${isMobile ? "Upd" : "Updated"} ${ts.toLocaleDateString("en-IN")}` : "—"}
                        </p>
                      </div>
                    </div>

                    {s.notes && (
                      <div className="px-3 md:px-5 py-2.5 bg-amber-50/50 border-b border-amber-100 flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-[8px] md:text-[9px] font-extrabold text-amber-600 uppercase tracking-widest">Notes</p>
                          <p className="text-[11px] md:text-[12px] text-amber-700 font-semibold mt-0.5 leading-snug">{s.notes}</p>
                        </div>
                      </div>
                    )}

                    {isMobile ? (
                      <div className="flex flex-col gap-2 p-3">
                        {s.rows.map((r, i) => {
                          const rowTotal = s.termTypes.reduce((a, t) => a + (r.amounts[t] || 0), 0);
                          return (
                            <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/40 p-3">
                              <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100">
                                <p className="text-sm font-extrabold text-[#1e294b] truncate">{r.className}</p>
                                <p className="text-sm font-extrabold text-[#1e3a8a] whitespace-nowrap">₹ {currency(rowTotal)}</p>
                              </div>
                              <div className="grid grid-cols-2 gap-1.5">
                                {s.termTypes.map(t => (
                                  <div key={t} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-white border border-slate-100">
                                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest truncate">{t}</span>
                                    <span className="text-[11px] font-bold text-slate-700 whitespace-nowrap">₹ {currency(r.amounts[t] || 0)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        <div className="rounded-xl bg-blue-50 border-2 border-[#1e3a8a]/15 p-3 mt-1">
                          <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-[#1e3a8a]/10">
                            <p className="text-[11px] font-black text-[#1e3a8a] uppercase tracking-wider">Branch Total</p>
                            <p className="text-sm font-extrabold text-[#1e3a8a] whitespace-nowrap">₹ {currency(branchTotal)}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {s.termTypes.map(t => (
                              <div key={t} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-white">
                                <span className="text-[9px] font-black text-[#1e3a8a] uppercase tracking-widest truncate">{t}</span>
                                <span className="text-[11px] font-extrabold text-[#1e3a8a] whitespace-nowrap">₹ {currency(perTermTotal[t] || 0)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left min-w-[500px]">
                          <thead className="bg-slate-50/60">
                            <tr>
                              <th className="py-3 px-5 text-[9px] font-black text-slate-500 uppercase tracking-widest">Class</th>
                              {s.termTypes.map(t => (
                                <th key={t} className="py-3 px-5 text-[9px] font-black text-slate-500 uppercase tracking-widest">{t}</th>
                              ))}
                              <th className="py-3 px-5 text-[9px] font-black text-[#1e3a8a] uppercase tracking-widest">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {s.rows.map((r, i) => {
                              const rowTotal = s.termTypes.reduce((a, t) => a + (r.amounts[t] || 0), 0);
                              return (
                                <tr key={i} className="hover:bg-slate-50/40">
                                  <td className="py-3 px-5 text-sm font-bold text-[#1e294b]">{r.className}</td>
                                  {s.termTypes.map(t => (
                                    <td key={t} className="py-3 px-5 text-sm font-semibold text-slate-600">
                                      ₹ {currency(r.amounts[t] || 0)}
                                    </td>
                                  ))}
                                  <td className="py-3 px-5 text-sm font-extrabold text-[#1e3a8a]">₹ {currency(rowTotal)}</td>
                                </tr>
                              );
                            })}
                            <tr className="bg-blue-50/50 border-t-2 border-[#1e3a8a]/10">
                              <td className="py-3 px-5 text-xs font-black text-[#1e3a8a] uppercase tracking-wider">Branch Total</td>
                              {s.termTypes.map(t => (
                                <td key={t} className="py-3 px-5 text-sm font-extrabold text-[#1e3a8a]">
                                  ₹ {currency(perTermTotal[t] || 0)}
                                </td>
                              ))}
                              <td className="py-3 px-5 text-sm font-extrabold text-[#1e3a8a]">₹ {currency(branchTotal)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Notify Principal Modal ───────────────────────── */}
      {notifyState && (() => {
        const principal = principalForBranch(notifyState.branchName);
        const totalPending = notifyState.students.reduce((a, b) => a + b.pending, 0);
        return (
          <div
            className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => !notifySending && setNotifyState(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-2xl max-h-[92vh] sm:max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="px-4 md:px-6 py-3.5 md:py-4 border-b border-slate-100 bg-gradient-to-r from-red-50 to-orange-50 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 md:gap-3 min-w-0">
                  <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-red-600 flex items-center justify-center flex-shrink-0">
                    {notifyState.mode === "single" ? <Bell className="w-4 h-4 md:w-5 md:h-5 text-white" /> : <Megaphone className="w-4 h-4 md:w-5 md:h-5 text-white" />}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm md:text-base font-extrabold text-[#1e294b] truncate">
                      {notifyState.mode === "single" ? "Notify Principal" : isMobile ? "Notify — Bulk" : "Notify Principal — Bulk"}
                    </h3>
                    <p className="text-[10px] md:text-[11px] font-semibold text-slate-500 leading-snug">
                      {notifyState.branchName} · {notifyState.students.length} student{notifyState.students.length !== 1 ? "s" : ""} · ₹ {currency(totalPending)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => !notifySending && setNotifyState(null)}
                  disabled={notifySending}
                  className="p-1.5 rounded-lg hover:bg-white/60 transition-all shrink-0"
                >
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-5 space-y-3 md:space-y-4">
                {/* Target principal */}
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Recipient</p>
                  <p className="text-sm font-extrabold text-[#1e294b] truncate">{principal?.name || "Unassigned"}</p>
                  <p className="text-[11px] font-semibold text-slate-500 truncate">{principal?.email || "—"}</p>
                </div>

                {/* Student list preview */}
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    {notifyState.mode === "single" ? "Student" : `Defaulters (${notifyState.students.length})`}
                  </p>
                  <div className="max-h-36 md:max-h-40 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-100">
                    {notifyState.students.map((s, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-[#1e294b] truncate">{s.studentName}</p>
                          <p className="text-[10px] text-slate-500 font-semibold truncate">
                            {s.className}{s.rollNo ? ` · Roll ${s.rollNo}` : ""}
                          </p>
                        </div>
                        <p className="font-extrabold text-red-600 whitespace-nowrap">₹ {currency(s.pending)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Message */}
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Message</p>
                  <textarea
                    value={notifyMessage}
                    onChange={e => setNotifyMessage(e.target.value)}
                    rows={isMobile ? 7 : 10}
                    disabled={notifySending}
                    className="w-full px-3 py-2.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-red-100 focus:border-red-300 resize-y font-mono leading-relaxed"
                  />
                  <p className="text-[10px] text-slate-400 font-semibold mt-1.5 leading-snug">
                    This message will be sent to the branch principal. They will see it in their dashboard.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-4 md:px-6 py-3 md:py-3.5 border-t border-slate-100 bg-slate-50 flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2">
                <button
                  onClick={() => !notifySending && setNotifyState(null)}
                  disabled={notifySending}
                  className="px-4 py-2.5 sm:py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-100 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={sendNotify}
                  disabled={notifySending || !notifyMessage.trim()}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition-all shadow-sm disabled:opacity-50"
                >
                  {notifySending
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
                    : <><Send className="w-3.5 h-3.5" /> {isMobile ? "Send" : "Send Notification"}</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <AIInsightCard
        title="Fee Structure Intelligence"
        items={[
          { label:"Plan Coverage",   value: `${branchTotals.length} branch${branchTotals.length!==1?"es":""} published`, sub: `${totalClasses} classes · ${allTerms.length} term types` },
          { label:"Annual Footprint", value: `₹${currency(grandTotal)}`, sub: "Combined potential revenue" },
          { label:"Student Reach",   value: hasStudentData ? `${studentAgg.totalStudents} scholars` : "Upload student rows", sub: hasStudentData ? `₹${currency(studentAgg.totalPaid)} collected` : "Unlock granular tracking" },
        ]}
      />

      </div>
    </>
  );
}
