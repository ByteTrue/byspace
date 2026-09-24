---
name: responsive-design
description: Design and implement systematic responsive strategies. Use when building mobile-first layouts, defining breakpoint systems, handling complex responsive patterns, or auditing an existing interface for responsive issues.
argument-hint: "<component, page, or layout to make responsive>"
---

# /responsive-design

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../../CONNECTORS.md).

Design systematic responsive strategies that work across all devices — mobile-first, with intentional breakpoint decisions and fluid layouts.

## Usage

```
/responsive-design $ARGUMENTS
```

## Modes

**Design responsive layout**: "Make this dashboard work on mobile"
**Define breakpoint system**: "Set up a breakpoint strategy for our app"
**Audit responsiveness**: "Check if this page works at all screen sizes"
**Solve a pattern**: "How should this data table adapt on small screens?"

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                   RESPONSIVE DESIGN                             │
├─────────────────────────────────────────────────────────────────┤
│  STANDALONE (always works)                                      │
│  ✓ Analyze layout requirements across viewport sizes            │
│  ✓ Define breakpoint system with semantic names                 │
│  ✓ Design adaptive patterns for complex components              │
│  ✓ Implement fluid typography and spacing                       │
│  ✓ Handle touch targets, gestures, and mobile UX               │
│  ✓ Produce responsive implementation with working code          │
├─────────────────────────────────────────────────────────────────┤
│  SUPERCHARGED (when tools connected)                            │
│  + Source control: inspect existing breakpoint conventions      │
│  + Knowledge base: align with team responsive standards         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1 — Audit the Content

Before choosing breakpoints, understand what needs to adapt:

- **Content inventory**: List all content blocks, their priority, and their minimum viable display.
- **Interaction inventory**: Which elements are tappable? Which need hover alternatives for touch?
- **Data density**: Tables, charts, and dense data have different responsive strategies than marketing pages.
- **Navigation complexity**: How many nav items? Does the navigation model change on mobile?

---

## Step 2 — Define the Breakpoint System

### Mobile-first is the default

Write base styles for the smallest screen, then add complexity with `min-width` media queries.

```css
/* Base: mobile (0px+) */
.container {
  padding: 1rem;
}

/* Tablet: 768px+ */
@media (min-width: 768px) {
  .container {
    padding: 2rem;
  }
}

/* Desktop: 1024px+ */
@media (min-width: 1024px) {
  .container {
    padding: 3rem;
    max-width: 1200px;
  }
}
```

### Recommended breakpoint tokens

Define breakpoints as CSS custom properties or design tokens:

```css
:root {
  --bp-sm: 640px; /* Large phones, landscape */
  --bp-md: 768px; /* Tablets */
  --bp-lg: 1024px; /* Small desktops, landscape tablets */
  --bp-xl: 1280px; /* Desktops */
  --bp-2xl: 1536px; /* Large desktops */
}
```

### When to add a breakpoint

| Signal                                       | Action                                               |
| -------------------------------------------- | ---------------------------------------------------- |
| Content becomes unreadable or cramped        | Add breakpoint                                       |
| Layout has awkward whitespace gaps           | Add breakpoint                                       |
| Touch targets are too small or too close     | Add breakpoint                                       |
| A component's aspect ratio breaks the layout | Add breakpoint                                       |
| "Because the framework has this breakpoint"  | **NOT** a valid reason — let content drive decisions |

---

## Step 3 — Choose Adaptive Patterns

### Layout patterns

| Pattern                 | Description                                              | Use when                           |
| ----------------------- | -------------------------------------------------------- | ---------------------------------- |
| **Stack → Grid**        | Stack vertically on mobile, grid on desktop              | Card layouts, feature grids        |
| **Sidebar collapse**    | Sidebar becomes drawer or bottom nav on mobile           | Dashboards, admin panels           |
| **Priority disclosure** | Show key content first, reveal details on larger screens | Product pages, profiles            |
| **Column drop**         | Multi-column drops to fewer columns progressively        | Blog layouts, content pages        |
| **Off-canvas**          | Content slides in from the side on mobile                | Navigation, filters, detail panels |
| **Responsive reflow**   | Elements reflow based on container, not viewport         | Embedded widgets, cards in grids   |

### Component-specific patterns

| Component         | Mobile strategy                                         | Desktop strategy                |
| ----------------- | ------------------------------------------------------- | ------------------------------- |
| **Data table**    | Card view or horizontal scroll with sticky first column | Full table with all columns     |
| **Navigation**    | Hamburger menu, bottom tab bar, or full-screen overlay  | Horizontal nav bar, sidebar     |
| **Form**          | Single column, large touch targets, stepped wizard      | Multi-column, inline validation |
| **Modal/Dialog**  | Full-screen sheet sliding from bottom                   | Centered overlay with backdrop  |
| **Charts**        | Simplified view, key metrics only, swipeable            | Full visualization with legends |
| **Image gallery** | Single image with swipe, thumbnail strip                | Grid layout with lightbox       |

