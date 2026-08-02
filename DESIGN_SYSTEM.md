# Mobile-First Design System

## Overview

This is a comprehensive, mobile-first design system built with CSS variables, reusable components, and consistent spacing/typography primitives.

> **This document is normative.** Every value below is the value that is
> actually declared in `src/styles/tokens.css` / `src/styles/theme.css`. If you
> find a disagreement between this file and the CSS, the CSS wins — and the
> disagreement is a bug in this file, so please fix it in the same PR. (This
> document previously documented a spacing scale, a container padding, a font
> stack, and a color palette that the app had not used for several sprints;
> agents and humans following it were writing non-conforming CSS by definition.)

---

## Core Principles

1. **Mobile-First**: All defaults optimize for mobile (320px-414px)
2. **Consistency**: Single source of truth for spacing, typography, colors
3. **Composability**: Small, focused components that work together
4. **Maintainability**: Change once, update everywhere

---

## File Structure

```
src/
├── styles/
│   ├── tokens.css         # Spacing scale (the 4px grid) — imported FIRST
│   └── theme.css          # Typography, color, radius, shadow, motion tokens
├── components/
│   ├── Container.jsx      # Horizontal padding wrapper
│   ├── Container.css
│   ├── Section.jsx        # Vertical spacing wrapper
│   └── Section.css
└── pages/
    └── [YourPage].jsx     # Use Container + Section
```

Both token files are imported once, in order, from `src/App.jsx`.

---

## Design Tokens

### Spacing Scale (tokens.css)

Spacing is a **value-named 4px grid**. The token name is the pixel value, so
there is never a question of which step a given design intends:

```css
--space-4:   4px
--space-8:   8px
--space-12: 12px
--space-16: 16px
--space-20: 20px
--space-24: 24px
--space-32: 32px
--space-40: 40px
--space-48: 48px
--space-64: 64px
```

Plus one restricted step:

```css
--space-2:   2px   /* RESTRICTED — see below */
```

**`--space-2` is for inline icon-to-text gaps only** — the space between a glyph
and the word it belongs to (a chevron after a link, a star before a rating
numeral), where 4px visibly detaches the two. Roughly 130 declarations already
do this, which is why the step exists at all. Do **not** use it for padding,
card gaps, stack rhythm, or any block-level spacing; round up to `--space-4`.

**Why value names?** The previous t-shirt scale (`xs`/`sm`/`md`/…) had no steps
at 4, 6, 10, 14, or 20px, so ~40% of the app's spacing declarations — 855 of
them — were written as raw px that bypassed the scale entirely. Naming the
grid by value closes those holes and makes off-scale values obvious on sight.

#### Back-compatible t-shirt aliases

The old names still resolve, pointed at the grid. **Every value is identical to
what it was before the grid existed**, so adopting the grid produced zero
visual change:

| Legacy alias | Resolves to | Value |
|---|---|---|
| `--spacing-xs`  | `--space-8`  | 8px |
| `--spacing-sm`  | `--space-12` | 12px |
| `--spacing-md`  | `--space-16` | 16px |
| `--spacing-lg`  | `--space-24` | 24px |
| `--spacing-xl`  | `--space-32` | 32px |
| `--spacing-2xl` | `--space-48` | 48px |
| `--spacing-3xl` | `--space-64` | 64px |

These are not deprecated with a deadline — roughly 2,000 declarations use them
and they are correct. New CSS should prefer `--space-*`, which says what it
measures.

### Container & Page Padding (theme.css)

```css
--container-padding:    20px  /* standard mobile  → var(--space-20) */
--container-padding-sm: 16px  /* <360px screens   → var(--space-16) */
--page-padding:         20px  /* → var(--space-20) */
--page-padding-desktop: 48px  /* → var(--space-48) */
```

### Typography Scale

The type scale is intentionally varied across **seven** semantic roles. Each role
defines size + line-height + weight + family + letterspacing as a single,
opinionated "voice." Avoid creating new sizes outside of this scale — pick the
role that matches the content's purpose instead.

