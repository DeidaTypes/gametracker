# Quick Start Guide - Mobile Layout System

## 🚀 Getting Started in 60 Seconds

### 1. Import Components
```jsx
import Container from '../components/Container'
import Section from '../components/Section'
```

### 2. Basic Page Structure
```jsx
function MyPage() {
  return (
    <div className="my-page">
      {/* Header */}
      <Section spacing="sm" borderBottom>
        <Container>
          <h1 className="text-display">Page Title</h1>
        </Container>
      </Section>

      {/* Content */}
      <Section spacing="lg">
        <Container>
          <p className="text-body">Your content here</p>
        </Container>
      </Section>
    </div>
  )
}
```

### 3. Add Custom Styles Using Tokens
```css
.my-page {
  padding-bottom: var(--bottom-nav-safe-area);
  background: var(--color-bg-primary);
}

.my-custom-element {
  margin-top: var(--spacing-lg);
  color: var(--color-text-secondary);
  font-size: var(--font-size-body);
}
```

---

## 📐 Spacing Cheat Sheet

### Horizontal Padding (Use Container)
```jsx
<Container>              {/* 16px padding */}
<Container noPadding>    {/* 0px padding - for scrolling */}
```

### Vertical Spacing (Use Section)
```jsx
<Section spacing="sm">   {/* 16px top/bottom */}
<Section spacing="md">   {/* 24px top/bottom */}
<Section spacing="lg">   {/* 32px top/bottom (default) */}
<Section spacing="xl">   {/* 40px top/bottom */}
```

### Borders
```jsx
<Section borderTop>
<Section borderBottom>
<Section borderTop borderBottom>
```

---

## 📝 Typography Cheat Sheet

```jsx
<h1 className="text-display">    {/* 32px - Page titles */}
<h2 className="text-title">      {/* 20px - Section headers */}
<h3 className="text-subtitle">   {/* 16px - Subsections */}
<p className="text-body">         {/* 14px - Body text */}
<span className="text-meta">     {/* 12px - Metadata */}
<span className="text-label">    {/* 10px - Small labels (UPPERCASE) */}
```

---

## 🎨 Design Token Quick Reference

### Colors
```css
var(--color-text-primary)    /* White */
var(--color-text-secondary)  /* Medium gray #999 */
var(--color-text-tertiary)   /* Dark gray #666 */
var(--color-border)          /* Subtle white border */
var(--color-hover-bg)        /* Subtle white background */
```

### Spacing
```css
var(--spacing-xs)   /* 8px  - Very tight */
var(--spacing-sm)   /* 12px - Tight */
var(--spacing-md)   /* 16px - Standard */
var(--spacing-lg)   /* 24px - Comfortable */
var(--spacing-xl)   /* 32px - Generous */
var(--spacing-2xl)  /* 40px - Major section */
var(--spacing-3xl)  /* 48px - Huge break */
```

---

## 🔧 Common Patterns

### Pattern 1: Header with Border
```jsx
<Section spacing="sm" borderBottom>
  <Container>
    <span className="text-label">Welcome Back</span>
    <h1 className="text-display">Player Name</h1>
  </Container>
</Section>
```

### Pattern 2: Stats Grid (2x2)
```jsx
<Section spacing="md" borderTop borderBottom>
  <Container>
    <div className="stats-grid">
      <div className="stat-item">
        <div className="text-display">42</div>
        <div className="text-label">Played</div>
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
```

### Pattern 3: Horizontal Scrolling
```jsx
<Section spacing="md">
  <Container>
    <h2 className="text-title">Popular Games</h2>
  </Container>
  <Container noPadding>
    <div className="scroll-container">
      {items.map(item => <Card key={item.id} {...item} />)}
    </div>
  </Container>
</Section>
```

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
```

### Pattern 4: List with Dividers
```jsx
<Section spacing="lg">
  <Container>
    <h2 className="text-title">Reviews</h2>
    <div className="list-dividers">
      {reviews.map(review => (
        <div key={review.id} className="list-item">
          <h3 className="text-subtitle">{review.title}</h3>
          <p className="text-body">{review.text}</p>
        </div>
      ))}
    </div>
  </Container>
</Section>
```

```css
.list-dividers {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.list-item {
  padding: var(--spacing-lg) 0;
  border-bottom: 1px solid var(--color-border);
}

.list-item:last-child {
  border-bottom: none;
}
```

---

## ⚠️ Common Mistakes

### ❌ DON'T: Add padding inside Container
```jsx
<Container>
  <div style={{ padding: '20px' }}>Content</div>
</Container>
```

### ✅ DO: Let Container handle padding
```jsx
<Container>
  <div>Content</div>
</Container>
```

---

### ❌ DON'T: Mix hardcoded and token spacing
```css
.my-element {
  margin-top: 24px;              /* ❌ Hardcoded */
  margin-bottom: var(--spacing-lg); /* ✅ Token */
}
```

### ✅ DO: Use tokens consistently
```css
.my-element {
  margin-top: var(--spacing-lg);    /* ✅ */
  margin-bottom: var(--spacing-xl); /* ✅ */
}
```

---

### ❌ DON'T: Nest Containers
```jsx
<Container>
  <Container>
    <p>Don't do this</p>
  </Container>
</Container>
```

### ✅ DO: Use Container once per section
```jsx
<Section spacing="lg">
  <Container>
    <p>This is correct</p>
  </Container>
</Section>
```

---

## 📱 Testing Checklist

Before committing:

- [ ] Test at 320px (iPhone SE)
- [ ] Test at 375px (iPhone X/11/12/13)
- [ ] Test at 414px (iPhone Plus/Max)
- [ ] No horizontal scrolling
- [ ] All text is readable
- [ ] Spacing feels consistent with other pages

---

## 🔍 Debugging

### Issue: Content too close to edges
**Solution:** Make sure you're using `<Container>`

### Issue: Sections too cramped
**Solution:** Increase Section spacing: `spacing="lg"` or `spacing="xl"`

### Issue: Horizontal scroll appears
**Solution:**
1. Check if Container is missing
2. Check for fixed widths without `max-width: 100%`
3. Check for long text without `word-wrap: break-word`

### Issue: Text too large/small
**Solution:** Use typography utilities or tokens:
```jsx
<h1 className="text-display">Large</h1>
<p className="text-body">Normal</p>
```

---

## 📚 More Resources

- **Complete API Reference**: See `DESIGN_SYSTEM.md`
- **Implementation Details**: See `LAYOUT_SYSTEM_SUMMARY.md`
- **Real Examples**: See `src/pages/Home.jsx`
- **All Design Tokens**: See `src/styles/theme.css`

---

## 🎯 One-Minute Summary

1. **Horizontal padding**: Use `<Container>`
2. **Vertical spacing**: Use `<Section spacing="lg">`
3. **Typography**: Use utility classes (`text-display`, `text-body`)
4. **Custom styles**: Use design tokens (`var(--spacing-lg)`)
5. **Test**: 320px, 375px, 414px widths

**That's it! You're ready to build consistent, mobile-first layouts.** 🚀
