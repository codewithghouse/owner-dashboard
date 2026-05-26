import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  UserPlus, Users, CheckCircle2, Clock, Mail, MoreVertical,
  Building2, Search, X, Send, Shield, RefreshCcw, Ban,
  ChevronRight, AlertTriangle, Phone, MapPin, Calendar,
  Plus, Edit3, Trash2, Globe, Hash, Loader2, Download,
  FileSpreadsheet, CheckCheck, RotateCcw, AlertCircle,
  Sparkles,
} from "lucide-react";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD, VIOLET,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, GRAD_RED,
  SHADOW_SM, SHADOW_LG, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db, auth, storage } from "@/lib/firebase";
import { 
  collection, addDoc, onSnapshot, query, 
  where, serverTimestamp, getDoc, doc, deleteDoc, updateDoc 
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { sendInvitationEmail } from "@/lib/resend";
import { toast } from "sonner";
import { addAuditLog } from "@/lib/auditService";
// xlsx is lazy-loaded inside the Excel handlers — saves ~600KB on initial load.

// Converts a display name to a consistent slug-based ID
// "South India" → "south_india", "Hyderabad Campus" → "hyderabad_campus"
const toSlug = (name: string) =>
  name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

// Rate-limit helper — prevents Resend/SMTP throttle errors on bulk sends
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Constant options remains same
const branchColorOptions = [
  '#1e3a8a', '#3b82f6', '#22c55e', '#10b981', '#f59e0b', '#f97316',
  '#ef4444', '#ec4899', '#8b5cf6', '#6366f1', '#14b8a6', '#06b6d4',
];

export default function PrincipalManagement() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const pageShellStyle = usePageShellStyle();
  const [activeTab, setActiveTab] = useState<'principals' | 'branches'>('branches');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showAddBranchModal, setShowAddBranchModal] = useState(false);
  const [selectedPrincipal, setSelectedPrincipal] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', branch: '', branchId: '', branchColor: '#1e3a8a' });
  const [bulkFile, setBulkFile]         = useState<File | null>(null);
  const [bulkRows, setBulkRows]         = useState<{ name: string; email: string; branch: string }[]>([]);
  const [bulkStatus, setBulkStatus]     = useState<Record<number, "pending" | "sending" | "sent" | "failed">>({});
  const [bulkRunning, setBulkRunning]   = useState(false);
  const [bulkDone, setBulkDone]         = useState(false);
  const bulkFileRef                     = useRef<HTMLInputElement>(null);
  /* Branch + invite color default both #1e3a8a (dark navy) — matching Edullent
     primary brand. Previously the two defaulted to different shades, so an
     unselected invite preview would tint differently from a freshly-created
     branch card on the same screen. */
  const [branchForm, setBranchForm] = useState({ name: '', location: '', color: '#1e3a8a' });
  const [showActionMenu, setShowActionMenu] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Edit branch modal
  const [showEditBranchModal, setShowEditBranchModal] = useState(false);
  const [editBranchData, setEditBranchData] = useState<any>(null);
  // Manage branch panel
  const [manageBranch, setManageBranch] = useState<any>(null);
  const managePanelRef = useRef<HTMLDivElement>(null);
  
  // Real Source Data
  const [branches, setBranches] = useState<any[]>([]);
  const [principals, setPrincipals] = useState<any[]>([]);
  const [schoolInfo, setSchoolInfo] = useState<any>(null);
  /* Live-loaded teachers + enrollments — used to compute per-branch student
     and teacher counts. Branch docs themselves carry `students: 0, teachers: 0`
     from creation but are NEVER updated when teachers/students are added, so
     reading branch.teachers shows stale 0 even on a fully-staffed branch.
     Computing live from the canonical source is the only way to reflect reality. */
  const [teachers, setTeachers] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);

  /* Action menu closes on any outside click. Without this it stayed open until
     the user clicked the same button again — easy to lose track of an open
     menu when scrolling the principals table. */
  useEffect(() => {
    if (!showActionMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-action-menu]")) setShowActionMenu(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showActionMenu]);

  /* Manage panel renders at the end of the branches grid, so when the user
     clicks "Manage" on the first card it can open far below the viewport —
     looks like the button did nothing. Scroll it into view on open. */
  useEffect(() => {
    if (!manageBranch) return;
    requestAnimationFrame(() => {
      managePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [manageBranch?.id]);

  useEffect(() => {
    if (!auth.currentUser) return;

    // Fetch School Name for Emails
    const fetchSchool = async () => {
      const docSnap = await getDoc(doc(db, "schools", auth.currentUser!.uid));
      if (docSnap.exists()) setSchoolInfo(docSnap.data());
    };
    fetchSchool();

    // Sync Branches — error callback surfaces Firestore rule denials / offline
    // failures so a blank page in production can be diagnosed from console.
    // Without it, listener errors silently strand the UI in an empty state.
    const branchesRef = collection(db, "schools", auth.currentUser.uid, "branches");
    const unsubscribeBranches = onSnapshot(
      branchesRef,
      (snapshot) => {
        const branchList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setBranches(branchList);
      },
      (err) => {
        console.error("[PrincipalManagement] branches listener error:", err);
        toast.error("Could not load branches — check permissions or network.");
      }
    );

    // Sync Principals (from a top-level collection or subcollection?)
    // Let's use a root 'principals' collection filtered by schoolId for easier cross-portal access
    const principalsRef = collection(db, "principals");
    const q = query(principalsRef, where("schoolId", "==", auth.currentUser.uid));
    const unsubscribePrincipals = onSnapshot(
      q,
      (snapshot) => {
        const principalList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setPrincipals(principalList);
      },
      (err) => {
        console.error("[PrincipalManagement] principals listener error:", err);
        toast.error("Could not load principals — check permissions or network.");
      }
    );

    // Sync teachers — needed for live per-branch teacher count on branch cards.
    const teachersRef = collection(db, "teachers");
    const tQ = query(teachersRef, where("schoolId", "==", auth.currentUser.uid));
    const unsubscribeTeachers = onSnapshot(
      tQ,
      (snapshot) => {
        setTeachers(snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      },
      (err) => console.error("[PrincipalManagement] teachers listener error:", err),
    );

    // Sync enrollments — needed for live per-branch student count (deduped
    // by studentId so multi-class students are counted once, per
    // bug_pattern_enrollment_row_dedup memory rule).
    const enrollmentsRef = collection(db, "enrollments");
    const eQ = query(enrollmentsRef, where("schoolId", "==", auth.currentUser.uid));
    const unsubscribeEnrollments = onSnapshot(
      eQ,
      (snapshot) => {
        setEnrollments(snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      },
      (err) => console.error("[PrincipalManagement] enrollments listener error:", err),
    );

    return () => {
      unsubscribeBranches();
      unsubscribePrincipals();
      unsubscribeTeachers();
      unsubscribeEnrollments();
    };
  }, []);

  const handleAddBranch = async () => {
    if (!branchForm.name || !branchForm.location || !auth.currentUser) return;
    setLoading(true);
    try {
      const docRef = await addDoc(collection(db, "schools", auth.currentUser.uid, "branches"), {
        ...branchForm,
        students: 0,
        teachers: 0,
        status: 'Active',
        ahi: 0,
        feeCollection: 0,
        passRate: 0,
        attendance: 0,
        established: new Date().getFullYear().toString(),
        createdAt: serverTimestamp()
      });
      // Set branchId = docRef.id for consistent canonical resolution across all services
      await updateDoc(docRef, { branchId: docRef.id });
      addAuditLog("branch_added", `New branch created: ${branchForm.name}`, branchForm.location).catch(() => {});
      toast.success("Branch added successfully!");
      setShowAddBranchModal(false);
      setBranchForm({ name: '', location: '', color: '#1e3a8a' });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleInvitePrincipal = async () => {
    if (!inviteForm.email || !inviteForm.name || !inviteForm.branch || !auth.currentUser) {
      toast.error("Please fill in all required fields (Name, Email, and Branch).");
      return;
    }

    // Pre-flight duplicate guard — case-insensitive match on (name, branch)
    // OR exact-match on email. After the 2026-05-26 cleanup we want to
    // prevent the same fakes coming back via casual re-invites
    // ("ghouse pasha" + "Ghouse Pasha" + "GhousePasha"). The native
    // confirm() lets the owner override when they really do mean to add
    // a second principal with a near-identical name.
    const nameKey   = inviteForm.name.toLowerCase().replace(/\s+/g, "").trim();
    const branchKey = (inviteForm.branchId || inviteForm.branch || "").toLowerCase().trim();
    const emailKey  = inviteForm.email.toLowerCase().trim();
    const collidingDoc = (principals as any[]).find(p => {
      const pName  = (p.name || "").toLowerCase().replace(/\s+/g, "").trim();
      const pBranch = (p.branchId || p.branch || "").toLowerCase().trim();
      const pEmail  = (p.email || "").toLowerCase().trim();
      if (pEmail && pEmail === emailKey) return true;
      if (nameKey && pName === nameKey && (!branchKey || pBranch === branchKey)) return true;
      return false;
    });
    if (collidingDoc) {
      const proceed = window.confirm(
        `A principal called "${collidingDoc.name}" is already registered for ` +
        `${collidingDoc.branch || collidingDoc.branchName || "this branch"} ` +
        `(${collidingDoc.email || "no email"}).\n\n` +
        `Add this one anyway? Click Cancel to review the existing entry first.`
      );
      if (!proceed) {
        toast.info("Invite cancelled — existing principal kept.");
        return;
      }
    }

    setLoading(true);
    try {
      // 1. Save to Whitelist in Firestore
      await addDoc(collection(db, "principals"), {
        ...inviteForm,
        email: inviteForm.email.toLowerCase(),
        branchId: inviteForm.branchId || toSlug(inviteForm.branch),
        role: "principal",
        schoolId: auth.currentUser.uid,
        schoolName: schoolInfo?.schoolName || "Our School",
        status: 'Invited',
        avatar: inviteForm.name.substring(0, 2).toUpperCase(),
        joinDate: new Date().toLocaleDateString(),
        lastActive: 'Never',
        studentsManaged: 0,
        teachersManaged: 0,
        createdAt: serverTimestamp()
      });

      // 2. Send Real Email via Resend
      const emailRes: any = await sendInvitationEmail({
        to: inviteForm.email,
        name: inviteForm.name,
        branch: inviteForm.branch,
        schoolName: schoolInfo?.schoolName || "Our School"
      });

      if (emailRes.success) {
        addAuditLog("principal_invited", `${inviteForm.name} invited as principal`, `Branch: ${inviteForm.branch}`);
        toast.success(emailRes.message || `Invitation sent to ${inviteForm.email}!`);
        setShowInviteModal(false);
        setInviteForm({ name: '', email: '', branch: '', branchId: '', branchColor: '#1e3a8a' });
      } else {
        const errorMsg = emailRes.message || emailRes.error?.message || emailRes.error || "Email failed to send.";
        toast.error(`Principal added to list, but email failed: ${errorMsg}`);
        console.error("Email Sending Error Details:", emailRes.error);
        // We keep the modal open so the user can see the error and retry if needed
      }
    } catch (err: any) {
      toast.error("Process failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  /* ── Download Excel template ──────────────────────────────────────── */
  const handleDownloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["name", "email", "branch"],
      ["Dr. Sarah Ahmed",   "sarah@school.com",  branches[0]?.name || "Main Branch"],
      ["Mr. Ravi Kumar",    "ravi@school.com",   branches[1]?.name || "South Branch"],
    ]);
    ws["!cols"] = [{ wch: 22 }, { wch: 26 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws, "Principals");
    XLSX.writeFile(wb, "principal_invite_template.xlsx");
  };

  /* ── Parse file & show preview ─────────────────────────────────────── */
  const handleBulkFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setBulkFile(file);
    setBulkRows([]);
    setBulkStatus({});
    setBulkDone(false);
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const wb   = XLSX.read(data, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const raw: any[] = XLSX.utils.sheet_to_json(ws);
      const parsed = raw
        .filter(r => r.name && r.email && r.branch)
        .map(r => ({ name: String(r.name).trim(), email: String(r.email).trim().toLowerCase(), branch: String(r.branch).trim() }));
      setBulkRows(parsed);
      const initStatus: Record<number, "pending"> = {};
      parsed.forEach((_, i) => { initStatus[i] = "pending"; });
      setBulkStatus(initStatus);
    } catch {
      toast.error("Could not parse the file. Make sure it's a valid Excel (.xlsx) file.");
    }
  };

  /* ── Run bulk invite with per-row status ───────────────────────────── */
  const handleBulkInvite = async () => {
    if (!bulkRows.length || !auth.currentUser) return;
    /* Capture uid at the START so a long bulk run survives a session expiry
       mid-loop. Previously each row's `auth.currentUser!.uid` would NPE if
       the auth state cleared between iterations. */
    const uid = auth.currentUser.uid;
    setBulkRunning(true);

    // Upload file reference to storage
    let fileUrl = "";
    if (bulkFile) {
      try {
        const fileRef = ref(storage, `bulk-invites/${uid}_${Date.now()}_${bulkFile.name}`);
        await uploadBytes(fileRef, bulkFile);
        fileUrl = await getDownloadURL(fileRef);
      } catch { /* storage upload optional */ }
    }

    let successCount = 0;
    let failCount    = 0;

    for (let i = 0; i < bulkRows.length; i++) {
      const { name, email, branch } = bulkRows[i];
      setBulkStatus(prev => ({ ...prev, [i]: "sending" }));

      try {
        /* Branch must exist in this school's `branches` subcollection. Falling
           back to `toSlug(branch)` would create a principal record with a
           branchId pointing at a non-existent branch — the invite email goes
           out, principal logs in, but cross-page joins (TeachersDirectory,
           Leaderboard etc.) silently lose them. Better to fail the row loudly
           so Owner can fix the Excel and retry. */
        const branchMatch = branches.find(b => b.name.toLowerCase() === branch.toLowerCase());
        if (!branchMatch) {
          console.warn(`[BulkInvite] Skipping ${email}: branch "${branch}" not found in school`);
          setBulkStatus(prev => ({ ...prev, [i]: "failed" }));
          failCount++;
          if (i < bulkRows.length - 1) await sleep(350);
          continue;
        }

        await addDoc(collection(db, "principals"), {
          name,
          email,
          branch: branchMatch.name,
          branchId: branchMatch.branchId || branchMatch.id,
          role: "principal",
          schoolId: uid,
          schoolName: schoolInfo?.schoolName || "Our School",
          status: "Invited",
          avatar: name.substring(0, 2).toUpperCase(),
          joinDate: new Date().toLocaleDateString(),
          lastActive: "Never",
          studentsManaged: 0,
          teachersManaged: 0,
          createdAt: serverTimestamp(),
          ...(fileUrl ? { sourceFile: fileUrl } : {}),
        });

        await sendInvitationEmail({
          to: email,
          name,
          branch: branchMatch.name,
          schoolName: schoolInfo?.schoolName || "Our School",
        });

        setBulkStatus(prev => ({ ...prev, [i]: "sent" }));
        successCount++;
      } catch (err) {
        console.error(`Failed to invite ${email}:`, err);
        setBulkStatus(prev => ({ ...prev, [i]: "failed" }));
        failCount++;
      }

      // 350ms pause between sends — prevents Resend rate-limit errors on bulk CSV uploads
      if (i < bulkRows.length - 1) await sleep(350);
    }

    setBulkRunning(false);
    setBulkDone(true);
    /* Single audit log entry for the whole bulk run — per-row entries would
       flood the audit log on a 100-row upload. */
    if (successCount > 0) {
      addAuditLog(
        "principals_bulk_invited",
        `Bulk invite: ${successCount} principals invited`,
        failCount > 0 ? `${failCount} rows failed` : "All rows succeeded",
      ).catch(() => {});
    }
    if (failCount > 0) {
      toast.warning(`${successCount} invited, ${failCount} failed. Check failed rows — branch name may not match.`);
    } else {
      toast.success(`Done! ${successCount} invited.`);
    }
  };

  /* ── Retry failed rows ─────────────────────────────────────────────── */
  const handleRetryFailed = async () => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    setBulkRunning(true);
    setBulkDone(false);
    let retryCount = 0;

    for (let i = 0; i < bulkRows.length; i++) {
      if (bulkStatus[i] !== "failed") continue;
      const { name, email, branch } = bulkRows[i];
      setBulkStatus(prev => ({ ...prev, [i]: "sending" }));

      try {
        /* Same branch-must-exist guard as handleBulkInvite. */
        const branchMatch = branches.find(b => b.name.toLowerCase() === branch.toLowerCase());
        if (!branchMatch) {
          setBulkStatus(prev => ({ ...prev, [i]: "failed" }));
          if (i < bulkRows.length - 1) await sleep(350);
          continue;
        }
        await addDoc(collection(db, "principals"), {
          name, email,
          branch: branchMatch.name,
          branchId: branchMatch.branchId || branchMatch.id,
          role: "principal",
          schoolId: uid,
          schoolName: schoolInfo?.schoolName || "Our School",
          status: "Invited",
          avatar: name.substring(0, 2).toUpperCase(),
          joinDate: new Date().toLocaleDateString(),
          lastActive: "Never",
          studentsManaged: 0, teachersManaged: 0,
          createdAt: serverTimestamp(),
        });
        await sendInvitationEmail({ to: email, name, branch: branchMatch.name, schoolName: schoolInfo?.schoolName || "Our School" });
        setBulkStatus(prev => ({ ...prev, [i]: "sent" }));
        retryCount++;
      } catch {
        setBulkStatus(prev => ({ ...prev, [i]: "failed" }));
      }

      // 350ms pause between retries — same rate-limit protection
      if (i < bulkRows.length - 1) await sleep(350);
    }

    setBulkRunning(false);
    setBulkDone(true);
    if (retryCount > 0) {
      addAuditLog(
        "principals_bulk_retried",
        `Bulk retry: ${retryCount} principals re-invited`,
        "",
      ).catch(() => {});
    }
    toast.success(`Retry complete! ${retryCount} re-invited.`);
  };

  /* ── Reset bulk modal ──────────────────────────────────────────────── */
  const resetBulkModal = () => {
    setShowBulkModal(false);
    setBulkFile(null);
    setBulkRows([]);
    setBulkStatus({});
    setBulkRunning(false);
    setBulkDone(false);
    if (bulkFileRef.current) bulkFileRef.current.value = "";
  };

  const handleDeleteBranch = async (id: string) => {
    if (!auth.currentUser) return;
    /* Warn Owner about principals that will be orphaned (branchId pointing
       to a now-deleted branch). Without this warning the branch silently
       vanishes and the principal record sits there with a dead reference,
       still consuming the dashboard slot but unable to be matched on
       cross-page joins. */
    const branch = branches.find(b => b.id === id);
    const orphans = branch ? principalsForBranch(branch) : [];
    const baseMsg = "Are you sure you want to delete this branch? All associated data will be removed.";
    const orphanMsg = orphans.length > 0
      ? `\n\nWARNING: ${orphans.length} principal${orphans.length !== 1 ? "s are" : " is"} assigned to this branch (${orphans.slice(0,3).map(p => p.name).join(", ")}${orphans.length > 3 ? "..." : ""}). They will be left without a branch — please reassign them after deletion.`
      : "";
    if (!window.confirm(baseMsg + orphanMsg)) return;
    try {
      await deleteDoc(doc(db, "schools", auth.currentUser.uid, "branches", id));
      toast.success("Branch deleted successfully");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleUpdateBranch = async () => {
    if (!editBranchData || !auth.currentUser) return;
    if (!editBranchData.name.trim() || !editBranchData.location.trim()) {
      toast.error("Name and location are required.");
      return;
    }
    setLoading(true);
    try {
      await updateDoc(
        doc(db, "schools", auth.currentUser.uid, "branches", editBranchData.id),
        { name: editBranchData.name.trim(), location: editBranchData.location.trim(), color: editBranchData.color }
      );
      addAuditLog("branch_edited", `Branch updated: ${editBranchData.name}`, editBranchData.location).catch(() => {});
      toast.success("Branch updated!");
      setShowEditBranchModal(false);
      setEditBranchData(null);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePrincipal = async (id: string) => {
    if (!auth.currentUser || !window.confirm("Are you sure you want to delete this principal? Access will be revoked.")) return;
    try {
      await deleteDoc(doc(db, "principals", id));
      addAuditLog("principal_removed", `Principal removed from school network`, `Principal ID: ${id}`);
      toast.success("Principal removed successfully");
      if (selectedPrincipal?.id === id) setSelectedPrincipal(null);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleReassignPrincipal = (branchName: string, color: string) => {
    const branchId = branches.find(b => b.name === branchName)?.branchId || toSlug(branchName);
    setInviteForm({ ...inviteForm, branch: branchName, branchId, branchColor: color });
    setShowInviteModal(true);
  };

  const filteredPrincipals = principals.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.branch.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredBranches = branches.filter(b =>
    b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.location.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusConfig = (status: string) => {
    switch(status) {
      case 'Active': return { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100', dot: 'bg-emerald-500' };
      case 'Invited': return { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-100', dot: 'bg-amber-500' };
      case 'Upcoming': return { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100', dot: 'bg-blue-500' };
      case 'Planned': return { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-100', dot: 'bg-purple-500' };
      case 'Deactivated': return { bg: 'bg-slate-50', text: 'text-slate-400', border: 'border-slate-100', dot: 'bg-slate-300' };
      default: return { bg: 'bg-slate-50', text: 'text-slate-400', border: 'border-slate-100', dot: 'bg-slate-300' };
    }
  };

  /* Match a principal to a branch via branchId first, falling back to name.
     Pure name-match breaks after a branch is renamed — the principal's stored
     `branch` field becomes stale and the branch shows as unassigned even
     though the principal is still there. branchId is the durable key. */
  const principalsForBranch = (b: any) =>
    principals.filter(p =>
      (b.branchId && p.branchId === b.branchId) ||
      (b.id && p.branchId === b.id) ||
      p.branch === b.name
    );

  /* Live per-branch counts — branch.teachers / branch.students stored on the
     branch doc are stale (initialized 0 at creation, never updated when
     teachers/students are added). Computing from canonical collections every
     render is correct and cheap at MVP scale. branchId-first match handles
     branch rename safely. */
  const teacherCountForBranch = (b: any) => {
    const bid = b.branchId || b.id;
    return teachers.filter(t =>
      (bid && t.branchId === bid) ||
      (b.name && t.branch === b.name)
    ).length;
  };

  const studentCountForBranch = (b: any) => {
    const bid = b.branchId || b.id;
    const set = new Set<string>();
    enrollments.forEach(e => {
      const matches =
        (bid && e.branchId === bid) ||
        (b.name && e.branch === b.name);
      if (matches && e.studentId) set.add(e.studentId);
    });
    return set.size;
  };

  const totalBranches = branches.length;
  const totalPrincipals = principals.length;
  const activePrincipals = principals.filter(p => p.status === 'Active').length;
  const pendingInvites = principals.filter(p => p.status === 'Invited').length;
  const unassignedBranches = branches.filter(b =>
    !principalsForBranch(b).some(p => p.status === 'Active')
  ).length;

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 16 : 24 }}>

      <PageHead
        icon={Shield}
        title="Management Console"
        subtitle="Manage branches & assign principals"
        right={
          <div style={{ display: isMobile ? "grid" : "flex", gridTemplateColumns: isMobile ? "1fr 1fr" : undefined, gap:8, flexWrap:"wrap", width: isMobile ? "100%" : "auto" }}>
            <button
              onClick={() => setShowAddBranchModal(true)}
              className="dash-btn"
              style={{
                display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                padding: isMobile ? "10px 12px" : "10px 14px", borderRadius:12,
                background:"#fff", color:T3, border:"0.5px solid rgba(0,85,255,.12)",
                fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                cursor:"pointer", boxShadow:SHADOW_SM, fontFamily:"inherit",
              }}
            >
              <Building2 size={13}/> {isMobile ? "Branch" : "Add Branch"}
            </button>
            <button
              onClick={() => setShowBulkModal(true)}
              className="dash-btn"
              style={{
                display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                padding: isMobile ? "10px 12px" : "10px 14px", borderRadius:12,
                background:"rgba(123,63,244,.08)", color:VIOLET, border:"0.5px solid rgba(123,63,244,.22)",
                fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                cursor:"pointer", boxShadow:SHADOW_SM, fontFamily:"inherit",
              }}
            >
              <Hash size={13}/> {isMobile ? "Bulk" : "Bulk Invite"}
            </button>
            <button
              onClick={() => setShowInviteModal(true)}
              className="dash-btn"
              style={{
                display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                padding: isMobile ? "10px 12px" : "10px 16px", borderRadius:12,
                background:GRAD_PRIMARY, color:"#fff",
                fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                border:"none", cursor:"pointer", boxShadow:SHADOW_BTN, fontFamily:"inherit",
                gridColumn: isMobile ? "1 / -1" : undefined,
              }}
            >
              <UserPlus size={13}/> Invite Principal
            </button>
          </div>
        }
      />

      <DarkHero
        icon={Building2}
        eyebrow={<><Sparkles size={11} style={{ display:"inline", marginRight:4 }}/> Management Intelligence</> as any}
        title={totalBranches.toString()}
        subtitle={`Branch${totalBranches!==1?"es":""} in network · ${activePrincipals} active principal${activePrincipals!==1?"s":""} · ${unassignedBranches} awaiting assignment`}
        stats={[
          { label:"Principals", value: totalPrincipals.toString() },
          { label:"Active",     value: activePrincipals.toString() },
          { label:"Pending",    value: pendingInvites.toString() },
        ]}
      />

      {/* Bright Stat Grid */}
      <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(5, 1fr)", gap: isMobile ? 10 : 14 }}>
        <StatTile label="Total Branches"    value={totalBranches.toString()}      sub={`${branches.filter(b => b.status === 'Active').length} active`} grad={GRAD_BLUE}   icon={Building2} onClick={()=>setActiveTab('branches')} />
        <StatTile label="Total Principals"  value={totalPrincipals.toString()}    sub="Across network"             grad={GRAD_VIOLET} icon={Users}     onClick={()=>setActiveTab('principals')} />
        <StatTile label="Active Principals" value={activePrincipals.toString()}   sub="Currently managing"         grad={GRAD_GREEN}  icon={CheckCircle2} onClick={()=>setActiveTab('principals')} />
        <StatTile label="Pending Invites"   value={pendingInvites.toString()}     sub="Awaiting acceptance"        grad={GRAD_GOLD}   icon={Clock}     onClick={()=>setActiveTab('principals')} />
        <StatTile label="Unassigned"        value={unassignedBranches.toString()} sub="Need principal"             grad={unassignedBranches > 0 ? GRAD_RED : GRAD_GREEN} icon={AlertTriangle} onClick={()=>setActiveTab('branches')} />
      </div>

      {/* Tab Switcher */}
      <div style={{ display:"flex", gap:8, width: isMobile ? "100%" : "auto" }}>
        {[
          { key: 'branches', label: 'Branches', icon: Building2 },
          { key: 'principals', label: 'Principals', icon: Users },
        ].map(t => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key as any); setSearchQuery(''); }}
              className="dash-btn"
              style={{
                display:"inline-flex", alignItems:"center", justifyContent:"center", gap:8,
                padding: isMobile ? "10px 16px" : "11px 22px", borderRadius: isMobile ? 12 : 14,
                background: active ? GRAD_PRIMARY : "#fff",
                color: active ? "#fff" : T3,
                fontSize: isMobile ? 11 : 12, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
                border: active ? "none" : "0.5px solid rgba(0,85,255,.12)",
                boxShadow: active ? SHADOW_BTN : SHADOW_SM,
                cursor:"pointer", fontFamily:"inherit",
                flex: isMobile ? 1 : undefined,
              }}
            >
              <t.icon size={isMobile ? 13 : 14}/> {t.label}
            </button>
          );
        })}
      </div>

      {/* Search Bar */}
      <div style={{ position:"relative" }}>
        <Search size={16} color={T4} style={{ position:"absolute", left: isMobile ? 14 : 18, top:"50%", transform:"translateY(-50%)" }}/>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={activeTab === 'principals' ? "Search principals..." : "Search branches..."}
          style={{
            width:"100%", padding: isMobile ? "12px 16px 12px 40px" : "14px 20px 14px 48px", borderRadius: isMobile ? 14 : 16,
            border:"0.5px solid rgba(0,85,255,.1)", background:"#fff",
            fontSize: isMobile ? 12 : 13, fontWeight:500, color:T1, outline:"none",
            boxShadow:SHADOW_SM, fontFamily:"inherit",
          }}
        />
      </div>

      {/* ==================== BRANCHES TAB ==================== */}
      {activeTab === 'branches' && (
        <>
          {/* Branches Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {filteredBranches.map(branch => {
              /* Match by branchId for stale-rename safety; fall back to name only as last resort. */
              const assignedPrincipal = principalsForBranch(branch).find(p => p.status === 'Active' || p.status === 'Invited');
              // Older branch docs predate the status field — treat them as Active
              // so the pill is never blank.
              const branchStatus = branch.status || 'Active';
              const statusConf = getStatusConfig(branchStatus);
              return (
                <div
                  key={branch.id}
                  className="dash3d bg-white rounded-2xl md:rounded-[2rem] border border-slate-100 overflow-hidden group"
                  style={{ boxShadow: SHADOW_SM }}
                >
                  {/* Branch Header Strip */}
                  <div className="h-2" style={{ backgroundColor: branch.color }}></div>
                  <div className="p-5 md:p-8">
                    {/* Top Row */}
                    <div className="flex items-center justify-between gap-3 mb-4 md:mb-6">
                      <div className="flex items-center gap-3 md:gap-4 min-w-0 flex-1">
                        <div className="w-11 h-11 md:w-14 md:h-14 rounded-xl md:rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0" style={{ backgroundColor: branch.color }}>
                          <Building2 className="w-5 h-5 md:w-7 md:h-7" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-base md:text-lg font-bold text-[#111827] group-hover:text-blue-600 transition-colors truncate">{branch.name}</h3>
                          <p className="text-[11px] md:text-xs text-slate-400 font-medium flex items-center gap-1.5 mt-0.5 truncate">
                            <MapPin className="w-3 h-3 shrink-0" /> {branch.location}
                          </p>
                        </div>
                      </div>
                      <span className={`px-2.5 md:px-3 py-1 rounded-lg text-[8px] md:text-[9px] font-black uppercase tracking-widest shrink-0 ${statusConf.bg} ${statusConf.text} ${statusConf.border} border`}>
                        {branchStatus}
                      </span>
                    </div>

                    {/* Stats — live counts from canonical collections, NOT
                        the stale branch.students / branch.teachers fields. */}
                    <div className="grid grid-cols-3 gap-2 md:gap-3 mb-4 md:mb-6">
                      <div className="bg-[#f8fafc] border border-slate-50 p-3 md:p-4 rounded-xl text-center">
                        <p className="text-base md:text-xl font-black text-[#111827] tracking-tighter">{studentCountForBranch(branch).toLocaleString()}</p>
                        <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase mt-1">Students</p>
                      </div>
                      <div className="bg-[#f8fafc] border border-slate-50 p-3 md:p-4 rounded-xl text-center">
                        <p className="text-base md:text-xl font-black text-[#111827] tracking-tighter">{teacherCountForBranch(branch)}</p>
                        <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase mt-1">Teachers</p>
                      </div>
                      <div className="bg-[#f8fafc] border border-slate-50 p-3 md:p-4 rounded-xl text-center">
                        <p className="text-base md:text-xl font-black text-[#111827] tracking-tighter">{branch.established ?? new Date().getFullYear()}</p>
                        <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase mt-1">Est.</p>
                      </div>
                    </div>

                    {/* Assigned Principal */}
                    <div
                      onClick={!assignedPrincipal ? () => handleReassignPrincipal(branch.name, branch.color) : undefined}
                      role={!assignedPrincipal ? 'button' : undefined}
                      tabIndex={!assignedPrincipal ? 0 : undefined}
                      className={`p-3 md:p-4 rounded-xl md:rounded-2xl border ${assignedPrincipal ? 'bg-[#f0fdf4] border-emerald-100' : 'bg-[#fef2f2] border-rose-100 cursor-pointer hover:bg-rose-50 transition-colors'}`}
                    >
                      {assignedPrincipal ? (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 md:gap-3 min-w-0 flex-1">
                            <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg md:rounded-xl flex items-center justify-center text-white font-bold text-[10px] shadow-sm shrink-0" style={{ backgroundColor: branch.color }}>
                              {assignedPrincipal.avatar}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[13px] md:text-sm font-bold text-[#111827] truncate">{assignedPrincipal.name}</p>
                              <p className="text-[10px] text-slate-400 font-medium truncate">{assignedPrincipal.email}</p>
                            </div>
                          </div>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 md:px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest shrink-0 ${getStatusConfig(assignedPrincipal.status).bg} ${getStatusConfig(assignedPrincipal.status).text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${getStatusConfig(assignedPrincipal.status).dot}`}></span>
                            {assignedPrincipal.status}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 md:gap-3 min-w-0 flex-1">
                            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-[13px] md:text-sm font-bold text-rose-600">No Principal Assigned</p>
                              <p className="text-[10px] text-rose-400 font-medium">Dashboard access disabled</p>
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleReassignPrincipal(branch.name, branch.color); }}
                            className="px-3 md:px-4 py-1.5 rounded-lg bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 transition-colors shrink-0"
                          >
                            Assign
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Branch Actions — labels only on xl+. Below xl the grid
                        splits cards into 2/3 cols making each card ~280-400px
                        wide, which can't fit 4 buttons with the "Reassign"
                        label without overflowing the card. */}
                    <div className="grid grid-cols-4 gap-1.5 md:gap-2 mt-4 md:mt-5">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditBranchData({ ...branch }); setShowEditBranchModal(true); }}
                        className="min-w-0 flex items-center justify-center gap-1.5 p-2.5 md:p-3 rounded-xl border border-slate-100 bg-[#f8fafc] hover:bg-white hover:shadow-md transition-all text-[11px] xl:text-xs font-bold text-slate-500">
                        <Edit3 className="w-3.5 h-3.5 shrink-0" /> <span className="hidden xl:inline truncate">Edit</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setManageBranch(manageBranch?.id === branch.id ? null : branch); }}
                        className="min-w-0 flex items-center justify-center gap-1.5 p-2.5 md:p-3 rounded-xl border border-slate-100 bg-[#f8fafc] hover:bg-white hover:shadow-md transition-all text-[11px] xl:text-xs font-bold text-slate-500">
                        <Users className="w-3.5 h-3.5 shrink-0" /> <span className="hidden xl:inline truncate">Manage</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleReassignPrincipal(branch.name, branch.color); }}
                        className="min-w-0 flex items-center justify-center gap-1.5 p-2.5 md:p-3 rounded-xl border border-amber-100 bg-amber-50/50 hover:bg-white hover:shadow-md transition-all text-[11px] xl:text-xs font-bold text-amber-600">
                        <RefreshCcw className="w-3.5 h-3.5 shrink-0" /> <span className="hidden xl:inline truncate">Reassign</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteBranch(branch.id); }}
                        className="min-w-0 flex items-center justify-center p-2.5 md:p-3 rounded-xl border border-rose-100 bg-[#fef2f2] hover:bg-rose-50 transition-all text-[11px] xl:text-xs font-bold text-rose-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* ── Manage Panel (shown below grid when a branch is selected) ── */}
            {manageBranch && (
              <div ref={managePanelRef} className="dash3d md:col-span-2 lg:col-span-3 bg-white rounded-2xl md:rounded-[2rem] border border-[#1e3a8a]/20 p-4 md:p-6 animate-in slide-in-from-top-2 duration-200" style={{ boxShadow: SHADOW_LG }}>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0" style={{ backgroundColor: manageBranch.color }}>
                      <Building2 className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-[#1e294b]">{manageBranch.name}</p>
                      <p className="text-xs text-slate-400">{manageBranch.location}</p>
                    </div>
                  </div>
                  <button onClick={() => setManageBranch(null)} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                    <X className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
                {/* Principals assigned to this branch */}
                {(() => {
                  const branchPrincipals = principalsForBranch(manageBranch);
                  return branchPrincipals.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2">
                      <AlertTriangle className="w-7 h-7 text-rose-300" />
                      <p className="text-sm font-bold text-slate-400">No principals assigned to this branch yet.</p>
                      <button
                        onClick={() => handleReassignPrincipal(manageBranch.name, manageBranch.color)}
                        className="mt-1 px-4 py-2 rounded-xl bg-[#1e3a8a] text-white text-xs font-black hover:bg-[#1e40af] transition-colors"
                      >
                        Invite Principal
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {branchPrincipals.map(p => {
                        const sc = getStatusConfig(p.status);
                        return (
                          <div key={p.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[10px] font-black shrink-0" style={{ backgroundColor: manageBranch.color }}>
                              {p.avatar || p.name?.slice(0,2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-[#1e294b] truncate">{p.name}</p>
                              <p className="text-xs text-slate-400 truncate">{p.email}</p>
                            </div>
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${sc.bg} ${sc.text} border ${sc.border}`}>{p.status}</span>
                            <button
                              onClick={() => handleDeletePrincipal(p.id)}
                              className="p-1.5 rounded-lg hover:bg-rose-50 transition-colors"
                              title="Remove principal"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Add New Branch Card */}
            <button
              onClick={() => setShowAddBranchModal(true)}
              className="dash3d bg-white rounded-2xl md:rounded-[2rem] border-2 border-dashed border-slate-200 p-6 md:p-8 flex flex-col items-center justify-center gap-3 md:gap-4 text-slate-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/30 min-h-[180px] md:min-h-[350px] group"
              style={{ boxShadow: SHADOW_SM }}
            >
              <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center group-hover:bg-blue-100 group-hover:border-blue-200 transition-all">
                <Plus className="w-6 h-6 md:w-8 md:h-8" />
              </div>
              <div className="text-center">
                <p className="text-sm md:text-base font-bold">Add New Branch</p>
                <p className="text-[11px] md:text-xs font-medium mt-1">Create and setup a new school branch</p>
              </div>
            </button>
          </div>

          {/* Access Flow Info */}
          <div className="bg-[#1e294b] rounded-2xl md:rounded-[2rem] p-5 md:p-10 text-white shadow-xl overflow-hidden relative">
            <div className="absolute top-0 right-0 w-72 h-72 bg-blue-500/10 rounded-full -translate-y-1/2 translate-x-1/2"></div>
            <div className="relative z-10">
              <h3 className="text-base md:text-xl font-bold mb-2 md:mb-3 tracking-tight">How Dashboard Access Works</h3>
              <p className="text-blue-200/60 text-[12px] md:text-sm mb-5 md:mb-8 max-w-2xl leading-relaxed font-medium">Principals can only access their dashboard after being invited and assigned to a branch by you. Here's the flow:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                {[
                  { step: '1', title: 'Create Branch', desc: 'Add a new school branch with location details' },
                  { step: '2', title: 'Invite Principal', desc: 'Send email invitation to the principal' },
                  { step: '3', title: 'Assign to Branch', desc: 'Link the principal to their branch' },
                  { step: '4', title: 'Access Granted', desc: 'Principal can now login & manage their dashboard' },
                ].map((s, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 p-4 md:p-6 rounded-xl md:rounded-2xl">
                    <div className="w-9 h-9 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-300 font-black text-sm mb-3 md:mb-4">{s.step}</div>
                    <h4 className="text-[13px] md:text-sm font-bold text-white mb-1">{s.title}</h4>
                    <p className="text-[11px] text-blue-200/50 font-medium leading-relaxed">{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ==================== PRINCIPALS TAB ==================== */}
      {activeTab === 'principals' && (
        <>
          {/* Principals — Table (desktop) / Cards (mobile) */}
          <div className="dash3d bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 overflow-hidden" style={{ boxShadow: SHADOW_SM }}>
            <div className="p-5 md:p-10 border-b border-slate-50 flex items-center justify-between">
              <h3 className="text-base md:text-xl font-bold text-[#111827]">All Principals</h3>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-[10px] md:text-[11px] font-bold text-slate-400 uppercase tracking-widest">Live</span>
              </div>
            </div>

            {/* Mobile card list */}
            {isMobile ? (
              <div className="p-3 flex flex-col gap-2">
                {filteredPrincipals.length === 0 ? (
                  <div className="py-12 text-center text-[12px] font-bold text-slate-400">No principals found</div>
                ) : filteredPrincipals.map((p) => {
                  const sc = getStatusConfig(p.status);
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPrincipal(p)}
                      className="rounded-xl border border-slate-100 bg-slate-50/40 p-3 cursor-pointer"
                    >
                      <div className="flex items-center gap-3 mb-2.5">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-[11px] shadow-md shrink-0" style={{ backgroundColor: p.branchColor }}>
                          {p.avatar}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-extrabold text-[#111827] truncate">{p.name}</p>
                          <p className="text-[11px] text-slate-500 font-medium truncate">{p.email}</p>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest shrink-0 ${sc.bg} ${sc.text} ${sc.border} border`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`}></span>
                          {p.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-center">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.branchColor }}></div>
                          <span className="text-[11px] font-bold text-slate-600 truncate">{p.branch}</span>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-[10px] text-slate-400 font-medium">{p.joinDate}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeletePrincipal(p.id); }}
                            className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-400"
                            aria-label="Remove principal"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[1100px]">
                <thead>
                  <tr className="bg-slate-50/50">
                    {["Principal", "Branch", "Email", "Status", "Joined", "Actions"].map(h => (
                      <th key={h} className="py-6 px-10 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredPrincipals.map((p) => {
                    const statusConfig = getStatusConfig(p.status);
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/30 transition-colors group cursor-pointer" onClick={() => setSelectedPrincipal(p)}>
                        <td className="py-7 px-10">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-xs shadow-lg shrink-0" style={{ backgroundColor: p.branchColor }}>
                              {p.avatar}
                            </div>
                            <div>
                              <p className="font-bold text-[#111827] text-[15px] tracking-tight group-hover:text-blue-600 transition-colors">{p.name}</p>
                              <p className="text-slate-400 text-xs font-medium">ID: {p.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-7 px-10">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.branchColor }}></div>
                            <span className="text-sm font-bold text-slate-600">{p.branch}</span>
                          </div>
                        </td>
                        <td className="py-7 px-10 text-slate-500 font-medium text-[13px]">{p.email}</td>
                        <td className="py-7 px-10">
                          <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border} border`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`}></span>
                            {p.status}
                          </span>
                        </td>
                        <td className="py-7 px-10 text-slate-500 font-medium text-[13px]">{p.joinDate}</td>
                        <td className="py-7 px-10">
                          <div className="relative" data-action-menu>
                            <button onClick={(e) => { e.stopPropagation(); setShowActionMenu(showActionMenu === p.id ? null : p.id); }} className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 transition-colors">
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {showActionMenu === p.id && (
                              <div className="absolute right-0 top-10 z-20 w-52 bg-white rounded-2xl border border-slate-100 shadow-2xl shadow-slate-900/10 py-3 animate-in slide-in-from-top-2 duration-200">
                                {p.status === 'Invited' && (
                                  <button className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                                    <RefreshCcw className="w-4 h-4" /> Resend Invite
                                  </button>
                                )}
                                <button className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                                  <Building2 className="w-4 h-4" /> Reassign Branch
                                </button>
                                <button className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                                  <Mail className="w-4 h-4" /> Send Message
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleDeletePrincipal(p.id); }}
                                  className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-rose-500 hover:bg-rose-50 transition-colors">
                                  <Trash2 className="w-4 h-4" /> Delete Principal
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); /* Logic for deactivation */ }}
                                  className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-400 hover:bg-slate-50 transition-colors">
                                  <Ban className="w-4 h-4" /> {p.status === 'Deactivated' ? 'Reactivate' : 'Deactivate'}
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </>
      )}

      {/* ==================== ADD BRANCH MODAL ==================== */}
      {/* ── Edit Branch Modal ─────────────────────────────────────────────── */}
      {showEditBranchModal && editBranchData && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 md:p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl md:rounded-[2.5rem] w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="p-5 md:p-8 border-b border-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 md:gap-4 min-w-0">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0" style={{ backgroundColor: editBranchData.color }}>
                  <Edit3 className="w-5 h-5 md:w-6 md:h-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base md:text-xl font-bold text-[#111827] truncate">Edit Branch</h3>
                  <p className="text-slate-400 text-[11px] md:text-xs font-medium">Update branch details</p>
                </div>
              </div>
              <button onClick={() => { setShowEditBranchModal(false); setEditBranchData(null); }} className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 transition-colors shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 md:p-8 space-y-4 md:space-y-6 overflow-y-auto">
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3 block">Branch Name</label>
                <Input
                  value={editBranchData.name}
                  onChange={e => setEditBranchData({ ...editBranchData, name: e.target.value })}
                  className="h-12 md:h-14 bg-[#f8fafc] border-slate-100 rounded-xl md:rounded-2xl text-sm font-medium"
                  placeholder="e.g. West Branch"
                />
              </div>
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3 block">Location / City</label>
                <Input
                  value={editBranchData.location}
                  onChange={e => setEditBranchData({ ...editBranchData, location: e.target.value })}
                  className="h-12 md:h-14 bg-[#f8fafc] border-slate-100 rounded-xl md:rounded-2xl text-sm font-medium"
                  placeholder="e.g. Hyderabad"
                />
              </div>
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3 block">Branch Color</label>
                <div className="flex flex-wrap gap-2.5 md:gap-3">
                  {branchColorOptions.map(color => (
                    <button
                      key={color}
                      onClick={() => setEditBranchData({ ...editBranchData, color })}
                      className={`w-9 h-9 md:w-10 md:h-10 rounded-xl transition-all ${editBranchData.color === color ? 'ring-2 md:ring-4 ring-offset-2 ring-blue-200 scale-110' : 'hover:scale-105'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="p-5 md:p-8 border-t border-slate-50 flex items-center justify-between gap-3 md:gap-4 shrink-0">
              <Button variant="outline" onClick={() => { setShowEditBranchModal(false); setEditBranchData(null); }} className="h-11 md:h-12 px-5 md:px-6 rounded-xl border-slate-200 text-[13px] md:text-sm font-bold flex-1 md:flex-initial">
                Cancel
              </Button>
              <Button
                disabled={loading}
                onClick={handleUpdateBranch}
                className="h-11 md:h-12 px-5 md:px-8 rounded-xl bg-[#1e3a8a] text-white text-[13px] md:text-sm font-bold hover:bg-[#1e40af] shadow-lg flex items-center justify-center gap-2 flex-1 md:flex-initial"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />} Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {showAddBranchModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 md:p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl md:rounded-[2.5rem] w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="p-5 md:p-8 border-b border-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 md:gap-4 min-w-0">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-emerald-500 flex items-center justify-center text-white shadow-lg shrink-0">
                  <Building2 className="w-5 h-5 md:w-6 md:h-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base md:text-xl font-bold text-[#111827] truncate">Add New Branch</h3>
                  <p className="text-slate-400 text-[11px] md:text-xs font-medium">Create a new school branch</p>
                </div>
              </div>
              <button onClick={() => setShowAddBranchModal(false)} className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 transition-colors shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 md:p-8 space-y-4 md:space-y-6 overflow-y-auto">
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3 block">Branch Name</label>
                <Input
                  value={branchForm.name}
                  onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                  className="h-12 md:h-14 bg-[#f8fafc] border-slate-100 rounded-xl md:rounded-2xl text-sm font-medium focus:ring-blue-900/5"
                  placeholder="e.g. West Branch"
                />
              </div>
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3 block">Location / Address</label>
                <Input
                  value={branchForm.location}
                  onChange={(e) => setBranchForm({ ...branchForm, location: e.target.value })}
                  className="h-12 md:h-14 bg-[#f8fafc] border-slate-100 rounded-xl md:rounded-2xl text-sm font-medium focus:ring-blue-900/5"
                  placeholder="e.g. Bandra West, Mumbai"
                />
              </div>
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3 block">Branch Color</label>
                <div className="flex flex-wrap gap-2.5 md:gap-3">
                  {branchColorOptions.map((color) => (
                    <button
                      key={color}
                      onClick={() => setBranchForm({ ...branchForm, color })}
                      className={`w-9 h-9 md:w-10 md:h-10 rounded-xl transition-all ${branchForm.color === color ? 'ring-2 md:ring-4 ring-offset-2 ring-blue-200 scale-110' : 'hover:scale-105'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="bg-[#f8fafc] border border-slate-100 p-4 md:p-6 rounded-xl md:rounded-2xl">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 md:mb-4">Preview</p>
                <div className="flex items-center gap-3 md:gap-4">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0" style={{ backgroundColor: branchForm.color }}>
                    <Building2 className="w-5 h-5 md:w-6 md:h-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] md:text-base font-bold text-[#111827] truncate">{branchForm.name || 'Branch Name'}</p>
                    <p className="text-[11px] md:text-xs text-slate-400 font-medium truncate">{branchForm.location || 'Location'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-5 md:p-8 border-t border-slate-50 flex items-center justify-between gap-3 md:gap-4 shrink-0">
              <Button variant="outline" onClick={() => setShowAddBranchModal(false)} className="h-11 md:h-12 px-5 md:px-6 rounded-xl border-slate-200 text-[13px] md:text-sm font-bold flex-1 md:flex-initial">
                Cancel
              </Button>
              <Button
                disabled={loading}
                onClick={handleAddBranch}
                className="h-11 md:h-12 px-5 md:px-8 rounded-xl bg-emerald-500 text-white text-[13px] md:text-sm font-bold hover:bg-emerald-600 shadow-lg flex items-center justify-center gap-2 flex-1 md:flex-initial"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== INVITE PRINCIPAL MODAL ==================== */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 md:p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl md:rounded-[2.5rem] w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="p-5 md:p-8 border-b border-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 md:gap-4 min-w-0">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-[#1e3a8a] flex items-center justify-center text-white shadow-lg shrink-0">
                  <UserPlus className="w-5 h-5 md:w-6 md:h-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base md:text-xl font-bold text-[#111827] truncate">Invite Principal</h3>
                  <p className="text-slate-400 text-[11px] md:text-xs font-medium">Send email & assign branch</p>
                </div>
              </div>
              <button onClick={() => setShowInviteModal(false)} className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 transition-colors shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 md:p-8 space-y-4 md:space-y-6 overflow-y-auto">
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3 block">Full Name</label>
                <Input
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  className="h-12 md:h-14 bg-[#f8fafc] border-slate-100 rounded-xl md:rounded-2xl text-sm font-medium focus:ring-blue-900/5"
                  placeholder="e.g. Dr. Kavitha Reddy"
                />
              </div>
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3 block">Email Address</label>
                <Input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  className="h-12 md:h-14 bg-[#f8fafc] border-slate-100 rounded-xl md:rounded-2xl text-sm font-medium focus:ring-blue-900/5"
                  placeholder="e.g. principal@example.com"
                />
              </div>
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3 block">Assign to Branch</label>
                <div className="grid grid-cols-1 gap-2.5 md:gap-3">
                  {branches.map((branch, i) => (
                    <button
                      key={i}
                      onClick={() => setInviteForm({ ...inviteForm, branch: branch.name, branchId: branch.branchId || toSlug(branch.name), branchColor: branch.color })}
                      className={`flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-xl md:rounded-2xl border transition-all text-left ${
                        inviteForm.branch === branch.name
                          ? 'border-blue-300 bg-blue-50/50 shadow-sm'
                          : 'border-slate-100 bg-[#f8fafc] hover:bg-white hover:border-slate-200'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm shrink-0" style={{ backgroundColor: branch.color }}>
                        <Building2 className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] md:text-sm font-bold text-[#111827] block truncate">{branch.name}</span>
                        <p className="text-[10px] text-slate-400 font-medium truncate">{branch.location}</p>
                      </div>
                      {inviteForm.branch === branch.name && (
                        <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-5 md:p-8 border-t border-slate-50 flex items-center justify-between gap-3 md:gap-4 shrink-0">
              <Button variant="outline" onClick={() => setShowInviteModal(false)} className="h-11 md:h-12 px-5 md:px-6 rounded-xl border-slate-200 text-[13px] md:text-sm font-bold flex-1 md:flex-initial">
                Cancel
              </Button>
              <Button
                disabled={loading}
                onClick={handleInvitePrincipal}
                className="h-11 md:h-12 px-5 md:px-8 rounded-xl bg-[#1e294b] text-white text-[13px] md:text-sm font-bold hover:bg-[#1e3a8a] shadow-lg flex items-center justify-center gap-2 flex-1 md:flex-initial"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {isMobile ? "Send" : "Send Invitation"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== BULK INVITE MODAL ==================== */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 md:p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl md:rounded-[2.5rem] w-full max-w-2xl shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden max-h-[92vh] flex flex-col">

            {/* Modal Header */}
            <div className="p-5 md:p-8 border-b border-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 md:gap-4 min-w-0">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shrink-0">
                  <FileSpreadsheet className="w-5 h-5 md:w-6 md:h-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base md:text-xl font-bold text-[#111827] truncate">Bulk Invite</h3>
                  <p className="text-slate-400 text-[11px] md:text-xs font-medium truncate">
                    {bulkRows.length > 0
                      ? `${bulkRows.length} principal${bulkRows.length > 1 ? "s" : ""} ready`
                      : "Upload Excel to invite many at once"}
                  </p>
                </div>
              </div>
              <button type="button" onClick={resetBulkModal} className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 transition-colors shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 md:p-8 space-y-4 md:space-y-6">

              {/* Step 1 — Download Template + Upload */}
              {!bulkRows.length && (
                <>
                  {/* Download template */}
                  <div className="flex items-center justify-between gap-3 bg-indigo-50 border border-indigo-100 rounded-xl md:rounded-2xl px-4 md:px-6 py-3 md:py-4">
                    <div className="min-w-0">
                      <p className="text-[13px] md:text-sm font-bold text-indigo-900">Excel Template</p>
                      <p className="text-[11px] md:text-xs font-medium text-indigo-500 mt-0.5">Columns: name, email, branch</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadTemplate}
                      className="flex items-center gap-2 px-3.5 md:px-5 py-2 md:py-2.5 rounded-xl bg-indigo-600 text-white text-[10px] md:text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-colors shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" /> {isMobile ? "Get" : "Template"}
                    </button>
                  </div>

                  {/* File drop zone */}
                  <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl md:rounded-[2rem] p-6 md:p-12 flex flex-col items-center justify-center gap-3 md:gap-4 text-center cursor-pointer relative hover:border-indigo-400 hover:bg-indigo-50/30 transition-all group">
                    <input
                      ref={bulkFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleBulkFileChange}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-slate-400 shadow-sm group-hover:text-indigo-600 group-hover:border-indigo-100 group-hover:scale-110 transition-all">
                      <FileSpreadsheet className="w-6 h-6 md:w-8 md:h-8" />
                    </div>
                    <div>
                      <p className="text-sm md:text-base font-bold text-slate-700">{isMobile ? "Tap to choose Excel" : "Click or drag & drop Excel file"}</p>
                      <p className="text-[11px] md:text-xs font-medium text-slate-400 mt-1">.xlsx or .xls — columns: name, email, branch</p>
                    </div>
                  </div>

                  {/* Available branches hint */}
                  {branches.length > 0 && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl md:rounded-2xl px-4 md:px-6 py-3 md:py-4">
                      <p className="text-[11px] md:text-xs font-black text-amber-700 uppercase tracking-widest mb-2">Your Branches</p>
                      <div className="flex flex-wrap gap-2">
                        {branches.map(b => (
                          <span key={b.id} className="px-2.5 md:px-3 py-0.5 md:py-1 rounded-lg bg-white border border-amber-200 text-[11px] md:text-xs font-bold text-amber-800">
                            {b.name}
                          </span>
                        ))}
                      </div>
                      <p className="text-[10px] font-medium text-amber-500 mt-2">Branch names in Excel must match exactly.</p>
                    </div>
                  )}
                </>
              )}

              {/* Step 2 — Preview + Progress */}
              {bulkRows.length > 0 && (
                <div className="space-y-4 md:space-y-5">
                  {/* Summary strip */}
                  <div className="grid grid-cols-3 gap-2 md:gap-3">
                    {[
                      { label: "Total",   value: bulkRows.length, color: "bg-slate-50 text-slate-700 border-slate-100"   },
                      { label: "Sent",    value: Object.values(bulkStatus).filter(s => s === "sent").length,   color: "bg-green-50 text-green-700 border-green-100"  },
                      { label: "Failed",  value: Object.values(bulkStatus).filter(s => s === "failed").length, color: "bg-rose-50 text-rose-700 border-rose-100"     },
                    ].map(c => (
                      <div key={c.label} className={`${c.color} border rounded-xl md:rounded-2xl px-3 md:px-4 py-2.5 md:py-3 text-center`}>
                        <p className="text-xl md:text-2xl font-black">{c.value}</p>
                        <p className="text-[9px] md:text-[10px] font-black uppercase tracking-widest mt-0.5">{c.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Progress bar */}
                  {(bulkRunning || bulkDone) && (() => {
                    const done   = Object.values(bulkStatus).filter(s => s === "sent" || s === "failed").length;
                    const pct    = Math.round((done / bulkRows.length) * 100);
                    return (
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs font-bold text-slate-500">
                          <span>{bulkDone ? "Complete" : "Processing…"}</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Per-row list — responsive: table-like on desktop, compact cards on mobile */}
                  <div className="rounded-xl md:rounded-2xl border border-slate-100 overflow-hidden">
                    {!isMobile && (
                      <div className="grid grid-cols-[auto_1fr_1fr_80px] gap-0 text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-50 px-5 py-3 border-b border-slate-100">
                        <span className="w-8">#</span>
                        <span>Name</span>
                        <span>Email</span>
                        <span className="text-right">Status</span>
                      </div>
                    )}
                    <div className="divide-y divide-slate-50 max-h-56 md:max-h-64 overflow-y-auto">
                      {bulkRows.map((row, i) => {
                        const st = bulkStatus[i] || "pending";
                        const statusEl = (
                          <>
                            {st === "pending"  && <span className="px-2 md:px-2.5 py-1 rounded-lg bg-slate-100 text-slate-400 text-[9px] font-black uppercase tracking-widest">Pending</span>}
                            {st === "sending"  && <span className="px-2 md:px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-600 text-[9px] font-black uppercase tracking-widest flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />Sending</span>}
                            {st === "sent"     && <span className="px-2 md:px-2.5 py-1 rounded-lg bg-green-100 text-green-600 text-[9px] font-black uppercase tracking-widest flex items-center gap-1"><CheckCheck className="w-3 h-3" />Sent</span>}
                            {st === "failed"   && <span className="px-2 md:px-2.5 py-1 rounded-lg bg-rose-100 text-rose-500 text-[9px] font-black uppercase tracking-widest flex items-center gap-1"><AlertCircle className="w-3 h-3" />Failed</span>}
                          </>
                        );
                        if (isMobile) {
                          return (
                            <div key={i} className="flex items-center gap-2.5 px-3 py-2.5">
                              <span className="w-5 text-[11px] font-bold text-slate-300 shrink-0">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-[12px] font-bold text-[#111827] truncate">{row.name}</p>
                                <p className="text-[10px] text-slate-400 font-medium truncate">{row.email} · {row.branch}</p>
                              </div>
                              <div className="shrink-0">{statusEl}</div>
                            </div>
                          );
                        }
                        return (
                          <div key={i} className="grid grid-cols-[auto_1fr_1fr_80px] gap-0 items-center px-5 py-3 hover:bg-slate-50/50 transition-colors">
                            <span className="w-8 text-xs font-bold text-slate-300">{i + 1}</span>
                            <div>
                              <p className="text-sm font-bold text-[#111827] truncate">{row.name}</p>
                              <p className="text-[10px] text-slate-400 font-medium truncate">{row.branch}</p>
                            </div>
                            <p className="text-xs text-slate-500 font-medium truncate pr-3">{row.email}</p>
                            <div className="flex justify-end">{statusEl}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Change file link */}
                  {!bulkRunning && !bulkDone && (
                    <button
                      type="button"
                      onClick={() => { setBulkFile(null); setBulkRows([]); setBulkStatus({}); if (bulkFileRef.current) bulkFileRef.current.value = ""; }}
                      className="text-xs font-bold text-indigo-500 hover:text-indigo-700 transition-colors"
                    >
                      ← Choose a different file
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-5 md:p-8 border-t border-slate-50 flex items-center justify-between gap-2 md:gap-4 shrink-0">
              <Button type="button" variant="outline" onClick={resetBulkModal} className="h-11 md:h-12 px-4 md:px-6 rounded-xl border-slate-200 text-[13px] md:text-sm font-bold flex-1 md:flex-initial">
                {bulkDone ? "Close" : "Cancel"}
              </Button>

              <div className="flex items-center gap-2 md:gap-3 flex-1 md:flex-initial">
                {/* Retry failed */}
                {bulkDone && Object.values(bulkStatus).some(s => s === "failed") && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRetryFailed}
                    disabled={bulkRunning}
                    className="h-11 md:h-12 px-4 md:px-6 rounded-xl border-rose-200 text-rose-600 text-[13px] md:text-sm font-bold hover:bg-rose-50 flex items-center justify-center gap-2 flex-1 md:flex-initial"
                  >
                    <RotateCcw className="w-4 h-4" /> {isMobile ? "Retry" : "Retry Failed"}
                  </Button>
                )}

                {/* Start invite */}
                {!bulkDone && (
                  <Button
                    type="button"
                    disabled={bulkRunning || bulkRows.length === 0}
                    onClick={handleBulkInvite}
                    className="h-11 md:h-12 px-4 md:px-8 rounded-xl bg-indigo-600 text-white text-[13px] md:text-sm font-bold hover:bg-indigo-700 shadow-lg flex items-center justify-center gap-2 flex-1 md:flex-initial"
                  >
                    {bulkRunning
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Inviting…</>
                      : <><Send className="w-4 h-4" /> {isMobile ? `Send ${bulkRows.length}` : `Send ${bulkRows.length} Invite${bulkRows.length > 1 ? "s" : ""}`}</>
                    }
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== PRINCIPAL DETAIL MODAL ==================== */}
      {selectedPrincipal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 md:p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl md:rounded-[2.5rem] w-full max-w-2xl shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden max-h-[92vh] overflow-y-auto">
            <div className="p-5 md:p-8 border-b border-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3 md:gap-5 min-w-0">
                <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-2xl flex items-center justify-center text-white font-bold text-sm md:text-lg shadow-xl shrink-0" style={{ backgroundColor: selectedPrincipal.branchColor }}>
                  {selectedPrincipal.avatar}
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg md:text-2xl font-bold text-[#111827] tracking-tight truncate">{selectedPrincipal.name}</h3>
                  <p className="text-slate-400 text-[11px] md:text-sm font-medium mt-1 truncate">Principal  •  {selectedPrincipal.branch}</p>
                </div>
              </div>
              <button onClick={() => setSelectedPrincipal(null)} className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 transition-colors shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 md:p-8 space-y-5 md:space-y-8">
              <div className="grid grid-cols-2 gap-3 md:gap-5">
                <div className="bg-[#f8fafc] border border-slate-100 p-3 md:p-5 rounded-xl md:rounded-2xl">
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2">Status</p>
                  {(() => {
                    const sc = getStatusConfig(selectedPrincipal.status);
                    return (
                      <span className={`inline-flex items-center gap-2 px-3 md:px-4 py-1.5 rounded-lg text-[10px] md:text-[11px] font-black uppercase tracking-widest ${sc.bg} ${sc.text} ${sc.border} border`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`}></span>
                        {selectedPrincipal.status}
                      </span>
                    );
                  })()}
                </div>
                <div className="bg-[#f8fafc] border border-slate-100 p-3 md:p-5 rounded-xl md:rounded-2xl">
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2">Last Active</p>
                  <p className="text-[13px] md:text-sm font-bold text-[#111827] truncate">{selectedPrincipal.lastActive}</p>
                </div>
              </div>

              <div className="space-y-3 md:space-y-4">
                <h4 className="text-[11px] md:text-sm font-bold text-slate-400 uppercase tracking-widest">Contact Information</h4>
                <div className="space-y-2 md:space-y-3">
                  <div className="flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-xl md:rounded-2xl bg-[#f8fafc] border border-slate-100">
                    <Mail className="w-4 h-4 md:w-5 md:h-5 text-slate-400 shrink-0" />
                    <span className="text-[12px] md:text-sm font-bold text-[#111827] truncate">{selectedPrincipal.email}</span>
                  </div>
                  {selectedPrincipal.phone && (
                    <div className="flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-xl md:rounded-2xl bg-[#f8fafc] border border-slate-100">
                      <Phone className="w-4 h-4 md:w-5 md:h-5 text-slate-400 shrink-0" />
                      <span className="text-[12px] md:text-sm font-bold text-[#111827] truncate">{selectedPrincipal.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-xl md:rounded-2xl bg-[#f8fafc] border border-slate-100">
                    <Calendar className="w-4 h-4 md:w-5 md:h-5 text-slate-400 shrink-0" />
                    <span className="text-[12px] md:text-sm font-bold text-[#111827]">{selectedPrincipal.joinDate}</span>
                  </div>
                </div>
              </div>

              {selectedPrincipal.status === 'Active' && (() => {
                /* Same live-count pattern: principal.studentsManaged /
                   teachersManaged stored on the principal doc are stale (set
                   to 0 at invite time, never updated). Compute from the
                   principal's branch's actual rosters. */
                const principalBranch = branches.find(b =>
                  (b.branchId && b.branchId === selectedPrincipal.branchId) ||
                  b.id === selectedPrincipal.branchId ||
                  b.name === selectedPrincipal.branch
                );
                const liveStudents = principalBranch ? studentCountForBranch(principalBranch) : 0;
                const liveTeachers = principalBranch ? teacherCountForBranch(principalBranch) : 0;
                return (
                  <div className="space-y-3 md:space-y-4">
                    <h4 className="text-[11px] md:text-sm font-bold text-slate-400 uppercase tracking-widest">Branch Overview</h4>
                    <div className="grid grid-cols-2 gap-3 md:gap-4">
                      <div className="p-4 md:p-6 rounded-xl md:rounded-2xl border border-slate-100 bg-[#f0fdf4] text-center">
                        <p className="text-2xl md:text-3xl font-black text-[#111827] tracking-tighter">{liveStudents.toLocaleString()}</p>
                        <p className="text-[11px] md:text-xs font-bold text-emerald-600 mt-2">Students Managed</p>
                      </div>
                      <div className="p-4 md:p-6 rounded-xl md:rounded-2xl border border-slate-100 bg-[#eff6ff] text-center">
                        <p className="text-2xl md:text-3xl font-black text-[#111827] tracking-tighter">{liveTeachers}</p>
                        <p className="text-[11px] md:text-xs font-bold text-blue-600 mt-2">Teachers Managed</p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-3">
                <h4 className="text-[11px] md:text-sm font-bold text-slate-400 uppercase tracking-widest">Quick Actions</h4>
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  <button className="flex items-center gap-2 md:gap-3 p-3 md:p-4 rounded-xl md:rounded-2xl border border-slate-100 bg-[#f8fafc] hover:bg-white hover:shadow-lg transition-all text-[12px] md:text-sm font-bold text-slate-600">
                    <Mail className="w-4 h-4 text-blue-500 shrink-0" /> Send Email
                  </button>
                  <button className="flex items-center gap-2 md:gap-3 p-3 md:p-4 rounded-xl md:rounded-2xl border border-slate-100 bg-[#f8fafc] hover:bg-white hover:shadow-lg transition-all text-[12px] md:text-sm font-bold text-slate-600">
                    <Building2 className="w-4 h-4 text-amber-500 shrink-0" /> Reassign
                  </button>
                  <button className="flex items-center gap-2 md:gap-3 p-3 md:p-4 rounded-xl md:rounded-2xl border border-slate-100 bg-[#f8fafc] hover:bg-white hover:shadow-lg transition-all text-[12px] md:text-sm font-bold text-slate-600">
                    <Shield className="w-4 h-4 text-emerald-500 shrink-0" /> {isMobile ? "Permissions" : "Edit Permissions"}
                  </button>
                  <button
                    onClick={() => handleDeletePrincipal(selectedPrincipal.id)}
                    className="flex items-center gap-2 md:gap-3 p-3 md:p-4 rounded-xl md:rounded-2xl border border-rose-100 bg-rose-50/50 hover:bg-white hover:shadow-lg transition-all text-[12px] md:text-sm font-bold text-rose-600">
                    <Trash2 className="w-4 h-4 shrink-0" /> Delete
                  </button>
                  <button className="col-span-2 flex items-center justify-center gap-2 md:gap-3 p-3 md:p-4 rounded-xl md:rounded-2xl border border-slate-100 bg-[#f8fafc] hover:bg-white hover:shadow-lg transition-all text-[12px] md:text-sm font-bold text-slate-400">
                    <Ban className="w-4 h-4 shrink-0" /> {selectedPrincipal.status === 'Deactivated' ? 'Reactivate' : 'Deactivate'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <AIInsightCard
        title="Management Console Intelligence"
        items={[
          { label:"Network Coverage", value: `${totalBranches} branch${totalBranches!==1?"es":""}`, sub: unassignedBranches > 0 ? `${unassignedBranches} unassigned` : "Fully staffed" },
          { label:"Leadership",       value: `${activePrincipals}/${totalPrincipals} active`, sub: pendingInvites > 0 ? `${pendingInvites} pending invite${pendingInvites!==1?"s":""}` : "All onboarded" },
          { label:"Priority",         value: unassignedBranches > 0 ? "Assign principals" : pendingInvites > 0 ? "Follow up invites" : "Maintain operations", sub: unassignedBranches > 0 || pendingInvites > 0 ? "Action recommended" : "Healthy state" },
        ]}
      />
      </div>
    </>
  );
}
