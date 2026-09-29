---
name: performance-optimization
description: Analyze and optimize frontend performance — bundle size, rendering, loading strategy, and runtime efficiency. Use when a page feels slow, bundle is too large, Core Web Vitals are poor, or when establishing a performance budget for a new project.
argument-hint: "<page, component, or performance issue to optimize>"
---

# /performance-optimization

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../../CONNECTORS.md).

Analyze frontend performance bottlenecks and produce targeted optimizations — from bundle analysis to rendering efficiency to loading strategies.

## Usage

```
/performance-optimization $ARGUMENTS
```

## Modes

**Diagnose slow page**: "This page takes 5 seconds to load"
**Bundle analysis**: "Our bundle is 2MB, help reduce it"
**Performance budget**: "Set up performance budgets for this project"
**Optimize component**: "This list re-renders on every keystroke"

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│               PERFORMANCE OPTIMIZATION                          │
├─────────────────────────────────────────────────────────────────┤
│  STANDALONE (always works)                                      │
│  ✓ Analyze bundle composition and identify bloat               │
│  ✓ Audit rendering performance and unnecessary re-renders      │
│  ✓ Design loading strategies (lazy load, code split, prefetch) │
│  ✓ Optimize images, fonts, and static assets                   │
│  ✓ Evaluate Core Web Vitals impact                             │
│  ✓ Produce optimization plan with estimated impact             │
├─────────────────────────────────────────────────────────────────┤
│  SUPERCHARGED (when tools connected)                            │
│  + Source control: compare bundle sizes across branches         │
│  + Knowledge base: reference team performance standards         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Web Vitals — The Target

| Metric                              | Good    | Needs Improvement | Poor    | What it measures |
| ----------------------------------- | ------- | ----------------- | ------- | ---------------- |
| **LCP** (Largest Contentful Paint)  | ≤ 2.5s  | 2.5–4.0s          | > 4.0s  | Loading speed    |
| **INP** (Interaction to Next Paint) | ≤ 200ms | 200–500ms         | > 500ms | Responsiveness   |
| **CLS** (Cumulative Layout Shift)   | ≤ 0.1   | 0.1–0.25          | > 0.25  | Visual stability |

---

## Step 1 — Identify the Bottleneck Category

Before optimizing, classify the problem:

| Symptom                              | Likely category | Investigation                               |
| ------------------------------------ | --------------- | ------------------------------------------- |
| Slow initial page load               | **Loading**     | Bundle size, critical path, server response |
| Slow after user interacts            | **Runtime**     | Re-renders, expensive computations, memory  |
| Page jumps or shifts during load     | **Stability**   | Missing dimensions, late-loading content    |
| Slow on mobile but fine on desktop   | **Resource**    | Images, bundle size, CPU-intensive JS       |
| Scroll jank or stuttering animations | **Rendering**   | Layout thrashing, paint storms, compositing |

---

## Step 2 — Loading Performance

### Bundle optimization

| Technique              | When to use                                 | Implementation                                                 |
| ---------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| **Code splitting**     | Routes or features loaded conditionally     | `React.lazy()`, dynamic `import()`, route-based splitting      |
| **Tree shaking**       | Importing whole libraries for one function  | Named imports: `import { debounce } from 'lodash-es'`          |
| **Replace heavy deps** | Large libraries with lighter alternatives   | `date-fns` → `dayjs`; `lodash` → native; `moment` → `Intl` API |
| **Dynamic imports**    | Heavy components not needed on initial load | `const Editor = lazy(() => import('./Editor'))`                |
| **External CDN**       | Shared dependencies across micro-frontends  | `externals` in webpack/vite config                             |

### Critical rendering path

```
Optimize this sequence:
HTML → CSS (render-blocking) → JS (parser-blocking) → First Paint → LCP

Actions:
1. Inline critical CSS (above-the-fold styles)
2. Defer non-critical CSS: <link rel="preload" as="style">
3. Defer JS: <script defer> or <script type="module">
4. Preload key resources: <link rel="preload" href="hero.webp" as="image">
5. Preconnect to origins: <link rel="preconnect" href="https://api.example.com">
```

### Resource hints

```html
<!-- DNS prefetch for third-party origins -->
<link rel="dns-prefetch" href="https://cdn.example.com" />

<!-- Preconnect for critical third-party origins -->
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin />

<!-- Preload critical resources -->
<link rel="preload" href="/fonts/heading.woff2" as="font" type="font/woff2" crossorigin />

<!-- Prefetch next-page resources -->
<link rel="prefetch" href="/dashboard.js" />
```

---

## Step 3 — Rendering Performance

### Unnecessary re-renders

| Framework  | Detection                                      | Fix                                                           |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------- |
| **React**  | React DevTools Profiler → highlight re-renders | `React.memo()`, `useMemo()`, `useCallback()`, state splitting |
| **Vue**    | Vue DevTools performance tab                   | `computed`, `shallowRef`, `v-once`, `v-memo`                  |
| **Svelte** | Reactivity is fine-grained by default          | Ensure `$:` statements are minimal                            |

### React-specific optimizations

```tsx
// ❌ Bad: new object on every render → child always re-renders
<UserCard style={{ padding: 16 }} user={user} />

// ✅ Good: stable reference
const cardStyle = useMemo(() => ({ padding: 16 }), [])
<UserCard style={cardStyle} user={user} />

// ❌ Bad: list without keys → full re-render
{items.map(item => <Item data={item} />)}

// ✅ Good: stable keys → minimal DOM updates
{items.map(item => <Item key={item.id} data={item} />)}

// ✅ Good: virtualize large lists
import { useVirtualizer } from '@tanstack/react-virtual'
```

