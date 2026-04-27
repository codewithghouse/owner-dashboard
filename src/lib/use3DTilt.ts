import type React from "react";

/**
 * 3D tilt hover handlers for cards. Attach via
 * `onMouseEnter/onMouseMove/onMouseLeave`.
 *
 * On hover, the card lifts (translateY + slight scale) AND the `box-shadow`
 * intensifies into a blue halo around the card. The base `boxShadow` you
 * pass on the card is remembered on mouse-enter and restored on leave, so
 * the hover state layers on top without clobbering the at-rest shadow.
 *
 * Usage:
 *   <div {...tilt3D} style={{ boxShadow: BASE_SHADOW, ...tilt3DStyle }}>
 */
type TiltEl = HTMLElement;

const ORIGINAL_SHADOW = new WeakMap<HTMLElement, string>();

const HOVER_SHADOW =
  "0 8px 16px rgba(0,85,255,0.20)," +
  " 0 24px 40px rgba(0,85,255,0.24)," +
  " 0 40px 80px rgba(0,85,255,0.26)";

export const tilt3D = {
  onMouseEnter: (e: React.MouseEvent<TiltEl>) => {
    const el = e.currentTarget as HTMLElement;
    if (!ORIGINAL_SHADOW.has(el)) {
      ORIGINAL_SHADOW.set(el, el.style.boxShadow);
    }
    el.style.backfaceVisibility = "hidden";
    (el.style as any).webkitBackfaceVisibility = "hidden";
    el.style.transition =
      "transform 0.22s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.22s ease";
    el.style.transform = "translate3d(0,-7px,0)";
    el.style.boxShadow = HOVER_SHADOW;
  },
  onMouseMove: (_e: React.MouseEvent<TiltEl>) => {},
  onMouseLeave: (e: React.MouseEvent<TiltEl>) => {
    const el = e.currentTarget as HTMLElement;
    el.style.transition =
      "transform 0.28s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.28s ease";
    el.style.transform = "translate3d(0,0,0)";
    const orig = ORIGINAL_SHADOW.get(el);
    if (orig !== undefined) el.style.boxShadow = orig;
  },
};

export const tilt3DProfile = {
  onMouseEnter: (e: React.MouseEvent<TiltEl>) => {
    const el = e.currentTarget as HTMLElement;
    if (!ORIGINAL_SHADOW.has(el)) {
      ORIGINAL_SHADOW.set(el, el.style.boxShadow);
    }
    el.style.backfaceVisibility = "hidden";
    (el.style as any).webkitBackfaceVisibility = "hidden";
    el.style.transition =
      "transform 0.22s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.22s ease";
    el.style.transform = "translate3d(0,-7px,0)";
    el.style.boxShadow = HOVER_SHADOW;
  },
  onMouseMove: (_e: React.MouseEvent<TiltEl>) => {},
  onMouseLeave: (e: React.MouseEvent<TiltEl>) => {
    const el = e.currentTarget as HTMLElement;
    el.style.transition =
      "transform 0.28s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.28s ease";
    el.style.transform = "translate3d(0,0,0)";
    const orig = ORIGINAL_SHADOW.get(el);
    if (orig !== undefined) el.style.boxShadow = orig;
  },
};

export const tilt3DStyle = {
  transformStyle: "flat" as const,
  backfaceVisibility: "hidden" as const,
  WebkitBackfaceVisibility: "hidden" as const,
};

export const BLUE_SHADOW =
  "0 0 0 0.5px rgba(0,85,255,0.09), " +
  "0 2px 10px rgba(0,85,255,0.10), " +
  "0 10px 26px rgba(0,85,255,0.12)";

export const BLUE_SHADOW_LG =
  "0 0 0 0.5px rgba(0,85,255,0.10), " +
  "0 4px 16px rgba(0,85,255,0.12), " +
  "0 18px 44px rgba(0,85,255,0.15)";

export const BLUE_SHADOW_BTN =
  "0 5px 18px rgba(0,85,255,0.34), " +
  "0 2px 5px rgba(0,85,255,0.18)";
