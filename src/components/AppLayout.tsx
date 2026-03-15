import { useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, GraduationCap, BookOpen,
  DollarSign, AlertTriangle, GitBranch, FileText, Settings, 
  Menu, X, UserCog, LogOut
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/students", label: "Students Intelligence", icon: Users },
  { to: "/teachers", label: "Teacher Performance", icon: GraduationCap },
  { to: "/academics", label: "Academics Overview", icon: BookOpen },
  { to: "/finance", label: "Finance & Fees", icon: DollarSign },
  { to: "/risks", label: "Risks & Alerts", icon: AlertTriangle },
  { to: "/branches", label: "Branches Comparison", icon: GitBranch },
  { to: "/reports", label: "Reports Center", icon: FileText },
  { to: "/principals", label: "Principal Management", icon: UserCog },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [schoolData, setSchoolData] = useState<any>(null);
  const location = useLocation();
  
  const currentPage = navItems.find(
    (item) => item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to)
  );

  useEffect(() => {
    const fetchSchoolData = async () => {
      if (auth.currentUser) {
        const docRef = doc(db, "schools", auth.currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setSchoolData(docSnap.data());
        }
      }
    };
    fetchSchoolData();
  }, []);

  const handleLogout = () => {
    signOut(auth);
  };

  // Close sidebar on route change on mobile
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden font-sans bg-[#f8fafc]">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden transition-all duration-300 animate-in fade-in"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-[280px] bg-white border-r border-slate-100 flex flex-col shrink-0 
        transition-all duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-auto
        ${isSidebarOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"}
      `}>
        <div className="flex items-center justify-between px-6 py-8 border-b border-slate-50 lg:justify-start lg:gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#1e3a8a] rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/10 shrink-0">
              < GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-[#1e294b] tracking-tight uppercase truncate">
              {schoolData?.schoolName || "EDUINTELLECT"}
            </span>
          </div>
          <button 
            className="p-2 -mr-2 text-slate-400 hover:text-[#1e3a8a] lg:hidden transition-colors"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = item.to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `
                  flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200
                  ${isActive
                    ? "bg-[#1e3a8a] text-white shadow-lg shadow-blue-900/15"
                    : "text-slate-500 hover:bg-slate-50 hover:text-[#1e3a8a]"
                  }
                `}
              >
                <item.icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-50 space-y-2">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">System v1.0.4</p>
                <div className="h-1 w-full bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 w-3/4"></div>
                </div>
            </div>
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-rose-500 hover:bg-rose-50 transition-all"
            >
              <LogOut className="w-5 h-5" /> Logout
            </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-16 lg:h-20 bg-white/80 backdrop-blur-md flex items-center justify-between px-4 lg:px-8 shrink-0 border-b border-slate-100/60 sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <button 
              className="p-2 -ml-2 text-slate-500 hover:bg-slate-50 rounded-xl lg:hidden transition-colors"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu className="w-6 h-6" />
            </button>

            <div className="flex items-center gap-2 text-sm font-semibold overflow-hidden">
              {location.pathname.includes("/students") && location.pathname !== "/students" ? (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="text-slate-400 hidden sm:inline text-xs">Students /</span>
                  <span className="text-[#1e3a8a]">Details</span>
                </div>
              ) : location.pathname.includes("/teachers") && location.pathname !== "/teachers" ? (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="text-slate-400 hidden sm:inline text-xs">Teachers /</span>
                  <span className="text-[#1e3a8a]">Faculty Profile</span>
                </div>
              ) : location.pathname.includes("/academics") && location.pathname !== "/academics" ? (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="text-slate-400 hidden sm:inline text-xs">Academics /</span>
                  <span className="text-[#1e3a8a]">Subject Analysis</span>
                </div>
              ) : location.pathname.includes("/branches") && location.pathname !== "/branches" ? (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="text-slate-400 hidden sm:inline text-xs">Branches /</span>
                  <span className="text-[#1e3a8a]">Detail View</span>
                </div>
              ) : (
                <h2 className="text-sm font-bold text-slate-800 tracking-tight truncate">
                  {currentPage?.label || "Dashboard"}
                </h2>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-6">
            <div className="hidden sm:flex flex-col text-right">
                <p className="text-xs font-bold text-slate-800 leading-tight">
                  {schoolData?.ownerName || "School Chairman"}
                </p>
                <p className="text-[10px] font-medium text-slate-400">
                  {auth.currentUser?.email || "admin@edu.com"}
                </p>
            </div>
            <div className="flex items-center gap-3">
              <div 
                onClick={handleLogout}
                className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-[#1e294b] text-white flex items-center justify-center text-xs font-bold shadow-lg shadow-slate-900/10 hover:scale-105 active:scale-95 transition-all cursor-pointer uppercase"
              >
                {schoolData?.ownerName?.substring(0, 2) || "SC"}
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-[#f8fafc]">
          <div className="p-4 lg:p-10 mb-20 lg:mb-0">
             {children}
          </div>
        </main>
      </div>
    </div>
  );
}
