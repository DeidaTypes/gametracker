# Motion System

## Sprint 3 motion verification

Audit performed across all 8 user-facing screens (Home, Explore, Search,
Library, Profile, Game Detail, Create New List modal, Write Review modal)
plus shared chrome (top nav, bottom nav, page transitions, shared-element
cover flight). Both `prefers-reduced-motion` ON and OFF were exercised.

### Reduced-motion fixes applied

1. **AutoAnimate hooks did not respect `prefers-reduced-motion`.** AutoAnimate
   uses the Web Animations API directly, which bypasses our global
   `_motion.css` `transition-duration: 0.01ms` fallback. The 5 callsites
   (`src/pages/Library.jsx`, `src/pages/Search.jsx`,
   `src/pages/ListDetail.jsx`, `src/pages/CurrentlyPlaying.jsx`,
   `src/components/CreateListModal.jsx`) all called bare `useAutoAnimate()`
   so list reorders animated even with the OS toggle on.
   **Fix:** added `useAutoAnimateMotion(options?)` to
   `src/hooks/useMotionPreference.js`. It wraps `useAutoAnimate` and forces
   `duration: 0` when `useReducedMotion()` is true, otherwise honours the
   caller's `duration` (default 250 ms). All 5 callsites now use the
   wrapper. Functional behaviour is preserved (items still appear / sort /
   remove in the right order); only the in-between motion is collapsed.

2. **9 components had motion-only `:active` feedback that disappeared
   entirely under reduced motion.** Each card / button defined its press
   feedback exclusively as `transform: scale(0.97 / 0.98)`. The
   per-component `@media (prefers-reduced-motion: reduce)` block correctly
   removed the transform, but did not replace it with a non-motion
   alternative — so taps registered no visible feedback at all on touch
   devices (where `:hover` never fires). Acceptance criterion failed:
   "if the user can't see scale, they need a color or border change
   instead." The global `theme.css` rule (lines 633–637) compounds this by
   stripping every `button:active { transform }` regardless of where it's
   defined.
   **Fix:** added a non-motion `:active` rule inside the reduced-motion
   media query of each affected stylesheet. Choice of feedback is contextual
   (brand-colored border accent on covers, surface flash on flat buttons,
   filled background on primary actions). Files updated:
   - `src/components/GameCard.css` — brand border on cover container
   - `src/components/LibraryGameCard.css` — brand border on cover container
   - `src/components/WantToPlayCard.css` — surface flash + brand border
   - `src/components/PrimaryCard.css` — brand border accent
   - `src/components/CurrentlyPlayingCarousel.css` — surface flash + brand border
   - `src/components/explore/TrendingCard.css` — brand-color cover ring
   - `src/components/explore/JustFinishedCard.css` — brand-color cover ring
   - `src/components/explore/NewReleaseCard.css` — brand-color cover ring
   - `src/components/forms/forms.css` — surface flash on `--primary`,
     `--secondary`, `--destructive` button variants
   - `src/pages/GameDetail.css` — brand-tint flash on `gd-glass-btn`
     (back) and `gd-action-circle` (share / review / add)
   - `src/components/CreateListModal.css` — surface flash on
     `modal-close-button`, `result-game-add-btn`, `selected-game-thumb__remove`

### Items verified OK without changes

The following motion paths were reviewed and already comply with
reduced-motion (either via Motion's built-in `useReducedMotion` integration
or via existing per-component CSS overrides):

- Page-level cross-fade + 8 px slide (`PageTransition`) — `xIn` zeroed
  and `fadeOnly` collapsed to 120 ms when reduced.
- Shared-element cover flight (`SharedCover`) — transition object falls
  back to `{ duration: 0.12 }` cross-fade.
- BottomNav iOS-26 shrink-on-scroll layout spring + label fade — both
  branches replaced with `{ duration: 0 }` when reduced; the compact /
  expanded state still toggles instantly so the functional behaviour is
  preserved.
- Game Detail status puck (`layoutId` flight between status pills) —
  `motionPrefs.transition` and opacity transitions both collapse to
  zero-duration.