---

## Step 4 — Fluid Typography & Spacing

### Fluid type scale with `clamp()`

```css
:root {
  /* clamp(min, preferred, max) */
  --text-sm: clamp(0.8rem, 0.75rem + 0.25vw, 0.875rem);
  --text-base: clamp(1rem, 0.9rem + 0.5vw, 1.125rem);
  --text-lg: clamp(1.25rem, 1rem + 1.25vw, 1.5rem);
  --text-xl: clamp(1.5rem, 1rem + 2.5vw, 2.25rem);
  --text-2xl: clamp(2rem, 1rem + 5vw, 3.5rem);
}
```

### Fluid spacing

```css
:root {
  --space-xs: clamp(0.25rem, 0.2rem + 0.25vw, 0.5rem);
  --space-sm: clamp(0.5rem, 0.4rem + 0.5vw, 0.75rem);
  --space-md: clamp(1rem, 0.8rem + 1vw, 1.5rem);
  --space-lg: clamp(1.5rem, 1rem + 2.5vw, 3rem);
  --space-xl: clamp(2rem, 1rem + 5vw, 5rem);
}
```

---

## Step 5 — Touch & Mobile UX

### Touch targets

- Minimum tap target: **44×44px** (Apple HIG) or **48×48dp** (Material Design).
- Minimum spacing between targets: **8px**.
- Interactive elements near screen edges need extra padding.

### Mobile-specific considerations

| Concern                            | Solution                                               |
| ---------------------------------- | ------------------------------------------------------ |
| Thumb reach zones                  | Place primary actions in bottom 1/3 of screen          |
| Hover-dependent UI                 | Provide tap alternatives (long press, explicit toggle) |
| Text input on mobile               | Use appropriate `inputmode`, avoid tiny inputs         |
| Landscape orientation              | Test and handle — don't ignore it                      |
| Safe areas (notch, home indicator) | Use `env(safe-area-inset-*)`                           |
| Reduced motion preference          | Respect `prefers-reduced-motion`                       |

---

## Step 6 — Container Queries (Modern CSS)

When components need to adapt to their container rather than the viewport:

```css
.card-container {
  container-type: inline-size;
  container-name: card;
}

@container card (min-width: 400px) {
  .card {
    display: grid;
    grid-template-columns: 200px 1fr;
  }
}

@container card (max-width: 399px) {
  .card {
    display: flex;
    flex-direction: column;
  }
}
```

### When to use container queries vs. media queries

| Scenario                                                     | Use               |
| ------------------------------------------------------------ | ----------------- |
| Page-level layout changes                                    | Media queries     |
| Component adapts to its parent's size                        | Container queries |
| Component is used in multiple contexts (sidebar + main area) | Container queries |
| Viewport-specific behavior (orientation, device)             | Media queries     |

---

## Output — Responsive Design Spec

```markdown
# Responsive Design: [Page / Component Name]

## Breakpoint System

[Defined breakpoints with rationale]

## Layout Strategy

### Mobile (< 768px)

[Layout description and key decisions]

### Tablet (768px – 1023px)

[Layout description]

### Desktop (1024px+)

[Layout description]

## Adaptive Patterns Used

| Component | Pattern   | Rationale |
| --------- | --------- | --------- |
| [name]    | [pattern] | [why]     |

## Fluid Scales

[Typography and spacing tokens]

## Touch & Mobile UX

[Touch targets, thumb zones, input modes]

## Implementation Notes

[Framework-specific details, container queries, etc.]

## Testing Checklist

- [ ] Tested at 320px (smallest common phone)
- [ ] Tested at 375px (iPhone SE / standard)
- [ ] Tested at 768px (tablet portrait)
- [ ] Tested at 1024px (tablet landscape / small desktop)
- [ ] Tested at 1440px (standard desktop)
- [ ] Tested in landscape orientation
- [ ] Touch targets meet minimum size requirements
- [ ] No horizontal scroll at any breakpoint
- [ ] Text remains readable at all sizes
```

## If Connectors Available

If **~~source control** is connected:

- Inspect existing breakpoint definitions and responsive patterns
- Check for CSS framework configuration (Tailwind config, etc.)

If **~~knowledge base** is connected:

- Reference team responsive design standards
- Check for existing breakpoint tokens or design system documentation

## Tips

1. **Start mobile, add complexity** — Mobile-first CSS is smaller, simpler, and progressive. Desktop-first requires overriding everything.
2. **Let content drive breakpoints** — Don't add breakpoints at arbitrary device widths. Add them where your content breaks.
3. **Test with real content** — Placeholder "Lorem ipsum" doesn't reveal responsive issues. Use realistic text lengths and data volumes.
4. **Container queries for components** — If a component lives in multiple layout contexts, container queries beat media queries every time.
5. **Don't hide content on mobile** — Responsive means reorganizing, not removing. If content isn't important enough for mobile, question whether it belongs at all.
