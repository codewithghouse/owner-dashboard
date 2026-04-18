import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where, addDoc, serverTimestamp } from "firebase/firestore";
import {
  Download, Loader2, Building2, DollarSign, Calendar, Filter,
  ChevronDown, FileSpreadsheet, AlertCircle, TrendingUp, X, Users,
  Bell, Megaphone, Send,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
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
  const [loading, setLoading]         = useState(true);
  const [structures, setStructures]   = useState<FeeStructure[]>([]);
  const [branchMap, setBranchMap]     = useState<Map<string, string>>(new Map());
  const [branchFilter, setBranchFilter] = useState<string>("All");
  const [defaulterBranchFilter, setDefaulterBranchFilter] = useState<string>("All");
  const [viewMode, setViewMode]       = useState<"table" | "chart">("table");
  const [principals, setPrincipals]   = useState<{ id: string; email: string; name: string; branchId: string; branchName?: string }[]>([]);
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
  const exportCombined = () => {
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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#1e3a8a]" />
      </div>
    );
  }

  const branchOptions = ["All", ...[...new Set(structures.map(s => s.branchName || ""))].filter(Boolean).sort()];
  const chartColors = ["#1e3a8a","#22c55e","#f59e0b","#ef4444","#8b5cf6","#14b8a6","#f97316","#ec4899"];

  return (
    <div className="space-y-6 pb-10 animate-in fade-in duration-300">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#1e294b] tracking-tight flex items-center gap-2">
            <DollarSign className="w-7 h-7 text-[#1e3a8a]" /> Fee Structure
          </h1>
          <p className="text-slate-500 text-xs md:text-sm font-medium mt-0.5">
            Branch-wise fee plans uploaded by principals &amp; DEOs
          </p>
        </div>
        {structures.length > 0 && (
          <button
            onClick={exportCombined}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-all self-start"
          >
            <Download className="w-3.5 h-3.5" /> Export All
          </button>
        )}
      </div>

      {/* Empty state */}
      {structures.length === 0 ? (
        <div className="bg-white border border-slate-100 rounded-2xl p-12 flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center">
            <FileSpreadsheet className="w-8 h-8 text-slate-300" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-[#1e294b] mb-1">No fee structures published yet</h3>
            <p className="text-sm text-slate-500 font-medium max-w-md">
              Ask your principal or DEO to upload the class-wise fee Excel from the Principal Dashboard → Fee Structure page.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Branches",        value: branchTotals.length,      icon: Building2, color: "text-blue-600",    bg: "bg-blue-50", note: "Active" },
              { label: "Total Classes",   value: totalClasses,             icon: Calendar,  color: "text-purple-600",  bg: "bg-purple-50", note: "Active" },
              { label: "Total Terms",     value: allTerms.length,          icon: TrendingUp, color: "text-teal-600",   bg: "bg-teal-50", note: "Active" },
              { label: "Combined Annual", value: `₹ ${currency(grandTotal)}`, icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50", note: "Across all branches" },
            ].map(s => (
              <div
                key={s.label}
                onClick={() => navigate("/fee-structure")}
                role="button"
                tabIndex={0}
                className="clickable-card bg-white p-4 md:p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{s.label}</p>
                  <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center`}>
                    <s.icon className={`w-4 h-4 ${s.color}`} />
                  </div>
                </div>
                <h3 className="text-2xl md:text-3xl font-extrabold text-[#1e294b] tracking-tight mb-1">{s.value}</h3>
                <p className={`text-[10px] font-bold ${s.color}`}>{s.note}</p>
              </div>
            ))}
          </div>

          {/* Student-level aggregates (only when any branch has student rows) */}
          {hasStudentData && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Total Students", value: studentAgg.totalStudents,                  icon: Users,       color: "text-indigo-600",  bg: "bg-indigo-50" },
                { label: "Fees Collected", value: `₹ ${currency(studentAgg.totalPaid)}`,     icon: DollarSign,  color: "text-emerald-600", bg: "bg-emerald-50" },
                { label: "Fees Pending",   value: `₹ ${currency(studentAgg.totalPending)}`,  icon: AlertCircle, color: "text-red-600",     bg: "bg-red-50" },
                { label: "Defaulters",     value: studentAgg.defaulters,                     icon: TrendingUp,  color: "text-amber-600",   bg: "bg-amber-50" },
              ].map(s => (
                <div
                  key={s.label}
                  onClick={() => navigate("/finance")}
                  role="button"
                  tabIndex={0}
                  className="clickable-card bg-white p-4 md:p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all"
                >
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{s.label}</p>
                    <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center`}>
                      <s.icon className={`w-4 h-4 ${s.color}`} />
                    </div>
                  </div>
                  <h3 className="text-2xl md:text-3xl font-extrabold text-[#1e294b] tracking-tight mb-1">{s.value}</h3>
                  <p className={`text-[10px] font-bold ${s.color}`}>Student-level data</p>
                </div>
              ))}
            </div>
          )}

          {/* Defaulters grouped branch-wise */}
          {hasStudentData && studentAgg.defaulterList.length > 0 && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-red-600 flex items-center justify-center">
                    <AlertCircle className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-red-900">Defaulters by Branch</h3>
                    <p className="text-[11px] text-red-700 font-semibold">
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
                <div key={group.branchName} className="bg-white rounded-2xl border border-red-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-red-100 bg-gradient-to-r from-red-50 to-orange-50 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white border border-red-200 flex items-center justify-center">
                        <Building2 className="w-4 h-4 text-red-600" />
                      </div>
                      <div>
                        <h4 className="text-sm font-extrabold text-[#1e294b]">{group.branchName}</h4>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          {group.count} defaulter{group.count !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="text-right">
                        <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Paid</p>
                        <p className="text-sm font-extrabold text-emerald-600">₹ {currency(group.paid)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black text-red-600 uppercase tracking-widest">Pending</p>
                        <p className="text-sm font-extrabold text-red-600">₹ {currency(group.pending)}</p>
                      </div>
                      <button
                        onClick={() => openNotify("bulk", group.branchName, group.list)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 text-white text-[10px] font-black uppercase tracking-wider hover:bg-red-700 transition-all shadow-sm"
                        title="Notify principal about all defaulters in this branch"
                      >
                        <Megaphone className="w-3.5 h-3.5" /> Notify Principal
                      </button>
                    </div>
                  </div>
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
                              <button
                                onClick={() => openNotify("single", group.branchName, [d])}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-[10px] font-bold uppercase tracking-wider transition-all"
                                title="Notify principal about this defaulter"
                              >
                                <Bell className="w-3 h-3" /> Notify
                              </button>
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
                </div>
              ))}
            </div>
          )}

          {/* Filters + view toggle */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Filter</span>
            </div>
            <div className="relative flex-1 max-w-xs">
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

          {/* Chart view — term-wise by branch */}
          {viewMode === "chart" && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <h3 className="text-sm font-extrabold text-[#1e294b] mb-4">Fee Breakdown by Branch & Term</h3>
              {chartData.length === 0 ? (
                <div className="h-80 flex items-center justify-center text-sm text-slate-400 font-semibold">No branches match filter</div>
              ) : (
                <div className="h-[380px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="branch" tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }}
                        tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                      <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px rgba(0,0,0,0.1)" }}
                        formatter={(v: any) => [`₹ ${currency(v)}`, ""]} />
                      <Legend wrapperStyle={{ fontSize: "10px", fontWeight: 700, paddingTop: "8px" }} />
                      {allTerms.map((t, i) => (
                        <Bar key={t} dataKey={t} fill={chartColors[i % chartColors.length]} radius={[4,4,0,0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Table view — one card per branch */}
          {viewMode === "table" && (
            <div className="space-y-4">
              {filtered.length === 0 ? (
                <div className="bg-white border border-slate-100 rounded-2xl p-8 text-center text-sm text-slate-400 font-semibold">
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
                  <div key={s.id} className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-[#1e3a8a] flex items-center justify-center shrink-0">
                          <Building2 className="w-5 h-5 text-white" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-base font-extrabold text-[#1e294b] truncate">{s.branchName}</h3>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
                            {s.rows.length} classes · {s.termTypes.length} terms
                            {s.academicYear && <> · AY {s.academicYear}</>}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-black text-emerald-600">₹ {currency(branchTotal)}</div>
                        <p className="text-[10px] font-semibold text-slate-400 mt-0.5">
                          {ts ? `Updated ${ts.toLocaleDateString("en-IN")}` : "—"}
                        </p>
                      </div>
                    </div>

                    {s.notes && (
                      <div className="px-5 py-2 bg-amber-50/50 border-b border-amber-100 flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-amber-700 font-semibold">{s.notes}</p>
                      </div>
                    )}

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
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => !notifySending && setNotifyState(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-red-50 to-orange-50 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center flex-shrink-0">
                    {notifyState.mode === "single" ? <Bell className="w-5 h-5 text-white" /> : <Megaphone className="w-5 h-5 text-white" />}
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-[#1e294b]">
                      {notifyState.mode === "single" ? "Notify Principal" : "Notify Principal — Bulk"}
                    </h3>
                    <p className="text-[11px] font-semibold text-slate-500">
                      {notifyState.branchName} · {notifyState.students.length} student{notifyState.students.length !== 1 ? "s" : ""} · ₹ {currency(totalPending)} pending
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => !notifySending && setNotifyState(null)}
                  disabled={notifySending}
                  className="p-1.5 rounded-lg hover:bg-white/60 transition-all"
                >
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {/* Target principal */}
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Recipient</p>
                  <p className="text-sm font-extrabold text-[#1e294b]">{principal?.name || "Unassigned"}</p>
                  <p className="text-[11px] font-semibold text-slate-500">{principal?.email || "—"}</p>
                </div>

                {/* Student list preview */}
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    {notifyState.mode === "single" ? "Student" : `Defaulters (${notifyState.students.length})`}
                  </p>
                  <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-100">
                    {notifyState.students.map((s, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-[#1e294b] truncate">{s.studentName}</p>
                          <p className="text-[10px] text-slate-500 font-semibold">
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
                    rows={10}
                    disabled={notifySending}
                    className="w-full px-3 py-2.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-red-100 focus:border-red-300 resize-y font-mono leading-relaxed"
                  />
                  <p className="text-[10px] text-slate-400 font-semibold mt-1.5">
                    This message will be sent to the branch principal. They will see it in their dashboard.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
                <button
                  onClick={() => !notifySending && setNotifyState(null)}
                  disabled={notifySending}
                  className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-100 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={sendNotify}
                  disabled={notifySending || !notifyMessage.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition-all shadow-sm disabled:opacity-50"
                >
                  {notifySending
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
                    : <><Send className="w-3.5 h-3.5" /> Send Notification</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
