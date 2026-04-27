import { useState, useEffect, useRef } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, GraduationCap, BookOpen,
  DollarSign, AlertTriangle, GitBranch, FileText, Settings,
  Menu, X, UserCog, LogOut, ShieldCheck, Bell,
  Clock, ShieldAlert, CheckCircle2, DollarSign as FeeIcon,
  Activity, Brain, ClipboardList, FileSpreadsheet, Trophy, Award,
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import {
  doc, getDoc, collection, query, where,
  onSnapshot, orderBy, limit
} from "firebase/firestore";
import { signOut, onAuthStateChanged } from "firebase/auth";
import SearchModal from "@/components/SearchModal";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Notification {
  id: string;
  type: "deo_request" | "risk_alert" | "fee_alert" | "system";
  title: string;
  body: string;
  link: string;
  read: boolean;
  ts: number;
}

// ── Nav items grouped by section ─────────────────────────────────────────────
const navSections: { heading: string; items: { to: string; label: string; icon: any }[] }[] = [
  {
    heading: "Overview",
    items: [
      { to: "/",          label: "Dashboard",             icon: LayoutDashboard },
    ],
  },
  {
    heading: "Students",
    items: [
      { to: "/students",     label: "Students Intelligence", icon: Users },
      { to: "/ai-predictor", label: "AI Risk Predictor",     icon: Brain },
    ],
  },
  {
    heading: "Academics",
    items: [
      { to: "/academics",     label: "Academics Overview", icon: BookOpen },
      { to: "/fee-structure", label: "Fee Structure",      icon: FileSpreadsheet },
    ],
  },
  {
    heading: "Staff",
    items: [
      { to: "/teachers-directory",  label: "Teachers Directory",   icon: ClipboardList },
      { to: "/teachers",            label: "Teacher Performance",  icon: GraduationCap },
      { to: "/teacher-leaderboard", label: "Teacher Leaderboard",  icon: Trophy },
      { to: "/principals",          label: "Principal Management", icon: UserCog },
      { to: "/deo",                 label: "DEO Management",       icon: ShieldCheck },
    ],
  },
  {
    heading: "Operations",
    items: [
      { to: "/branches",           label: "Branches Comparison", icon: GitBranch },
      { to: "/branch-leaderboard", label: "Branch Leaderboard",  icon: Award },
      { to: "/finance",            label: "Finance & Fees",      icon: DollarSign },
      { to: "/risks",              label: "Risks & Alerts",      icon: AlertTriangle },
    ],
  },
  {
    heading: "Reports",
    items: [
      { to: "/reports", label: "Reports Center", icon: FileText },
      { to: "/audit",   label: "Activity Log",   icon: Activity },
    ],
  },
];

const settingsItem = { to: "/settings", label: "Settings", icon: Settings };

// ── Notification icon helper ──────────────────────────────────────────────────
function NotifIcon({ type }: { type: Notification["type"] }) {
  if (type === "deo_request")  return <ShieldAlert className="w-4 h-4 text-amber-500" />;
  if (type === "risk_alert")   return <AlertTriangle className="w-4 h-4 text-rose-500" />;
  if (type === "fee_alert")    return <FeeIcon className="w-4 h-4 text-orange-500" />;
  return <Bell className="w-4 h-4 text-[#1e3a8a]" />;
}