- Game Detail dominant-color backdrop fade — short 280 ms opacity that
  is killed by the global `_motion.css` rule (it's a `motion.div` so
  `useReducedMotion` would also catch it, but verified visually).
- Profile tab switch (`activeTab`) is a pure className change with no
  animation; the active indicator is a brand-color text + underline so
  it works identically under both modes.
- Toast slide-in / slide-out (`Toast.css`) and ActionSheet slide-up
  (`ActionSheet.css`) both define `animation: none` under reduced motion;
  the toast still auto-dismisses on its timer so functional behaviour
  is preserved.
- Skeletons — shimmer animation is killed via `theme.css` reduced-motion
  block. Skeletons still display, just statically.

### Perf optimizations applied

**None.** The 10-second profiling session covered: page transitions
(Library → Home → Game Detail → Library → Explore), one shared-element
cover flight (Home Currently Playing → Game Detail), Library scroll, and
opening the Create List modal. Results from the captured CPU profile
(`~/.cursor/browser-logs/cpu-profile-2026-05-02T21-14-14-864Z-0pfg1x.json`):

| Metric | Value |
|---|---|
| CPU utilisation | 0.7 % active, 99.3 % idle |
| Animation total (`animateMotionValue`) | 1.4 ms (0.2 %) |
| DOM / Layout total | 31.8 ms (4.4 %) |
| Long tasks (> 50 ms) | none |
| Top hot path | `measureScroll` (Motion's `useScroll`) — 18.8 ms across the entire session, 0.02 % |

No layout thrash detected. The shared-element flight does not appear in
the hot-function table at all, which means it stayed in the GPU
compositor as expected (transform + opacity only). 60 fps target was
held throughout.

Note: the local Library only contains ~15 games during this audit, so the
"60+ games" Library-scroll stress case from the brief was not
reproducible. The suggested fallback (narrowing the `layoutId` scope to
just the cover image, or virtualising the visible viewport for 200+
games) remains unnecessary at the current scale; revisit if a real user
reports Library jank.

---

This document defines the animation strategy for GameTracker.

## Libraries

### Motion (`motion`) — canonical animation library
- Package: [`motion`](https://motion.dev) (Framer Motion's successor, v12+)
- Import from `motion/react` for React components
- Use for: entrance/exit animations, layout transitions, gesture-driven interactions, scroll-linked effects, and any per-element animation
- Example:
  ```jsx
  import { motion, AnimatePresence } from "motion/react";

  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.25 }}
  />
  ```

### AutoAnimate (`@formkit/auto-animate`) — list reorder only
- Package: [`@formkit/auto-animate`](https://auto-animate.formkit.com) (v0.9+)
- Import `useAutoAnimate` from `@formkit/auto-animate/react`
- Use **only** for lists that have items added, removed, or reordered (e.g. Library sort, drag-reorder of custom lists). The hook attaches to a parent element and handles DOM diffing automatically
- Do **not** use it for anything Motion can already handle cleanly
- Example:
  ```jsx
  import { useAutoAnimate } from "@formkit/auto-animate/react";

  const [listRef] = useAutoAnimate();
  return <ul ref={listRef}>{items.map(...)}</ul>;
  ```

## Excluded libraries

| Library | Reason not added |
|---|---|
| **GSAP** | Two libraries are sufficient; GSAP adds significant bundle weight and a license consideration |
| **React Spring** | Redundant with Motion; physics-spring animations can be achieved via Motion's `spring` transition type |

Do not add new animation libraries without updating this document and getting team agreement.

## PR Checklist

Every `<motion.*>` component or CSS animation must source its transition from `useMotionPreference()` or be safe under the global reduced-motion rule. No exceptions.

## Accessibility

All animations must respect `prefers-reduced-motion`. With Motion this is handled automatically when using `AnimatePresence` and `motion` elements — the library reads the media query. For AutoAnimate, pass `{ duration: 0 }` when the user prefers reduced motion:

```jsx
import { useAutoAnimate } from "@formkit/auto-animate/react";

const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const [listRef] = useAutoAnimate({ duration: prefersReduced ? 0 : 250 });
```
