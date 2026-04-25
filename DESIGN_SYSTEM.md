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

| Token | Size | Use Case |
|-------|------|----------|
| `--font-size-display` | 32px | Page titles (h1) |
| `--font-size-title` | 20px | Section headers (h2) |
| `--font-size-subtitle` | 16px | Subsections (h3) |
| `--font-size-body` | 14px | Body text, buttons |
| `--font-size-meta` | 12px | Secondary info, timestamps |
| `--font-size-label` | 10px | Small labels (uppercase) |

### Line Heights

```css
--line-height-tight:   1.2  /* Headlines */
--line-height-normal:  1.5  /* UI text */
--line-height-relaxed: 1.7  /* Body text */
```

### Letter Spacing

```css
--letter-spacing-tight:  -0.8px  /* Display text */
--letter-spacing-normal: -0.4px  /* Titles */
--letter-spacing-wide:    0.5px  /* Labels */
--letter-spacing-wider:   0.8px  /* Uppercase labels */
```

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

Pre-built CSS classes for common typography patterns:

```jsx
// Display text (page titles)
<h1 className="text-display">Welcome to Games</h1>

// Section titles
<h2 className="text-title">Popular This Week</h2>

// Subtitles
<h3 className="text-subtitle">Featured Games</h3>

// Body text
<p className="text-body">This is readable body text...</p>

// Metadata (timestamps, secondary info)
<span className="text-meta">2 hours ago</span>

// Labels (small, uppercase)
<span className="text-label">Developer</span>
```

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
| Page title | `text-display` (32px) |
| Section header | `text-title` (20px) |
| Body text | `text-body` (14px) |
| Small labels | `text-label` (10px, uppercase) |
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