### Layout thrashing prevention

```javascript
// ❌ Bad: read-write-read-write forces layout recalculation
elements.forEach((el) => {
  const height = el.offsetHeight; // read → forces layout
  el.style.height = height + 10 + "px"; // write → invalidates layout
});

// ✅ Good: batch reads, then batch writes
const heights = elements.map((el) => el.offsetHeight); // all reads
elements.forEach((el, i) => {
  el.style.height = heights[i] + 10 + "px"; // all writes
});
```

---

## Step 4 — Asset Optimization

### Images

| Format   | Use for                     | Savings                  |
| -------- | --------------------------- | ------------------------ |
| **WebP** | Photos, complex images      | 25-35% smaller than JPEG |
| **AVIF** | Photos (where supported)    | 50% smaller than JPEG    |
| **SVG**  | Icons, logos, illustrations | Scalable, tiny file size |
| **CSS**  | Simple shapes, gradients    | Zero HTTP requests       |

```html
<!-- Responsive images with modern formats -->
<picture>
  <source srcset="hero.avif" type="image/avif" />
  <source srcset="hero.webp" type="image/webp" />
  <img src="hero.jpg" alt="Hero" width="1200" height="600" loading="lazy" decoding="async" />
</picture>
```

### Fonts

| Technique              | Impact                                    |
| ---------------------- | ----------------------------------------- |
| `font-display: swap`   | Prevent invisible text during font load   |
| Subset fonts           | Remove unused glyphs (especially for CJK) |
| Preload critical fonts | `<link rel="preload" as="font">`          |
| Use `woff2` format     | 30% smaller than woff                     |
| Limit font variations  | Each weight/style is a separate file      |
| Variable fonts         | One file for all weights — smaller total  |

---

## Step 5 — Virtualization & Lazy Loading

### List virtualization

For lists with 100+ items, only render visible items:

| Library                           | Framework | Use case               |
| --------------------------------- | --------- | ---------------------- |
| `@tanstack/react-virtual`         | React     | Lists, tables, grids   |
| `vue-virtual-scroller`            | Vue       | Lists and grids        |
| `svelte-virtual-list`             | Svelte    | Lists                  |
| Native `content-visibility: auto` | Any       | Simple cases, CSS-only |

### Lazy loading patterns

| Resource              | Technique                                 |
| --------------------- | ----------------------------------------- |
| Images below fold     | `loading="lazy"` attribute                |
| Heavy components      | Dynamic `import()` with loading fallback  |
| Routes                | Route-based code splitting                |
| Third-party scripts   | Load on interaction or after idle         |
| Embeds (maps, videos) | Load on visibility (IntersectionObserver) |

---

## Output — Performance Optimization Report

```markdown
# Performance Report: [Page / Feature]

## Current State

- LCP: [value]
- INP: [value]
- CLS: [value]
- Bundle size: [value]
- Time to Interactive: [value]

## Bottleneck Analysis

| Category  | Issue         | Impact             | Priority         |
| --------- | ------------- | ------------------ | ---------------- |
| Loading   | [description] | [estimated impact] | High / Med / Low |
| Rendering | [description] | [estimated impact] | High / Med / Low |

## Optimization Plan

### Quick Wins (< 1 hour)

| #   | Optimization  | Expected Impact       | Effort |
| --- | ------------- | --------------------- | ------ |
| 1   | [description] | [e.g., -200KB bundle] | Low    |

### Medium Effort (1-4 hours)

| #   | Optimization | Expected Impact | Effort |
| --- | ------------ | --------------- | ------ |

### Strategic (> 4 hours)

| #   | Optimization | Expected Impact | Effort |
| --- | ------------ | --------------- | ------ |

## Performance Budget

| Metric              | Budget  | Current | Status  |
| ------------------- | ------- | ------- | ------- |
| JS bundle (gzipped) | < 150KB | [value] | ✅ / ❌ |
| CSS (gzipped)       | < 30KB  | [value] | ✅ / ❌ |
| LCP                 | < 2.5s  | [value] | ✅ / ❌ |
| INP                 | < 200ms | [value] | ✅ / ❌ |
| CLS                 | < 0.1   | [value] | ✅ / ❌ |

## Implementation Details

[Specific code changes with before/after examples]
```

## If Connectors Available

If **~~source control** is connected:

- Compare bundle sizes between branches to catch regressions
- Identify which commits introduced size increases

If **~~knowledge base** is connected:

- Reference team performance budgets and standards
- Check for approved optimization patterns

## Tips

1. **Measure first, optimize second** — Never guess at bottlenecks. Use DevTools Performance tab, Lighthouse, or bundle analyzer to identify real issues.
2. **The fastest code is code that doesn't run** — Remove unused code, dead features, and unnecessary dependencies before optimizing what remains.
3. **Budget is more valuable than optimization** — Setting a performance budget and enforcing it in CI prevents regressions better than periodic cleanups.
4. **Users perceive loading, not bytes** — A 500KB app that shows content at 1s feels faster than a 200KB app that shows a blank screen for 2s. Prioritize perceived performance.
5. **Don't optimize prematurely** — `React.memo` everywhere is not a strategy. Profile first, then target the specific components that actually re-render too often.
