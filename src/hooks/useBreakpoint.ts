/**
 * useBreakpoint — single source of truth for mobile / tablet / desktop
 * detection across the owner dashboard.
 *
 * rAF-throttled so the listener fires once per animation frame instead of
 * once per pixel during a drag-resize. Falls back to "desktop" during SSR
 * so initial render isn't biased toward mobile.
 *
 * Breakpoints match Tailwind defaults:
 *   < 768  → mobile
 *   < 1024 → tablet
 *   ≥ 1024 → desktop
 */
import { useEffect, useState } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop";

const get = (): Breakpoint => {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  return w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop";
};

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(get);
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setBp(get());
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return bp;
}
