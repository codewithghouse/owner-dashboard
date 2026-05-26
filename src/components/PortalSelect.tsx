/**
 * PortalSelect — a custom <select> replacement whose menu is rendered via
 * createPortal to document.body, so it escapes ancestor CSS transforms
 * (the project-wide `ownerFadeSlideIn` translateY animation + `dash3d`
 * cards create containing blocks that mis-position native `appearance:none`
 * selects, causing dropdowns to open upward or off-screen).
 *
 * Auto-flips: opens downward by default, upward if there isn't enough
 * room below. Closes on outside-click, Escape, or selection.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { B1, T1, T3, T4 } from "@/lib/dashboardTokens";

export interface PortalSelectOption {
  value: string;
  label: React.ReactNode;
}

interface PortalSelectProps {
  value: string;
  options: PortalSelectOption[];
  onChange: (v: string) => void;
  leftIcon?: React.ReactNode;
  placeholder?: string;
  fontSize?: number;
  minWidth?: number | string;
  width?: number | string;
}

export function PortalSelect({
  value,
  options,
  onChange,
  leftIcon,
  placeholder = "Select…",
  fontSize = 12,
  minWidth,
  width = "100%",
}: PortalSelectProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find(o => o.value === value);
  const displayLabel: React.ReactNode = selected ? selected.label : placeholder;

  const measure = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuHeight = Math.min(options.length * 40 + 12, 280);
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < menuHeight + 16 && r.top > menuHeight + 16;
    setRect({ top: openUp ? r.top - 6 : r.bottom + 6, left: r.left, width: r.width, openUp });
  };

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onScrollOrResize = () => measure();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width, minWidth,
          display: "flex", alignItems: "center", gap: 8,
          padding: leftIcon ? "10px 36px 10px 36px" : "10px 36px 10px 14px",
          borderRadius: 12, position: "relative",
          border: "0.5px solid rgba(0,85,255,.14)", background: "#F5F9FF",
          fontSize, color: T3, outline: "none", fontFamily: "inherit",
          cursor: "pointer", textAlign: "left",
        }}
        className="td-tab"
      >
        {leftIcon && (
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", pointerEvents: "none" }}>
            {leftIcon}
          </span>
        )}
        <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayLabel}</span>
        <ChevronDown
          size={14} color={T4}
          style={{ position: "absolute", right: 12, top: "50%", transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`, transition: "transform .15s", pointerEvents: "none" }}
        />
      </button>
      {open && rect && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: rect.openUp ? undefined : rect.top,
            bottom: rect.openUp ? window.innerHeight - rect.top : undefined,
            left: rect.left, width: rect.width,
            background: "#fff", borderRadius: 12,
            border: "0.5px solid rgba(0,85,255,.14)",
            boxShadow: "0 12px 32px rgba(0,30,90,.18), 0 2px 6px rgba(0,30,90,.08)",
            maxHeight: 280, overflowY: "auto",
            zIndex: 9999, padding: 6,
          }}
        >
          {options.map(opt => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  width: "100%", textAlign: "left",
                  padding: "9px 12px", borderRadius: 8, border: "none",
                  background: isSelected ? "rgba(0,85,255,.10)" : "transparent",
                  color: isSelected ? B1 : T1,
                  fontSize, fontFamily: "inherit", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                }}
                className="td-tab"
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,85,255,.05)"; }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
