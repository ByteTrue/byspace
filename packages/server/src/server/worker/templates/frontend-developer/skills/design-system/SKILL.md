---
name: design-system
description: Build and maintain design systems — extract design tokens, scaffold component libraries, generate themes, and establish visual consistency. Use when creating a new design system, extracting tokens from a design, building a component library, or setting up theming infrastructure.
argument-hint: "<design system task or brand/design to systematize>"
---

# /design-system

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../../CONNECTORS.md).

Build design systems from scratch or systematize existing designs — tokens, component libraries, theming, and documentation.

## Usage

```
/design-system $ARGUMENTS
```

## Modes

**Create from scratch**: "Build a design system for our SaaS product"
**Extract from design**: "Extract tokens from this Figma file / reference UI"
**Build component library**: "Scaffold a component library with these primitives"
**Add theming**: "Add dark mode and theme switching to our app"

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    DESIGN SYSTEM                                │
├─────────────────────────────────────────────────────────────────┤
│  STANDALONE (always works)                                      │
│  ✓ Define design tokens (color, typography, spacing, motion)   │
│  ✓ Scaffold component library with primitives and composites   │
│  ✓ Generate theme configuration with multi-theme support       │
│  ✓ Establish naming conventions and token hierarchy            │
│  ✓ Create component API contracts and usage guidelines         │
│  ✓ Produce a design system spec with working code              │
├─────────────────────────────────────────────────────────────────┤
│  SUPERCHARGED (when tools connected)                            │
│  + Source control: audit existing styles for token extraction   │
│  + Knowledge base: align with team brand guidelines             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1 — Design Token Architecture

Design tokens are the atomic values that define your visual language. Everything else is built from them.

### Token hierarchy

```
Global Tokens (raw values)
    ↓
Semantic Tokens (purpose-driven aliases)
    ↓
Component Tokens (component-specific overrides)
```

### Example token structure

```css
/* ── Global tokens: raw palette ── */
:root {
  --color-blue-50: #eff6ff;
  --color-blue-500: #3b82f6;
  --color-blue-900: #1e3a5f;
  --color-neutral-0: #ffffff;
  --color-neutral-50: #f9fafb;
  --color-neutral-900: #111827;
  --color-red-500: #ef4444;
  --color-green-500: #22c55e;

  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;
  --font-size-3xl: 1.875rem;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;

  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-full: 9999px;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);

  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
  --easing-default: cubic-bezier(0.4, 0, 0.2, 1);
  --easing-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* ── Semantic tokens: purpose-driven ── */
:root {
  --color-bg-primary: var(--color-neutral-0);
  --color-bg-secondary: var(--color-neutral-50);
  --color-bg-inverse: var(--color-neutral-900);

  --color-text-primary: var(--color-neutral-900);
  --color-text-secondary: #6b7280;
  --color-text-inverse: var(--color-neutral-0);

  --color-border-default: #e5e7eb;
  --color-border-strong: #d1d5db;

  --color-accent: var(--color-blue-500);
  --color-accent-hover: var(--color-blue-900);
  --color-error: var(--color-red-500);
  --color-success: var(--color-green-500);

  --font-family-body: "Source Sans 3", sans-serif;
  --font-family-heading: "Fraunces", serif;
  --font-family-mono: "JetBrains Mono", monospace;
}
```

### Token categories checklist

| Category        | Tokens to define                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| **Color**       | Palette (global), semantic (bg, text, border, accent, status), interactive (hover, active, focus, disabled) |
| **Typography**  | Font families, size scale, weight scale, line heights, letter spacing                                       |
| **Spacing**     | Base unit, scale (4px grid or 8px grid), component padding, layout gaps                                     |
| **Border**      | Radius scale, width scale, color tokens                                                                     |
| **Shadow**      | Elevation scale (sm, md, lg, xl)                                                                            |
| **Motion**      | Duration scale, easing curves, transition properties                                                        |
| **Breakpoints** | Viewport breakpoints for responsive design                                                                  |
| **Z-index**     | Layering scale (dropdown, modal, toast, tooltip)                                                            |

---

## Step 2 — Theming Infrastructure

### CSS custom properties approach (framework-agnostic)

```css
/* Light theme (default) */
:root,
[data-theme="light"] {
  --color-bg-primary: #ffffff;
  --color-text-primary: #111827;
  --color-accent: #3b82f6;
}

/* Dark theme */
[data-theme="dark"] {
  --color-bg-primary: #0f172a;
  --color-text-primary: #f1f5f9;
  --color-accent: #60a5fa;
}

/* High contrast theme */
[data-theme="high-contrast"] {
  --color-bg-primary: #000000;
  --color-text-primary: #ffffff;
  --color-accent: #ffff00;
}
```

### Theme switching

```typescript
// Theme provider pattern
function setTheme(theme: "light" | "dark" | "system") {
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
  } else {
    document.documentElement.dataset.theme = theme;
  }
  localStorage.setItem("theme", theme);
}

// Respect system preference
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (localStorage.getItem("theme") === "system") {
    document.documentElement.dataset.theme = e.matches ? "dark" : "light";
  }
});
```

---

## Step 3 — Component Library Scaffold

### Component tiers

