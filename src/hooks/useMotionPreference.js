import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { SETTINGS_CHANGED_EVENT } from "../services/userSettingsService";

/**
 * Subscribes to the in-app "Reduce motion" toggle that the Settings
 * page writes to <body data-reduce-motion="true|false">. Returns a
 * boolean that updates on every settings change so any motion
 * consumer collapses to 0 ms the moment the user flips the switch.
 *
 * Falls back to false (defer to the OS pref) until the body is
 * actually decorated.
 */
function useAppReduceMotion() {
  const [appReduce, setAppReduce] = useState(() => {
    if (typeof document === "undefined") return false;
    return document.body?.getAttribute("data-reduce-motion") === "true";
  });

  useEffect(() => {
    const handler = () => {
      setAppReduce(
        document.body?.getAttribute("data-reduce-motion") === "true"
      );
    };
    window.addEventListener(SETTINGS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, handler);
  }, []);

  return appReduce;
}

/**
 * Single source of truth for animation timings. Reads BOTH the OS-level
 * `prefers-reduced-motion` query and the in-app "Reduce motion" Settings
 * toggle. If either says "reduce", every `<motion.*>` element in the
 * app collapses to a 0 ms swap.
 *
 * `transition`  – default spring used for layout / shared-element work
 * `fadeOnly`    – plain duration used for opacity cross-fades
 * `reduced`     – raw boolean; expose so callers can branch on it
 */
export function useMotionPreference() {
  const osReduced = useReducedMotion();
  const appReduced = useAppReduceMotion();
  const reduced = !!osReduced || !!appReduced;
  return {
    reduced,
    transition: reduced
      ? { duration: 0 }
      : { type: "spring", stiffness: 320, damping: 28 },
    fadeOnly: reduced ? { duration: 0.12 } : { duration: 0.22 },
  };
}

/**
 * Drop-in replacement for `useAutoAnimate()` that respects
 * `prefers-reduced-motion`. AutoAnimate uses the Web Animations API directly
 * and bypasses the global `_motion.css` `transition-duration: 0.01ms`
 * fallback, so it must be told to use a 0 ms duration explicitly when the
 * user prefers reduced motion (per the MOTION_SYSTEM.md spec).
 *
 * Usage is identical to `useAutoAnimate`:
 *   const [listRef] = useAutoAnimateMotion()
 *   const [listRef] = useAutoAnimateMotion({ duration: 400 })
 *
 * Pass any of AutoAnimate's normal options. `duration` is overridden to 0
 * when reduced-motion is active.
 */
export function useAutoAnimateMotion(options = {}) {
  const osReduced = useReducedMotion();
  const appReduced = useAppReduceMotion();
  const reduced = !!osReduced || !!appReduced;
  return useAutoAnimate({
    ...options,
    duration: reduced ? 0 : (options.duration ?? 250),
  });
}
