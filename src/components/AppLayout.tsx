import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, GraduationCap, BookOpen,
  DollarSign, AlertTriangle, GitBranch, FileText, Settings, LifeBuoy,
  Menu, X, UserCog, LogOut, ShieldCheck, Bell,
  Clock, ShieldAlert, CheckCircle2, DollarSign as FeeIcon,
  Activity, Brain, ClipboardList, FileSpreadsheet, Trophy, Award,
  MessageSquare,
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  doc, getDoc, collection, query, where,
  onSnapshot, orderBy, limit
} from "firebase/firestore";
import { signOut, onAuthStateChanged } from "firebase/auth";
import SearchModal from "@/components/SearchModal";
import MobileTabBar from "@/components/MobileTabBar";

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
      { to: "/principal-notes",     label: "Principal Notes",      icon: MessageSquare },
      { to: "/principal-leaderboard", label: "Principal Leaderboard", icon: Trophy },
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
  {
    heading: "Support",
    items: [
      { to: "/help", label: "Help & Support", icon: LifeBuoy },
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
  const isMobile   = useIsMobile();

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
    <div className="flex flex-col h-svh min-h-svh overflow-hidden font-sans bg-[#EEF4FF]">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden transition-all duration-300 animate-in fade-in"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Floating close (X) button — rendered via React Portal directly
          into document.body. Zero CSS class dependencies, everything
          inline so no global rule (.dash-card, button:active scale,
          tilt3D containing blocks) can interfere. Mounted whenever the
          mobile/tablet sidebar can show (< lg breakpoint = 1024px). */}
      {createPortal(
        <button
          type="button"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="Close sidebar"
          style={{
            position: "fixed",
            top: "max(env(safe-area-inset-top), 18px)",
            left: 240,
            width: 44,
            height: 44,
            zIndex: 2147483647,
            border: "none",
            borderRadius: 10,
            background: "#f1f5f9",
            color: "#334155",
            display: isSidebarOpen ? "inline-flex" : "none",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            touchAction: "manipulation",
            WebkitTapHighlightColor: "rgba(59,91,219,0.18)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
        >
          <X size={20} strokeWidth={2.25} />
        </button>,
        document.body
      )}

      {/* Mobile Sidebar Drawer — `dash-card` opts out of the global
          .bg-white[rounded-]:not(.dash-card) rule that overrides `fixed`
          with `position: relative`, which would otherwise push the header
          and content below the viewport on mobile (blank dashboard). */}
      <aside className={`
        dash-card fixed inset-y-0 left-0 z-50 w-[300px] bg-white flex flex-col shrink-0
        rounded-r-3xl shadow-[0_8px_48px_rgba(0,16,64,0.22)] transition-transform duration-300 ease-in-out lg:hidden
        ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        {/* ── Branded Header ── */}
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }} className="safe-top">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img
                src="/edullent-icon.png"
                alt="Edullent"
                style={{ width: 40, height: 40, borderRadius: 12, objectFit: "contain", boxShadow: "0 4px 12px rgba(0,16,64,0.18)" }}
                draggable={false}
              />
              <div>
                <p style={{ fontSize: 15, fontWeight: 800, color: "#1e294b", letterSpacing: "-0.3px", margin: 0, textTransform: "uppercase" }}>
                  {getSchoolCode(schoolData?.schoolName) || "EDULLENT"}
                </p>
                <p style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase", margin: "2px 0 0" }}>
                  Owner Dashboard
                </p>
              </div>
            </div>
            {/* Spacer reserves layout space for the X button. The actual
                button is rendered OUTSIDE the <aside> at z-9999 to bypass
                this sidebar's transition + stacking context, which kept
                eating the click on mobile despite multiple attempts. */}
            <div style={{ width: 44, height: 44, flexShrink: 0, marginLeft: 8 }} aria-hidden="true" />
          </div>
        </div>

        {/* ── Nav Items ── */}
        <nav style={{ flex: 1, overflowY: "auto", padding: "12px 12px", overscrollBehavior: "contain" }}>
          {navSections.map((section, idx) => (
            <div key={section.heading} style={{ marginTop: idx === 0 ? 0 : 20 }}>
              <p style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 6px", padding: "0 10px" }}>
                {section.heading}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    onClick={() => setIsSidebarOpen(false)}
                    style={({ isActive }) => ({
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "11px 14px",
                      borderRadius: 12,
                      fontSize: 14,
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? "#fff" : "#374151",
                      background: isActive ? "#1e3a8a" : "transparent",
                      textDecoration: "none",
                      transition: "all 0.18s ease",
                    })}
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon style={{ width: 18, height: 18, color: isActive ? "#fff" : "#6b7280", flexShrink: 0 }} />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}

          {/* Settings at bottom of nav */}
          <div style={{ marginTop: 20, borderTop: "1px solid #f1f5f9", paddingTop: 12 }}>
            <NavLink
              to={settingsItem.to}
              onClick={() => setIsSidebarOpen(false)}
              style={({ isActive }) => ({
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 14px",
                borderRadius: 12,
                fontSize: 14,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? "#fff" : "#374151",
                background: isActive ? "#1e3a8a" : "transparent",
                textDecoration: "none",
                transition: "all 0.18s ease",
              })}
            >
              {({ isActive }) => (
                <>
                  <settingsItem.icon style={{ width: 18, height: 18, color: isActive ? "#fff" : "#6b7280", flexShrink: 0 }} />
                  {settingsItem.label}
                </>
              )}
            </NavLink>
          </div>
        </nav>

        {/* ── User Info + Sign Out ── */}
        <div style={{ borderTop: "1px solid #f1f5f9", padding: "14px 16px", flexShrink: 0, paddingBottom: "max(14px, env(safe-area-inset-bottom))" }}>
          {/* User card */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: "50%",
              background: "linear-gradient(135deg, #1e294b 0%, #1e3a8a 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 800, color: "#fff", flexShrink: 0,
              boxShadow: "0 4px 12px rgba(30,58,138,0.25)"
            }}>
              {getInitials(schoolData?.ownerName)}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {schoolData?.ownerName || "School Owner"}
              </p>
              <p style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", margin: "2px 0 0", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {schoolData?.role || "Owner"}
              </p>
            </div>
          </div>

          {/* Sign Out */}
          <button
            onClick={handleLogout}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 700,
              color: "#ef4444",
              background: "#fff5f5",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "background 0.15s ease",
            }}
          >
            <LogOut style={{ width: 16, height: 16 }} />
            Sign Out
          </button>
        </div>
      </aside>



      {/* ── Top Header (floating) ─────────────────────────────────────── */}
      <header className="dash-card min-h-14 lg:min-h-16 safe-top bg-white flex items-center justify-between px-4 lg:px-6 shrink-0 z-30 gap-4 mx-3 mt-3 rounded-2xl border border-slate-100 shadow-[0_4px_24px_rgba(0,16,64,.06)]">
        {/* Mobile menu button + School identifier */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            className="p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-xl lg:hidden transition-colors shrink-0"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="w-6 h-6" />
          </button>
          <img
            src="/edullent-icon.png"
            alt="Edullent"
            className="w-8 h-8 rounded-xl object-contain shadow-lg shadow-blue-900/10 shrink-0"
            draggable={false}
          />
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
              className="relative w-11 h-11 sm:w-9 sm:h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center hover:bg-slate-100 transition-all"
            >
              <Bell className="w-4 h-4 text-slate-500" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />
              )}
            </button>

            {/* ── Notification panel ── */}
            {bellOpen && (
              <>
                {/* Full-screen backdrop — closes on tap outside */}
                <div
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 998,
                    background: isMobile ? "rgba(0,0,0,0.18)" : "transparent",
                  }}
                  onClick={() => setBellOpen(false)}
                />

                {/* Panel */}
                <div
                  style={{
                    position: isMobile ? "fixed" : "absolute",
                    // Mobile: stretch edge-to-edge, 12px from each side, just below header
                    ...(isMobile ? {
                      left: 12,
                      right: 12,
                      top: 78,
                      width: "auto",
                    } : {
                      // Desktop: drop down from bell button, right-aligned, fixed width
                      right: 0,
                      top: "calc(100% + 8px)",
                      width: 340,
                    }),
                    zIndex: 999,
                    background: "#fff",
                    borderRadius: 20,
                    boxShadow: "0 8px 32px rgba(15,23,42,0.14), 0 2px 8px rgba(15,23,42,0.06), 0 0 0 1px rgba(15,23,42,0.06)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    maxHeight: isMobile ? "calc(100svh - 100px)" : 480,
                  }}
                >
                  {/* Header */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 800, color: "#1e293b", margin: 0 }}>Notifications</p>
                      {unreadCount > 0 && (
                        <p style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500, margin: "2px 0 0" }}>{unreadCount} unread</p>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {unreadCount > 0 && (
                        <button
                          onClick={markAllRead}
                          style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 8, background: "#f8fafc", border: "none", fontSize: 10, fontWeight: 800, color: "#64748b", cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase", letterSpacing: "0.06em" }}
                        >
                          <CheckCircle2 style={{ width: 12, height: 12 }} /> Mark all read
                        </button>
                      )}
                      <button
                        onClick={() => setBellOpen(false)}
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, background: "#f8fafc", border: "none", cursor: "pointer", color: "#94a3b8" }}
                        aria-label="Close"
                      >
                        <X style={{ width: 16, height: 16 }} />
                      </button>
                    </div>
                  </div>

                  {/* Items */}
                  <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain" }}>
                    {notifications.length === 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 20px", gap: 12 }}>
                        <div style={{ width: 48, height: 48, borderRadius: 16, background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Bell style={{ width: 22, height: 22, color: "#cbd5e1" }} />
                        </div>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#cbd5e1", margin: 0 }}>No notifications yet</p>
                        <p style={{ fontSize: 11, color: "#e2e8f0", margin: 0 }}>You’re all caught up!</p>
                      </div>
                    ) : (
                      notifications.map(n => (
                        <button
                          key={n.id}
                          onClick={() => handleNotifClick(n)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            padding: "14px 20px",
                            textAlign: "left",
                            borderBottom: "1px solid #f8fafc",
                            background: !n.read ? "rgba(239,246,255,0.6)" : "transparent",
                            border: "none",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            transition: "background 0.15s ease",
                          }}
                        >
                          <div style={{
                            width: 36, height: 36, borderRadius: 10, flexShrink: 0, marginTop: 2,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: n.type === "deo_request" ? "#fffbeb" : n.type === "risk_alert" ? "#fff1f2" : "#eff6ff",
                          }}>
                            <NotifIcon type={n.type} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                              <p style={{ fontSize: 12, fontWeight: 800, color: "#1e293b", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title}</p>
                              {!n.read && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1e3a8a", flexShrink: 0 }} />}
                            </div>
                            <p style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, margin: "3px 0 0", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{n.body}</p>
                            <p style={{ fontSize: 10, color: "#cbd5e1", fontWeight: 700, margin: "4px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
                              <Clock style={{ width: 10, height: 10 }} /> {timeAgo(n.ts)}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  {/* Footer */}
                  {notifications.length > 0 && (
                    <div style={{ padding: "12px 20px", borderTop: "1px solid #f1f5f9", flexShrink: 0 }}>
                      <button
                        onClick={() => { setBellOpen(false); navigate("/risks"); }}
                        style={{ width: "100%", textAlign: "center", fontSize: 11, fontWeight: 800, color: "#1e3a8a", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase", letterSpacing: "0.1em" }}
                      >
                        View all alerts →
                      </button>
                    </div>
                  )}
                </div>
              </>
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
            className="w-11 h-11 sm:w-9 sm:h-9 rounded-full bg-[#1e294b] text-white flex items-center justify-center text-[11px] font-bold shadow-lg shadow-slate-900/10 hover:scale-105 active:scale-95 transition-all cursor-pointer uppercase"
            title="Account settings"
          >
            {getInitials(schoolData?.ownerName)}
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            title="Sign out"
            className="w-11 h-11 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-rose-500 hover:bg-rose-50 transition-all"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Body: Sidebar + Page Content ─────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0 min-w-0">

      {/* Desktop Sidebar */}
      <aside className="
        dash-card hidden lg:flex flex-col shrink-0 w-[280px] bg-white border border-slate-100
        my-3 ml-3 rounded-3xl shadow-[0_4px_24px_rgba(0,16,64,.06)]
      ">
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {navSections.map((section, idx) => (
            <div key={section.heading} className={idx === 0 ? "" : "mt-5"}>
              <p className="px-4 mb-2 text-[10px] font-bold text-black tracking-widest uppercase">
                {section.heading}
              </p>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) => `
                      flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all duration-200 text-black
                      ${isActive
                        ? "bg-[#EEF4FF]"
                        : "hover:bg-slate-50"
                      }
                    `}
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={`w-[18px] h-[18px] ${isActive ? "text-[#1e3a8a]" : "text-black"}`} />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-slate-100 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <NavLink
            to={settingsItem.to}
            className={({ isActive }) => `
              flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all duration-200 text-black
              ${isActive
                ? "bg-[#EEF4FF]"
                : "hover:bg-slate-50"
              }
            `}
          >
            {({ isActive }) => (
              <>
                <settingsItem.icon className={`w-[18px] h-[18px] ${isActive ? "text-[#1e3a8a]" : "text-black"}`} />
                {settingsItem.label}
              </>
            )}
          </NavLink>
        </div>
      </aside>


      {/* Main */}
      <main className="flex-1 overflow-y-auto overflow-x-clip bg-[#EEF4FF] min-w-0 w-full">
        <div className="p-4 lg:px-8 lg:pt-6 lg:pb-8 mb-[calc(5rem+env(safe-area-inset-bottom))] lg:mb-0 max-w-full box-border">
          {children}
        </div>
      </main>
      </div>

      {/* ── Mobile bottom tab bar ───────────────────────────────────────────── */}
      <MobileTabBar onMoreClick={() => setIsSidebarOpen(true)} />

      {/* ── Global Search Modal ─────────────────────────────────────────────── */}
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