```
Tier 1: Primitives (atoms)
  Button, Input, Textarea, Select, Checkbox, Radio,
  Badge, Tag, Avatar, Icon, Spinner, Divider

Tier 2: Composites (molecules)
  FormField (Label + Input + Error), Card, Alert,
  Dropdown, Tooltip, Toast, Modal, Tabs, Accordion

Tier 3: Patterns (organisms)
  Header, Sidebar, DataTable, Pagination, CommandPalette,
  FileUpload, SearchBar, NavigationMenu
```

### Component file structure

```
src/components/
  ├── primitives/
  │   ├── Button/
  │   │   ├── Button.tsx          # Component implementation
  │   │   ├── Button.styles.css   # Styles (or .module.css / styled)
  │   │   ├── Button.test.tsx     # Tests
  │   │   ├── Button.stories.tsx  # Storybook stories (if applicable)
  │   │   └── index.ts            # Public export
  │   ├── Input/
  │   └── ...
  ├── composites/
  │   ├── FormField/
  │   ├── Card/
  │   └── ...
  ├── patterns/
  │   ├── DataTable/
  │   └── ...
  └── index.ts                    # Barrel export
```

### Component API contract template

```typescript
/**
 * Button — Primary interaction element.
 *
 * Variants: primary, secondary, ghost, destructive
 * Sizes: sm, md, lg
 *
 * Accessibility:
 * - Renders <button> by default, <a> when `href` is provided
 * - Disabled state sets aria-disabled and removes from tab order
 * - Loading state announces via aria-busy
 */
interface ButtonProps {
  // Content
  children: ReactNode;
  icon?: ReactNode;
  iconPosition?: "start" | "end";

  // Variants
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";

  // State
  disabled?: boolean;
  loading?: boolean;

  // Behavior
  type?: "button" | "submit" | "reset";
  href?: string; // renders as <a> when provided
  onClick?: (e: MouseEvent) => void;

  // Styling
  fullWidth?: boolean;
  className?: string;
}
```

---

## Step 4 — Token Extraction from Existing UI

When systematizing an existing design or reference:

### Extraction workflow

1. **Audit existing styles**: Grep for hardcoded values across the codebase.

   ```bash
   # Find all hardcoded colors
   grep -rn '#[0-9a-fA-F]\{3,8\}' --include="*.css" --include="*.scss" --include="*.tsx"

   # Find all hardcoded font sizes
   grep -rn 'font-size:' --include="*.css" --include="*.scss"

   # Find all hardcoded spacing
   grep -rn 'padding\|margin\|gap' --include="*.css" --include="*.scss"
   ```

2. **Deduplicate and cluster**: Group similar values.
   - Colors within ΔE < 5 are visually identical — merge them.
   - Font sizes within 1px can be normalized to a scale step.
   - Spacing values should snap to your grid unit (4px or 8px).

3. **Name with purpose**: Every token gets a semantic name.
   - `#3b82f6` used on CTAs → `--color-accent`
   - `14px` body text → `--font-size-sm`
   - `24px` card padding → `--space-6`

4. **Replace hardcoded values** with token references across the codebase.

---

## Step 5 — Documentation & Usage Guidelines

Every component in the system needs:

| Documentation item      | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| **Props table**         | All props with types, defaults, and descriptions |
| **Usage examples**      | Code snippets for common use cases               |
| **Do / Don't**          | Visual examples of correct vs. incorrect usage   |
| **Variants showcase**   | All visual variants rendered side by side        |
| **Accessibility notes** | Keyboard, screen reader, and ARIA behavior       |
| **Related components**  | When to use this vs. a similar component         |

---

## Output — Design System Spec

```markdown
# Design System: [Name]

## Token Architecture

### Color Palette

[Global color tokens with swatches]

### Semantic Colors

[Purpose-driven color mappings for light/dark themes]

### Typography Scale

| Token          | Value   | Usage            |
| -------------- | ------- | ---------------- |
| --font-size-xs | 0.75rem | Captions, labels |
| ...            | ...     | ...              |

### Spacing Scale

[Grid unit and scale definition]

### Motion Tokens

[Duration and easing definitions]

## Theming

[Theme switching mechanism and supported themes]

## Component Library

### Tier 1: Primitives

| Component | Status | Props  | Notes                       |
| --------- | ------ | ------ | --------------------------- |
| Button    | Ready  | [link] | Primary interaction element |

### Tier 2: Composites

| Component | Status | Props | Notes |
| --------- | ------ | ----- | ----- |

### Tier 3: Patterns

| Component | Status | Props | Notes |
| --------- | ------ | ----- | ----- |

## File Structure

[Directory layout]

## Naming Conventions

[Token naming rules, component naming rules, file naming rules]

## Migration Guide (if extracting from existing code)

[Steps to replace hardcoded values with tokens]
```

## If Connectors Available

If **~~source control** is connected:

- Audit existing styles for token extraction
- Track design system adoption across the codebase

If **~~knowledge base** is connected:

- Reference brand guidelines, color specifications, and typography rules
- Check for existing design system documentation

## Tips

1. **Start with tokens, not components** — Get the foundational values right before building anything. Components are just tokens assembled.
2. **Semantic over literal** — `--color-accent` is better than `--color-blue-500` for theming. Semantic tokens make theme switching trivial.
3. **Constrain choices** — A design system's value is in what it disallows. Fewer options means more consistency.
4. **Document with examples, not just props** — A prop table tells you what's possible; an example tells you what's recommended.
5. **Ship incrementally** — Don't build 50 components before using any. Start with Button, Input, Card — the components you need most — and grow from there.
