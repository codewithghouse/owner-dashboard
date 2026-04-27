import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  DollarSign,
  Menu,
} from "lucide-react";

type Tab =
  | { kind: "link"; to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }
  | { kind: "action"; label: string; icon: typeof Menu; onClick: () => void; isActive?: boolean };

interface Props {
  onMoreClick: () => void;
  hidden?: boolean;
}

export default function MobileTabBar({ onMoreClick, hidden }: Props) {
  const tabs: Tab[] = [
    { kind: "link",   to: "/",                   label: "Home",     icon: LayoutDashboard, end: true },
    { kind: "link",   to: "/students",           label: "Students", icon: Users },
    { kind: "link",   to: "/teachers-directory", label: "Teachers", icon: GraduationCap },
    { kind: "link",   to: "/finance",            label: "Finance",  icon: DollarSign },
    { kind: "action", label: "More", icon: Menu, onClick: onMoreClick },
  ];

  return (
    <nav
      aria-label="Primary"
      className={`
        lg:hidden fixed bottom-0 inset-x-0 z-40
        bg-white/95 backdrop-blur-xl border-t border-slate-200/70
        shadow-[0_-4px_24px_rgba(0,16,64,.06)]
        transition-transform duration-200
        ${hidden ? "translate-y-full" : "translate-y-0"}
      `}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch justify-around px-1 pt-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;

          if (tab.kind === "action") {
            return (
              <li key={tab.label} className="flex-1">
                <button
                  onClick={tab.onClick}
                  aria-label={tab.label}
                  className="w-full flex flex-col items-center justify-center gap-0.5 py-1.5 px-1 rounded-xl text-slate-400 active:bg-slate-100 transition-colors touch-target"
                >
                  <Icon className="w-[22px] h-[22px]" strokeWidth={2} />
                  <span className="text-[10px] font-semibold leading-none tracking-tight">
                    {tab.label}
                  </span>
                </button>
              </li>
            );
          }

          return (
            <li key={tab.to} className="flex-1">
              <NavLink
                to={tab.to}
                end={tab.end}
                aria-label={tab.label}
                className={({ isActive }) => `
                  w-full flex flex-col items-center justify-center gap-0.5 py-1.5 px-1 rounded-xl
                  transition-colors touch-target
                  ${isActive
                    ? "text-[#1e3a8a]"
                    : "text-slate-400 active:bg-slate-100"
                  }
                `}
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className="w-[22px] h-[22px]"
                      strokeWidth={isActive ? 2.4 : 2}
                    />
                    <span
                      className={`text-[10px] leading-none tracking-tight ${
                        isActive ? "font-bold" : "font-semibold"
                      }`}
                    >
                      {tab.label}
                    </span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