function getInitials(name?: string | null): string {
  if (!name) return "SC";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "SC";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getSchoolCode(name?: string | null): string {
  if (!name) return "EDLT";
  const trimmed = name.trim();
  if (!trimmed) return "EDLT";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].length <= 8 ? parts[0].toUpperCase() : parts[0].slice(0, 4).toUpperCase();
  }
  return parts.map(p => p[0]).join("").slice(0, 5).toUpperCase();
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Main Layout ───────────────────────────────────────────────────────────────
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [schoolData, setSchoolData]       = useState<any>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [bellOpen, setBellOpen]           = useState(false);
  const [searchOpen, setSearchOpen]       = useState(false);
  const bellRef                           = useRef<HTMLDivElement>(null);
  const location   = useLocation();
  const navigate   = useNavigate();

  // ── Cmd+K / Ctrl+K global search shortcut ─────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── School data + notifications (auth-state-aware) ──────────────────────
  // Fixed 2026-04-18: previously read `auth.currentUser` at mount time which
  // races with onAuthStateChanged on cold reload — notifications never
  // subscribed for signed-in users who landed directly on a deep link.
  useEffect(() => {
    let unsubDEO: (() => void) | null = null;
    let unsubRisk: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      // Tear down any previous subscriptions when auth changes.
      if (unsubDEO) { unsubDEO(); unsubDEO = null; }
      if (unsubRisk) { unsubRisk(); unsubRisk = null; }

      if (!user) {
        setSchoolData(null);
        setNotifications([]);
        return;
      }

      // School profile
      try {
        const snap = await getDoc(doc(db, "schools", user.uid));
        if (snap.exists()) setSchoolData(snap.data());
      } catch (err) {
        console.warn("[AppLayout] school fetch failed:", err);
      }

      // Parse already-read notification IDs safely — corrupted localStorage
      // must NOT crash the layout.
      let readIds: Set<string> = new Set();
      try {
        readIds = new Set(JSON.parse(localStorage.getItem(`notif_read_${user.uid}`) || "[]"));
      } catch (err) {
        console.warn("[AppLayout] corrupted notif_read cache — ignoring:", err);
      }

      // ① DEO pending requests
      unsubDEO = onSnapshot(
        query(collection(db, "access_requests"), where("schoolId", "==", user.uid), where("status", "==", "pending")),
        (snap) => {
          const deoNotifs: Notification[] = snap.docs.map(d => {
            const data = d.data();
            const ts = data.requestDate?.toMillis?.() || data.createdAt?.toMillis?.() || Date.now();
            return {
              id: `deo_${d.id}`,
              type: "deo_request" as const,
              title: "New DEO Access Request",
              body: `${data.name || "Someone"} from ${data.branchName || "a branch"} requested DEO access`,
              link: "/deo",
              read: readIds.has(`deo_${d.id}`),
              ts,
            };
          });
          setNotifications(prev => {
            const filtered = prev.filter(n => n.type !== "deo_request");
            return [...filtered, ...deoNotifs].sort((a, b) => b.ts - a.ts).slice(0, 20);
          });
        },
        (err) => console.warn("[AppLayout] DEO snapshot error:", err.code, err.message),
      );

      // ② Risk alerts (last 5)
      unsubRisk = onSnapshot(
        query(collection(db, "risks"), where("schoolId", "==", user.uid), orderBy("createdAt", "desc"), limit(5)),
        (snap) => {
          const riskNotifs: Notification[] = snap.docs.map(d => {
            const data = d.data();
            const ts = data.createdAt?.toMillis?.() || Date.now();
            return {
              id: `risk_${d.id}`,
              type: "risk_alert" as const,
              title: data.title || "Risk Alert",
              body: data.description || data.message || "A risk was flagged in your school",
              link: "/risks",
              read: readIds.has(`risk_${d.id}`),
              ts,
            };
          });
          setNotifications(prev => {
            const filtered = prev.filter(n => n.type !== "risk_alert");
            return [...filtered, ...riskNotifs].sort((a, b) => b.ts - a.ts).slice(0, 20);
          });
        },
        (err) => console.warn("[AppLayout] Risk snapshot error:", err.code, err.message),
      );
    });

    return () => {
      unsubAuth();
      if (unsubDEO) unsubDEO();
      if (unsubRisk) unsubRisk();
    };
  }, []);

  // ── Close bell on outside click ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (bellRef.current && !bellRef.current.contains(t)) setBellOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Close sidebar / popovers on route change ─────────────────────────────
  useEffect(() => {
    setIsSidebarOpen(false);
    setBellOpen(false);
  }, [location.pathname]);

  // ── Mark all as read ────────────────────────────────────────────────────
  const markAllRead = () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const readKey = `notif_read_${uid}`;
    const allIds = notifications.map(n => n.id);
    localStorage.setItem(readKey, JSON.stringify(allIds));
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const handleNotifClick = (notif: Notification) => {
    const uid = auth.currentUser?.uid;
    if (uid) {
      const readKey = `notif_read_${uid}`;
      const existing: string[] = JSON.parse(localStorage.getItem(readKey) || "[]");
      if (!existing.includes(notif.id)) {
        localStorage.setItem(readKey, JSON.stringify([...existing, notif.id]));
      }
    }
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
    setBellOpen(false);
    navigate(notif.link);
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleLogout = () => signOut(auth);

  return (
    <div className="flex flex-col h-screen overflow-hidden font-sans bg-[#EEF4FF]">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden transition-all duration-300 animate-in fade-in"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* ── Top Header (full width) ─────────────────────────────────────── */}
      <header className="h-14 lg:h-16 bg-white flex items-center justify-between px-4 lg:px-6 shrink-0 z-30 gap-4 border-b border-slate-100">
        {/* Mobile menu button + School identifier */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            className="p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-xl lg:hidden transition-colors shrink-0"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="w-8 h-8 bg-[#1e3a8a] rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/10 shrink-0">
            <GraduationCap className="w-4 h-4 text-white" />
          </div>
          <div
            title={schoolData?.schoolName || "EDULLENT"}
            className="min-w-0 flex flex-col leading-tight"
          >
            <span className="text-[14px] font-bold text-[#1e294b] tracking-tight uppercase truncate">
              {getSchoolCode(schoolData?.schoolName)}
            </span>
            <span className="text-[10px] font-bold text-slate-400 tracking-widest uppercase truncate mt-0.5">
              {schoolData?.schoolName || "EDULLENT"}
            </span>
          </div>
        </div>

        {/* Right cluster: bell, name+role, avatar, logout */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* ── Bell ── */}
          <div ref={bellRef} className="relative flex items-center">
            <button
              onClick={() => setBellOpen(v => !v)}
              className="relative w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center hover:bg-slate-100 transition-all"
            >
              <Bell className="w-4 h-4 text-slate-500" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />
              )}
            </button>

            {/* ── Notification panel ── */}
            {bellOpen && (
              <div className="absolute right-0 top-12 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in slide-in-from-top-2 duration-200 z-50">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-50">
                  <div>
                    <h3 className="text-sm font-black text-[#1e293b]">Notifications</h3>
                    {unreadCount > 0 && (
                      <p className="text-[10px] text-slate-400 font-medium">{unreadCount} unread</p>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-50 text-[10px] font-black text-slate-500 hover:bg-blue-50 hover:text-[#1e3a8a] transition-all uppercase tracking-wide"
                    >
                      <CheckCircle2 className="w-3 h-3" /> Mark all read
                    </button>
                  )}
                </div>

                {/* Items */}
                <div className="max-h-[360px] overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center">
                        <Bell className="w-6 h-6 text-slate-200" />
                      </div>
                      <p className="text-xs font-bold text-slate-300">No notifications yet</p>
                    </div>
                  ) : (
                    notifications.map(n => (
                      <button
                        key={n.id}
                        onClick={() => handleNotifClick(n)}
                        className={`w-full flex items-start gap-3 px-5 py-4 text-left border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors ${!n.read ? "bg-blue-50/40" : ""}`}
                      >
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                          n.type === "deo_request" ? "bg-amber-50" :
                          n.type === "risk_alert"  ? "bg-rose-50"  :
                          "bg-blue-50"
                        }`}>
                          <NotifIcon type={n.type} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-black text-[#1e293b] truncate">{n.title}</p>
                            {!n.read && (
                              <span className="w-2 h-2 rounded-full bg-[#1e3a8a] shrink-0" />
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 font-medium mt-0.5 leading-relaxed line-clamp-2">{n.body}</p>
                          <p className="text-[10px] text-slate-300 font-bold mt-1 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" /> {timeAgo(n.ts)}
                          </p>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                {/* Footer */}
                {notifications.length > 0 && (
                  <div className="px-5 py-3 border-t border-slate-50">
                    <button
                      onClick={() => { setBellOpen(false); navigate("/risks"); }}
                      className="w-full text-center text-[11px] font-black text-[#1e3a8a] hover:text-blue-700 transition-colors uppercase tracking-widest"
                    >
                      View all alerts →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="hidden md:block w-px h-7 bg-slate-200" />

          {/* Name + role */}
          <div className="hidden md:flex flex-col leading-tight max-w-[200px]">
            <p className="text-sm font-bold text-slate-800 truncate">
              {schoolData?.ownerName || "School Chairman"}
            </p>
            <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase truncate">
              {schoolData?.role || "Owner"}
            </p>
          </div>

          {/* Circular avatar */}
          <button
            onClick={() => navigate("/settings")}
            className="w-9 h-9 rounded-full bg-[#1e294b] text-white flex items-center justify-center text-[11px] font-bold shadow-lg shadow-slate-900/10 hover:scale-105 active:scale-95 transition-all cursor-pointer uppercase"
            title="Account settings"
          >
            {getInitials(schoolData?.ownerName)}
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            title="Sign out"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-rose-500 hover:bg-rose-50 transition-all"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Body: Sidebar + Page Content ─────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-[280px] bg-white border border-slate-100 flex flex-col shrink-0
        rounded-r-3xl shadow-[0_4px_24px_rgba(0,16,64,.06)]
        transition-all duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-auto lg:my-3 lg:ml-3 lg:rounded-3xl
        ${isSidebarOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"}
      `}>
        <div className="flex items-center justify-end px-3 py-3 lg:hidden">
          <button
            className="p-2 text-slate-400 hover:text-[#1e3a8a] transition-colors"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {navSections.map((section, idx) => (
            <div key={section.heading} className={idx === 0 ? "" : "mt-5"}>
              <p className="px-4 mb-2 text-[10px] font-bold text-slate-400 tracking-widest uppercase">
                {section.heading}
              </p>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) => `
                      flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
                      ${isActive
                        ? "bg-[#EEF4FF] text-[#1e3a8a] font-bold"
                        : "text-slate-500 hover:bg-slate-50 hover:text-[#1e3a8a]"
                      }
                    `}
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={`w-[18px] h-[18px] ${isActive ? "text-[#1e3a8a]" : "text-slate-400"}`} />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-slate-100">
          <NavLink
            to={settingsItem.to}
            className={({ isActive }) => `
              flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
              ${isActive
                ? "bg-[#EEF4FF] text-[#1e3a8a] font-bold"
                : "text-slate-500 hover:bg-slate-50 hover:text-[#1e3a8a]"
              }
            `}
          >
            {({ isActive }) => (
              <>
                <settingsItem.icon className={`w-[18px] h-[18px] ${isActive ? "text-[#1e3a8a]" : "text-slate-400"}`} />
                {settingsItem.label}
              </>
            )}
          </NavLink>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-[#EEF4FF]">
        <div className="p-4 lg:px-8 lg:pt-6 lg:pb-8 mb-20 lg:mb-0">
          {children}
        </div>
      </main>
      </div>

      {/* ── Global Search Modal ─────────────────────────────────────────────── */}
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
