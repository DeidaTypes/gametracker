# Mobile-First Design System

## Overview

This is a comprehensive, mobile-first design system built with CSS variables, reusable components, and consistent spacing/typography primitives.

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
│   └── theme.css          # Design tokens (spacing, typography, colors)
├── components/
│   ├── Container.jsx      # Horizontal padding wrapper
│   ├── Container.css
│   ├── Section.jsx        # Vertical spacing wrapper
│   └── Section.css
└── pages/
    └── [YourPage].jsx     # Use Container + Section
```

---

## Design Tokens (theme.css)

### Spacing Scale

```css
--spacing-xs:   8px
--spacing-sm:  12px
--spacing-md:  16px
--spacing-lg:  24px
--spacing-xl:  32px
--spacing-2xl: 40px
--spacing-3xl: 48px
```

**Usage:**
- `xs/sm` - tight internal spacing (gaps between tags, list items)
- `md` - standard internal spacing (margins between related elements)
- `lg` - section spacing (between groups)
- `xl/2xl/3xl` - major section breaks

### Container Padding

```css
--container-padding:    16px  /* standard mobile */
--container-padding-sm: 12px  /* <360px screens */
```

### Typography Scale

The type scale is intentionally varied across six semantic roles. Each role defines
size + line-height + weight + family + letterspacing as a single, opinionated
"voice." Avoid creating new sizes outside of this scale — pick the role that
matches the content's purpose instead.

| Role | Token | Size | Line height | Weight | Family | Letter-spacing | Use case |
|------|-------|------|-------------|--------|--------|----------------|----------|
| **Display XL** | `--font-size-display-xl` | 36px | 1.05 | 700 | serif | -0.02em | Screen headers ("Currently Playing", "Your Library", "Edit Profile") |
| **Display L**  | `--font-size-display-l`  | 28px | 1.10 | 700 | serif | -0.02em | Section headers within a screen ("Trending this week") |
| **Title**      | `--font-size-title`      | 18px | 1.30 | 600 | sans  | 0       | Game titles in lists, card titles |
| **Body**       | `--font-size-body`       | 15px | 1.50 | 400 | sans  | 0       | Descriptions, review text, paragraph copy |
| **Caption**    | `--font-size-caption`    | 13px | 1.40 | 500 | sans  | 0       | Genre tags, timestamps, "X games" counts (muted) |
| **Label**      | `--font-size-label`      | 11px | 1.20 | 600 | sans  | +0.08em | Section labels: "TRACKERS", "DETAILS", "ABOUT" (uppercase, muted) |

#### Letterspacing rules

```css
--letter-spacing-display: -0.02em  /* tight, premium feel for serif display */
--letter-spacing-body:    0         /* default for body and captions */
--letter-spacing-label:   0.08em   /* wide, refined feel for small uppercase */
```

#### Line heights

Line heights are paired with size so each role has a tuned, intrinsic rhythm:

```css
--line-height-display-xl: 1.05
--line-height-display-l:  1.1
--line-height-title:      1.3
--line-height-body:       1.5
--line-height-caption:    1.4
--line-height-label:      1.2
```

#### Font weights

```css
--font-weight-normal:    400
--font-weight-medium:    500
--font-weight-semibold:  600
--font-weight-bold:      700
```

#### Font families

```css
--font-serif: 'Playfair Display', Georgia, serif;  /* Display XL & Display L */
--font-sans:  'Inter', system-ui, sans-serif;       /* Title, Body, Caption, Label */
```

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
| `--letter-spacing-tight`, `--letter-spacing-normal` | `--letter-spacing-display` |
| `--letter-spacing-wide` | `--letter-spacing-body` |
| `--letter-spacing-wider`, `--letter-spacing-widest` | `--letter-spacing-label` |

### Colors

```css
--color-bg-primary:     #000000
--color-bg-secondary:   #0a0a0a
--color-text-primary:   #ffffff
--color-text-secondary: #999999
--color-text-tertiary:  #666666
--color-border:         rgba(255, 255, 255, 0.06)
--color-hover-bg:       rgba(255, 255, 255, 0.03)
```

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
- `sm` → 16px vertical padding
- `md` → 24px vertical padding
- `lg` → 32px vertical padding
- `xl` → 40px vertical padding

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
  gap: var(--spacing-lg) var(--spacing-md);
}

.stat-value {
  font-size: var(--font-size-display);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  line-height: 1;
  margin-bottom: var(--spacing-xs);
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
4. ✅ Use design tokens for custom styles (`var(--spacing-md)`)
5. ✅ Use typography utilities (`text-title`, `text-body`, etc.)
6. ✅ For horizontal scrolling: use `<Container noPadding>`
7. ✅ Test at 320px, 375px, 414px widths

---

## Examples in Codebase

### ✅ Migrated
- **Home.jsx** - Full design system usage
- **GameDetail.jsx** - Container and Section integration

### ⏳ To Migrate
- Profile.jsx
- Reviews.jsx
- Library.jsx
- Search.jsx
- Explore.jsx

---

## Quick Reference Card

| Need | Use |
|------|-----|
| Horizontal padding | `<Container>` |
| Remove padding (full-bleed) | `<Container noPadding>` |
| Vertical spacing | `<Section spacing="lg">` |
| Top/bottom borders | `<Section borderTop borderBottom>` |
| Screen header | `text-display-xl` (36px serif, tight) |
| Section header | `text-display-l` (28px serif, tight) |
| Card / list title | `text-title` (18px sans, semibold) |
| Body text | `text-body` (15px sans, regular) |
| Captions / metadata | `text-caption` (13px sans, muted) |
| Uppercase labels | `text-label` (11px sans, +0.08em tracking, muted) |
| Tight spacing | `var(--spacing-xs)` (8px) |
| Standard spacing | `var(--spacing-md)` (16px) |
| Section spacing | `var(--spacing-lg)` (24px) |
| Major breaks | `var(--spacing-2xl)` (40px) |

---

## Support

- See `src/styles/theme.css` for all available tokens
- See `src/components/Container.jsx` for Container API
- See `src/components/Section.jsx` for Section API
- See `src/pages/Home.jsx` for real-world usage examples