Every role uses **DM Sans**; see [Font families](#font-families) below.

| Role | Token | Size | Line height | Weight | Letter-spacing | Use case |
|------|-------|------|-------------|--------|----------------|----------|
| **Display XL** | `--font-size-display-xl` | 36px | 1.05 | 600 | -0.02em | Screen headers ("Currently Playing", "Your Library", "Edit Profile") |
| **Display L**  | `--font-size-display-l`  | 28px | 1.10 | 600 | -0.02em | Section headers within a screen ("Trending this week") |
| **Heading**    | `--font-size-heading`    | 22px | 1.25 | 600 | -0.01em | Bottom-sheet and modal titles, stat numerals, sub-headings inside a card |
| **Title**      | `--font-size-title`      | 18px | 1.30 | 600 | 0       | Game titles in lists, card titles |
| **Body**       | `--font-size-body`       | 15px | 1.50 | 400 | 0       | Descriptions, review text, paragraph copy |
| **Caption**    | `--font-size-caption`    | 13px | 1.40 | 500 | 0       | Genre tags, timestamps, "X games" counts (muted) |
| **Label**      | `--font-size-label`      | 11px | 1.20 | 600 | +0.08em | Section labels: "TRACKERS", "DETAILS", "ABOUT" (uppercase, muted) |

**Heading (22px) is the newest role.** It exists because the scale jumped
straight from Title (18) to Display L (28), so anything that needed to read as
"bigger than a list title, smaller than a section header" hand-rolled a raw
20/21/22px `font-size`. If you are reaching for a size in that gap, use
`.text-heading` instead of inventing one.

#### Letterspacing rules

```css
--letter-spacing-display: -0.02em  /* tight, premium feel at display sizes */
--letter-spacing-heading: -0.01em  /* heading — half the display tightening */
--letter-spacing-body:    0        /* default for body and captions */
--letter-spacing-label:   0.08em   /* wide, refined feel for small uppercase */
```

#### Line heights

Line heights are paired with size so each role has a tuned, intrinsic rhythm:

```css
--line-height-display-xl: 1.05
--line-height-display-l:  1.1
--line-height-heading:    1.25
--line-height-title:      1.3
--line-height-body:       1.5
--line-height-caption:    1.4
--line-height-label:      1.2
```

#### Larger Text (accessibility)

`body[data-larger-text='true']` (Settings → Larger Text) overrides the size
tokens app-wide. Display sizes scale less aggressively so hero headers don't
blow out on small screens:

| Role | Default | Larger Text |
|---|---|---|
| Display XL | 36px | 40px |
| Display L | 28px | 32px |
| Heading | 22px | 25px |
| Title | 18px | 20px |
| Body | 15px | 17px |
| Caption | 13px | 15px |
| Label | 11px | 12px |

Because the override targets the tokens, any component using the role tokens or
`.text-*` utilities picks this up for free — another reason not to hand-roll a
raw `font-size`.

#### Share / celebration carve-out (`--share-*`)

Share cards and celebration screens do **not** use the scale above, and that is
deliberate rather than drift. They render into a fixed offscreen canvas —
1080×1350 for `BrandedShareCard`, 1080×1920 for `celebration/ShareCard` — which
`html-to-image` rasterises into an exported PNG. Those canvases are roughly 3×
the width of a phone viewport, so app-scale type would export unreadably small.

```css
--share-font-size-caption:    24px   /* footer meta, QR caption */
--share-font-size-label:      28px   /* uppercase eyebrows, stat labels */
--share-font-size-body:       32px   /* review body, subtitles */
--share-font-size-title:      40px   /* game title, watermark */
--share-font-size-heading:    52px   /* card headline */
--share-font-size-display:    80px   /* hero line */
--share-font-size-display-xl: 96px   /* primary hero numeral / headline */
--share-font-size-numeral:   160px   /* single giant stat (year in review) */
```

Rules:

- Use `--share-*` **only** inside a fixed-canvas capture target.
- Never use app `--font-size-*` / `--space-*` tokens inside a capture target,
  and never use `--share-*` in on-screen UI.
- `--share-*` is **not** scaled by Larger Text: an exported image must rasterise
  identically no matter what accessibility settings the sharer has on, or the
  same card would produce different PNGs on different devices.
- The two capture-target stylesheets are exempted from the spacing lint rule for
  the same reason (see `.stylelintrc.cjs`).

#### Font weights

```css
--font-weight-normal:    400
--font-weight-medium:    500
--font-weight-semibold:  600
--font-weight-bold:      700
```

#### Font families

**There is one typeface in this app: DM Sans.** No serif is installed, and
neither Playfair Display nor Inter is a dependency — the only font package in
`package.json` is `@fontsource/dm-sans`, imported at weights 400/500/600/700 in
`src/main.jsx`.

```css
--font-display: 'DM Sans', system-ui, -apple-system, sans-serif;
--font-body:    'DM Sans', system-ui, -apple-system, sans-serif;

/* Legacy aliases — historical names only, both resolve to DM Sans */
--font-serif: var(--font-display);
--font-sans:  var(--font-body);
```

`--font-serif` is a **historical name, not a promise**. Do not read it as "a
serif font is available here," and do not add `Georgia, serif` fallbacks to new
CSS — display headers get their character from DM Sans at weight 600 with tight
(-0.02em) tracking, not from a serif.

#### Choosing the right role

- "What is this text?" → match it to the role above, not to a pixel value.
- A screen-level page header is **Display XL**, even on small phones.
- A section header *inside* a screen ("Trending this week", "Your Stats") is **Display L**.
- A clickable card title or list item title is **Title**.
- Body copy, review text, descriptions, secondary buttons → **Body**.
- Genre tags, timestamps, "12 games" counts → **Caption** (muted color).
- All-caps section labels above grids/lists ("TRACKERS", "DETAILS") → **Label**
  (always with `text-transform: uppercase` and the wide tracking).

#### Legacy aliases

These older tokens are kept as aliases so existing CSS continues to render, but
all new code should use the canonical names above:

| Legacy token | Maps to |
|--------------|---------|
| `--font-size-display`   | `--font-size-display-xl` |
| `--font-size-hero`      | `--font-size-display-l`  |
| `--font-size-subtitle`  | `--font-size-title`      |
| `--font-size-meta`      | `--font-size-caption`    |
| `--letter-spacing-tight`  | `--letter-spacing-display` |
| `--letter-spacing-normal` | `--letter-spacing-body` |
| `--letter-spacing-wide`, `--letter-spacing-wider`, `--letter-spacing-widest` | `--letter-spacing-label` |
| `--line-height-tight`   | `--line-height-display-l` |
| `--line-height-normal`  | `--line-height-body` |
| `--line-height-relaxed` | 1.7 (no role equivalent) |

### Colors

The palette is **Deep Midnight + Cobalt Blue** — not the black/white/grey set
this document used to list. Backgrounds are navy, text is cool-white, and the
single interactive accent is cobalt.

```css
/* Backgrounds — layered depth */
--color-bg-primary:     #0a0f1f   /* deep midnight, full-page background */
--color-bg-secondary:   #131a35   /* nav surfaces */
--color-bg-tertiary:    #131a35   /* cards, panels */
--color-bg-elevated:    #1a2240   /* highest elevation */

/* Text — cool-white spectrum */
--color-text-primary:   #f0f3fa   /* near-white */
--color-text-secondary: #94a8d4   /* muted cobalt-grey */
--color-text-tertiary:  #5c6b8a   /* dim */
--color-text-muted:     #3a4a66   /* very dim */

/* Brand — cobalt */
--color-brand-primary:   #3b82f6
--color-brand-secondary: #60a5fa
--accent:                #3b82f6   /* shorthand for the interactive accent */

/* Borders & surfaces — cobalt-tinted alpha, not white alpha */
--color-border:         rgba(148, 168, 212, 0.12)
--color-border-hover:   rgba(148, 168, 212, 0.30)
--color-surface:        rgba(148, 168, 212, 0.05)
--color-surface-hover:  rgba(148, 168, 212, 0.09)

/* Status — distinct from the brand accent */
--status-success: #34d399
--status-warning: #fbbf24
--status-danger:  #f87171
```

`--color-hover-bg` does not exist; use `--color-surface-hover`.

Shorthand aliases (`--bg-base`, `--bg-surface`, `--bg-surface-2`,
`--text-primary`, `--text-secondary`, `--border-subtle`, …) exist alongside the
`--color-*` names and resolve to the same values. See `theme.css` for the full
set, including the data-viz genre palette, gradient tokens, and the per-screen
bottom-nav tints.

<a id="retired-palette"></a>

### Retired palette: orange / amber / copper

The app's original accent was warm copper/amber. **It is retired.** The accent
is cobalt, and warm hues keep drifting back into component CSS one hardcoded hex
at a time, so this is now linted rather than left as a convention — see
[Linting](#linting).

There are exactly four sanctioned warm colors, all defined as tokens in
`theme.css` and never inlined as hex in component CSS:

| Token | Value | Why it's allowed |
|---|---|---|
| `body[data-accent='copper'] --accent` | `#C8813A` | Opt-in Ambassador badge accent, user-unlocked |
| `--star` | `#f5b50a` | Rating stars — deliberate exception to the all-cobalt rule |
| `--tier-bronze` / `--tier-gold` | `#CD7F32` / `#FFD700` | Achievement tier metals, semantically fixed |
| `--status-warning` | `#fbbf24` | Warning status, plus the color-blind-mode orange swaps |

If you need a warm color for anything else, add a named token to `theme.css`
first and justify it there. Do not inline the hex.

The data-viz genre palette is also constrained: no genre token may fall in the
~0–55° hue range, so a genre chart never reads as the retired palette. See the
comment above `--genre-*` in `theme.css`.

---

<a id="linting"></a>

## Linting

Stylelint runs over `src/**/*.css`:

```bash
npm run lint            # all CSS
npm run lint:css:summary # one line per warning
```

**Everything is in warning mode.** Nothing here fails a build today; the first
pass exists to make existing drift visible and to catch new drift in review.
Once the backlog is worked down, rules can be promoted to errors and CI can gate
on `stylelint --max-warnings 0`.

Two invariants are enforced (config: `.stylelintrc.cjs`):

1. **Spacing must sit on the 4px grid.** Any off-scale px value on a
   `margin`/`padding`/`gap`/`inset`/`top`/`right`/`bottom`/`left` declaration is
   flagged. Border widths, font sizes, transforms, and element dimensions are
   not touched.
2. **No hardcoded hex outside the token files** (`color-no-hex`), plus a custom
   rule — `gametracker/no-retired-palette`, in
   `scripts/stylelint/no-retired-palette.cjs` — that specifically catches the
   retired palette. It matches the known historical hexes by name *and* analyses
   the hue of every other hex literal, flagging any saturated color in the
   red-orange → amber-gold band (10°–58°). The hue pass is the important half:
   it catches warm values nobody has seen before, which a fixed denylist never
   would.

Exemptions, all deliberate: `theme.css` and `tokens.css` are exempt from the
color rules (they are where hex is supposed to live), and the two fixed-canvas
share-card stylesheets are exempt from the spacing rule.

---

## Components

### Container

Provides consistent horizontal padding.

**Props:**
- `noPadding` - Remove horizontal padding (for full-bleed content)
- `className` - Additional CSS classes

**Usage:**

```jsx
import Container from '../components/Container'

// Standard container (16px horizontal padding)
<Container>
  <h1>My Title</h1>
  <p>Content here...</p>
</Container>

// No padding (for horizontal scrolling sections)
<Container noPadding>
  <div className="scroll-area">...</div>
</Container>
```

**CSS Structure:**
```css
.container {
  width: 100%;
  max-width: 100%;
  padding-left: var(--container-padding);
  padding-right: var(--container-padding);
}

/* Automatically reduces padding on small screens */
@media (max-width: 359px) {
  .container {
    padding-left: var(--container-padding-sm);
    padding-right: var(--container-padding-sm);
  }
}
```

---

### Section

Provides consistent vertical spacing and borders.

**Props:**
- `spacing` - 'sm' | 'md' | 'lg' | 'xl' (default: 'lg')
- `borderTop` - Add top border
- `borderBottom` - Add bottom border
- `className` - Additional CSS classes

**Spacing Mapping:**
- `sm` → 16px vertical padding (`--spacing-md`)
- `md` → 24px vertical padding (`--spacing-lg`)
- `lg` → 32px vertical padding (`--spacing-xl`)
- `xl` → 48px vertical padding (`--spacing-2xl`)

**Usage:**

```jsx
import Section from '../components/Section'

// Standard section with borders
<Section spacing="lg" borderTop borderBottom>
  <Container>
    <h2>Section Title</h2>
    <p>Content...</p>
  </Container>
</Section>

// Small section, no borders
<Section spacing="sm">
  <Container>
    <div className="compact-content">...</div>
  </Container>
</Section>
```

---

## Typography Utilities

Pre-built CSS classes that bake every property of a role (size, line-height,
weight, family, letterspacing) into a single class. Prefer these over manually
applying individual tokens:

```jsx
// Display XL — screen headers
<h1 className="text-display-xl">Currently Playing</h1>

// Display L — section headers inside a screen
<h2 className="text-display-l">Trending this week</h2>

// Heading — sheet / modal titles, sub-headings inside a card
<h3 className="text-heading">Log a Session</h3>

// Title — game titles in lists, card titles
<h3 className="text-title">Hollow Knight: Silksong</h3>

// Body — descriptions, review text
<p className="text-body">A sprawling action RPG…</p>

// Caption — timestamps, genre tags, counts
<span className="text-caption">12 games · 2 hours ago</span>

// Label — small uppercase section labels
<span className="text-label">Trackers</span>
```

Legacy classes (`text-display`, `text-subtitle`, `text-meta`) are still
available as aliases for backward compatibility but new components should
use the role-named utilities above.

---

## Spacing Utilities

Quick margin utilities:

```jsx
// Top margins
<div className="spacing-top-lg">Content with 24px top margin</div>

// Bottom margins
<div className="spacing-bottom-md">Content with 16px bottom margin</div>
```

Available: `spacing-top-[xs|sm|md|lg|xl|2xl|3xl]` and `spacing-bottom-[xs|sm|md|lg|xl|2xl|3xl]`

These utilities still use the t-shirt alias names. They resolve to the grid
(`lg` → `--space-24`, `md` → `--space-16`, and so on — see the alias table
above), so they remain correct; the names are just older than the grid.

---

## Common Patterns

### Page Layout

```jsx
function MyPage() {
  return (
    <div className="my-page">
      {/* Header with border */}
      <Section spacing="sm" borderBottom>
        <Container>
          <h1 className="text-display">Page Title</h1>
          <p className="text-meta">Subtitle or metadata</p>
        </Container>
      </Section>

      {/* Main content */}
      <Section spacing="lg">
        <Container>
          <h2 className="text-title">Section Header</h2>
          <p className="text-body">Body content goes here...</p>
        </Container>
      </Section>

      {/* Horizontal scrolling section */}
      <Section spacing="md">
        <Container>
          <h2 className="text-title">Scrolling Content</h2>
        </Container>
        <Container noPadding>
          <div className="scroll-container">
            {/* Cards that scroll horizontally */}
          </div>
        </Container>
      </Section>
    </div>
  )
}
```

### Horizontal Scrolling Area

```css
.scroll-container {
  display: flex;
  gap: var(--spacing-sm);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  
  /* Full-bleed with padding */
  padding: 0 var(--container-padding) var(--spacing-md) var(--container-padding);
  margin: 0 calc(-1 * var(--container-padding));
}

.scroll-container::-webkit-scrollbar {
  display: none;
}

/* Adjust on small screens */
@media (max-width: 359px) {
  .scroll-container {
    padding-left: var(--container-padding-sm);
    padding-right: var(--container-padding-sm);
    margin: 0 calc(-1 * var(--container-padding-sm));
  }
}
```

### Stats Grid (2x2)

```jsx
<Section spacing="md" borderTop borderBottom>
  <Container>
    <div className="stats-grid">
      <div className="stat-item">
        <div className="stat-value">42</div>
        <div className="stat-label">Played</div>
      </div>
      {/* More stats... */}
    </div>
  </Container>
</Section>
```

```css
.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-24) var(--space-16);
}

.stat-value {
  font-size: var(--font-size-heading);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  line-height: 1;
  margin-bottom: var(--space-8);
}

.stat-label {
  font-size: var(--font-size-label);
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
}
```

---

## Migration Guide

### Before (inconsistent)

```jsx
// Home.jsx (old)
<div className="home">
  <div className="welcome-header">
    <h1>Welcome</h1>
  </div>
  <div className="content">
    <p>Content</p>
  </div>
</div>
```

```css
/* Home.css (old) */
.welcome-header {
  padding: 32px 20px; /* Inconsistent padding */
}

.content {
  padding: 24px 16px; /* Different padding */
}
```

### After (design system)

```jsx
// Home.jsx (new)
import Container from '../components/Container'
import Section from '../components/Section'

<div className="home">
  <Section spacing="sm" borderBottom>
    <Container>
      <h1 className="text-display">Welcome</h1>
    </Container>
  </Section>
  
  <Section spacing="lg">
    <Container>
      <p className="text-body">Content</p>
    </Container>
  </Section>
</div>
```

```css
/* Home.css (new) */
.home {
  padding-bottom: var(--bottom-nav-safe-area);
  background: var(--color-bg-primary);
}

/* No padding overrides needed - Container handles it! */
```

---

## Benefits

### ✅ Consistency
- All pages use the same 16px horizontal padding
- All sections use the same vertical spacing scale
- All typography follows the same hierarchy

### ✅ Maintainability
- Change padding globally: update `--container-padding`
- Change spacing: update `--spacing-lg`
- Change colors: update color tokens

### ✅ Responsiveness
- Automatic padding reduction on small screens (<360px)
- No media query duplication

### ✅ Readability
- Clear component boundaries
- Self-documenting code (`<Section spacing="lg">` is clearer than `padding: 32px 0`)

---

## Checklist for New Pages

When creating a new page:

1. ✅ Import `Container` and `Section`
2. ✅ Use `Section` for vertical spacing
3. ✅ Use `Container` for horizontal padding
4. ✅ Use spacing tokens for custom styles (`var(--space-16)`) — stay on the 4px grid
5. ✅ Use typography utilities (`text-heading`, `text-title`, `text-body`, etc.)
6. ✅ Use color tokens — no hardcoded hex, and nothing orange/amber/copper
7. ✅ For horizontal scrolling: use `<Container noPadding>`
8. ✅ Test at 320px, 375px, 414px widths
9. ✅ Run `npm run lint` and don't add new warnings

---

## Migration status

Every screen now uses the token system for color and typography. What is *not*
yet migrated is spacing: roughly 855 declarations (~40% of all spacing in the
app) are still raw px rather than tokens, a backlog created by the holes in the
old t-shirt scale. Those are exactly what `npm run lint` reports.

Migrating them is intentionally a separate effort from introducing the grid, so
that adding the grid could ship with a provable zero-pixel diff. When you touch
a file for other reasons, converting its off-scale values is welcome — just keep
it in its own commit so the visual diff stays reviewable.

Also outstanding, and tracked as separate commits:

- **Radius retune** — the approved 3→4, 6→8, 10→12, 14→16, 18→24 change
  (`--radius-chip` stays 4px). Held back because it repaints every tokenized
  surface in the app.
- **Review card consolidation** — see the note in `.cursorrules`.

---

## Quick Reference Card

| Need | Use |
|------|-----|
| Horizontal padding | `<Container>` |
| Remove padding (full-bleed) | `<Container noPadding>` |
| Vertical spacing | `<Section spacing="lg">` |
| Top/bottom borders | `<Section borderTop borderBottom>` |
| Screen header | `text-display-xl` (36px, 600, tight) |
| Section header | `text-display-l` (28px, 600, tight) |
| Sheet / modal title | `text-heading` (22px, 600) |
| Card / list title | `text-title` (18px, 600) |
| Body text | `text-body` (15px, 400) |
| Captions / metadata | `text-caption` (13px, 500, muted) |
| Uppercase labels | `text-label` (11px, 600, +0.08em tracking, muted) |
| Icon-to-text gap | `var(--space-2)` (2px, restricted) |
| Tight spacing | `var(--space-8)` (8px) |
| Standard spacing | `var(--space-16)` (16px) |
| Section spacing | `var(--space-24)` (24px) |
| Major breaks | `var(--space-48)` (48px) |
| A warm/orange color | Nothing — the palette is retired. See [Retired palette](#retired-palette). |

---

## Support

- See `src/styles/tokens.css` for the spacing grid
- See `src/styles/theme.css` for every other token (type, color, radius, shadow, motion)
- See `.stylelintrc.cjs` and `scripts/stylelint/no-retired-palette.cjs` for what is linted
- See `src/components/Container.jsx` for Container API
- See `src/components/Section.jsx` for Section API
- See `src/pages/Home.jsx` for real-world usage examples
