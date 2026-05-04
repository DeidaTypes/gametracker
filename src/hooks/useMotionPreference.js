import { useReducedMotion } from "motion/react";
import { useAutoAnimate } from "@formkit/auto-animate/react";

/**
 * Single source of truth for animation timings. Read `prefers-reduced-motion`
 * once and return ready-to-spread `transition` objects so every `<motion.*>`
 * element in the app collapses to a 0 ms swap when the user opts out.
 *
 * `transition`  – default spring used for layout / shared-element work
 * `fadeOnly`    – plain duration used for opacity cross-fades
 * `reduced`     – raw boolean; expose so callers can branch on it
 */
export function useMotionPreference() {
  const reduced = useReducedMotion();
  return {
    reduced: !!reduced,
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
  const reduced = useReducedMotion();
  return useAutoAnimate({
    ...options,
    duration: reduced ? 0 : (options.duration ?? 250),
  });
}
