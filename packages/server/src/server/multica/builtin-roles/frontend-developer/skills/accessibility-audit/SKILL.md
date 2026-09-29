---
name: accessibility-audit
description: Audit interfaces for WCAG compliance, fix accessibility issues, and implement inclusive design patterns. Use when checking a component or page for accessibility, implementing ARIA patterns, fixing keyboard navigation, or ensuring color contrast compliance.
argument-hint: "<component, page, or URL to audit>"
---

# /accessibility-audit

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../../CONNECTORS.md).

Audit interfaces for WCAG compliance, identify accessibility barriers, and produce actionable fixes with working code.

## Usage

```
/accessibility-audit $ARGUMENTS
```

## Modes

**Full audit**: "Audit this page for accessibility"
**Targeted check**: "Is this modal accessible?"
**Fix issues**: "Fix the keyboard navigation on this dropdown"
**Pattern implementation**: "Implement an accessible tabs component"

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                  ACCESSIBILITY AUDIT                            │
├─────────────────────────────────────────────────────────────────┤
│  STANDALONE (always works)                                      │
│  ✓ Audit semantic HTML structure and landmark usage             │
│  ✓ Check ARIA attributes, roles, and states                    │
│  ✓ Validate keyboard navigation and focus management           │
│  ✓ Evaluate color contrast ratios (WCAG AA / AAA)              │
│  ✓ Review screen reader experience and announcements           │
│  ✓ Produce issue report with severity and fix code             │
├─────────────────────────────────────────────────────────────────┤
│  SUPERCHARGED (when tools connected)                            │
│  + Source control: audit changed components in a PR             │
│  + Knowledge base: reference team a11y standards                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Audit Framework — POUR Principles

Every check maps to one of the four WCAG principles:

| Principle          | Question                            | Key checks                                |
| ------------------ | ----------------------------------- | ----------------------------------------- |
| **Perceivable**    | Can users perceive all content?     | Alt text, captions, contrast, text resize |
| **Operable**       | Can users operate all controls?     | Keyboard, focus, timing, navigation       |
| **Understandable** | Can users understand the interface? | Labels, error messages, predictability    |
| **Robust**         | Does it work with assistive tech?   | Valid HTML, ARIA, semantic structure      |

---

## Step 1 — Structural Audit

### Semantic HTML

Check for correct use of HTML elements:

| Issue                      | Bad                             | Good                                     |
| -------------------------- | ------------------------------- | ---------------------------------------- |
| Non-semantic containers    | `<div onclick>`                 | `<button>`                               |
| Missing headings hierarchy | `<div class="title">`           | `<h1>` → `<h2>` → `<h3>` (no skipping)   |
| No landmark regions        | All `<div>` wrappers            | `<nav>`, `<main>`, `<aside>`, `<footer>` |
| List without list markup   | `<div>` with items              | `<ul>` / `<ol>` with `<li>`              |
| Table without table markup | CSS grid imitating table        | `<table>` with `<thead>`, `<th scope>`   |
| Non-semantic links         | `<span onclick>` styled as link | `<a href>`                               |

### Heading hierarchy

Validate that headings form a logical outline:

```
✅ Correct:           ❌ Wrong:
h1 Page Title         h1 Page Title
  h2 Section A          h3 Section A  ← skipped h2
    h3 Subsection         h2 Subsection
  h2 Section B          h4 Another    ← skipped h3
```

### Landmarks

Every page should have at minimum:

```html
<header role="banner">
  <!-- or just <header> as direct child of <body> -->
  <nav role="navigation">
    <main role="main">
      <!-- exactly one per page -->
      <footer role="contentinfo"></footer>
    </main>
  </nav>
</header>
```

---

## Step 2 — Keyboard Navigation

### Focus order

- Tab order must follow logical reading order (avoid `tabindex` > 0).
- All interactive elements must be reachable via Tab / Shift+Tab.
- Focus must be visible — a clear, high-contrast focus indicator.

### Focus management patterns

| Pattern           | When                        | Implementation                                                                |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------- |
| Focus trap        | Modals, dialogs             | Tab cycles within the modal; Escape closes                                    |
| Focus restoration | After modal closes          | Return focus to the trigger element                                           |
| Roving tabindex   | Tab panels, toolbars, menus | One item in the group is `tabindex="0"`, rest are `-1`; arrow keys move focus |
| Skip links        | Every page                  | `<a href="#main" class="sr-only focus:not-sr-only">Skip to content</a>`       |

### Keyboard interaction patterns (WAI-ARIA APG)

| Component   | Keys                                                            |
| ----------- | --------------------------------------------------------------- |
| Button      | Enter, Space → activate                                         |
| Link        | Enter → navigate                                                |
| Checkbox    | Space → toggle                                                  |
| Radio group | Arrow keys → move between options; Space → select               |
| Tabs        | Arrow keys → switch tab; Tab → move to tab panel                |
| Menu        | Arrow keys → navigate; Enter → select; Escape → close           |
| Dialog      | Escape → close; Tab → cycle within                              |
| Combobox    | Arrow keys → navigate list; Enter → select; Escape → close list |
| Accordion   | Enter/Space → expand/collapse; Arrow keys → navigate headers    |

---

## Step 3 — ARIA Audit

### ARIA rules

1. **First rule of ARIA**: Don't use ARIA if a native HTML element exists. `<button>` beats `<div role="button">`.
2. **Required attributes**: Every role has required attributes (e.g., `role="checkbox"` needs `aria-checked`).
3. **State synchronization**: ARIA states must update with JavaScript when the UI state changes.
4. **Label everything**: Every interactive element needs an accessible name via `<label>`, `aria-label`, or `aria-labelledby`.

### Common ARIA patterns

```html
<!-- Expandable section -->
<button aria-expanded="false" aria-controls="section-1">Show details</button>
<div id="section-1" hidden>Details content</div>

<!-- Live region for dynamic updates -->
<div aria-live="polite" aria-atomic="true">3 items in your cart</div>

<!-- Loading state -->
<div aria-busy="true" aria-live="polite">Loading results...</div>

<!-- Error message linked to input -->
<input id="email" aria-describedby="email-error" aria-invalid="true" />
<p id="email-error" role="alert">Please enter a valid email address.</p>
```

### Common ARIA mistakes

| Mistake                                   | Problem                          | Fix                                                      |
| ----------------------------------------- | -------------------------------- | -------------------------------------------------------- |
| `aria-label` on non-interactive `<div>`   | Screen readers may ignore it     | Use on interactive elements or landmarks                 |
| `role="button"` without keyboard handler  | Not keyboard accessible          | Use `<button>` instead, or add `keydown` for Enter/Space |
| `aria-hidden="true"` on focusable element | Focus lands on invisible element | Remove from tab order too, or don't hide it              |
| Multiple `aria-live` regions              | Competing announcements          | Use one region, update its content                       |
| `aria-label` duplicating visible text     | Redundant announcement           | Use `aria-labelledby` to point to the visible text       |

---

## Step 4 — Color & Visual Audit

### Contrast ratios (WCAG 2.1)

| Level   | Normal text (< 18pt) | Large text (≥ 18pt or 14pt bold) | UI components |
| ------- | -------------------- | -------------------------------- | ------------- |
| **AA**  | 4.5:1                | 3:1                              | 3:1           |
| **AAA** | 7:1                  | 4.5:1                            | —             |

### Beyond color

- **Never use color alone** to convey information. Add icons, patterns, or text labels.
- **Focus indicators** must have at least 3:1 contrast against adjacent colors.
- **Error states** must use more than just red — add icon, bold text, or border.
- **Respect `prefers-color-scheme`** and `prefers-contrast` where applicable.

---

## Step 5 — Screen Reader Experience

### Image alt text

| Image purpose            | Alt text strategy                                                      |
| ------------------------ | ---------------------------------------------------------------------- |
| Informative              | Describe the content: `alt="Bar chart showing revenue grew 40% in Q3"` |
| Decorative               | Empty alt: `alt=""` (not missing — explicitly empty)                   |
| Functional (button/link) | Describe the action: `alt="Close dialog"`                              |
| Complex (chart, diagram) | Short alt + longer `aria-describedby` or adjacent text description     |

### Form accessibility

```html
<!-- Every input needs a label -->
<label for="email">Email address</label>
<input id="email" type="email" required aria-describedby="email-hint" />
<p id="email-hint">We'll never share your email.</p>

<!-- Group related inputs -->
<fieldset>
  <legend>Shipping address</legend>
  <!-- address fields -->
</fieldset>
```

### Announcements

| Event                                    | Announcement method                              |
| ---------------------------------------- | ------------------------------------------------ |
| Form validation error                    | `role="alert"` or `aria-live="assertive"`        |
| Toast notification                       | `aria-live="polite"`                             |
| Page navigation (SPA)                    | Update document title; announce with live region |
| Loading state                            | `aria-busy="true"` on container                  |
| Content update (counter, filter results) | `aria-live="polite"` with `aria-atomic="true"`   |

---

## Output — Accessibility Audit Report

```markdown
# Accessibility Audit: [Page / Component Name]

**WCAG Level:** AA / AAA
**Date:** [YYYY-MM-DD]

## Summary

[Overall accessibility status — critical issues count, major findings]

## Issues

### Critical (WCAG A violations — must fix)

| #   | WCAG Criterion                 | Issue         | Location    | Fix        |
| --- | ------------------------------ | ------------- | ----------- | ---------- |
| 1   | [e.g., 1.1.1 Non-text Content] | [description] | [file:line] | [code fix] |

### Major (WCAG AA violations — should fix)

| #   | WCAG Criterion | Issue | Location | Fix |
| --- | -------------- | ----- | -------- | --- |

### Minor (Best practices — nice to fix)

| #   | Category | Issue | Location | Fix |
| --- | -------- | ----- | -------- | --- |

## Keyboard Navigation

- [ ] All interactive elements reachable via Tab
- [ ] Focus order matches visual order
- [ ] Focus indicators visible and high-contrast
- [ ] Modal focus trapping works correctly
- [ ] Skip link present and functional

## Screen Reader

- [ ] All images have appropriate alt text
- [ ] Form inputs have associated labels
- [ ] Dynamic content uses aria-live regions
- [ ] Page landmarks are present and labeled
- [ ] Heading hierarchy is logical

## Color & Contrast

- [ ] Text meets AA contrast ratios (4.5:1 / 3:1)
- [ ] UI components meet 3:1 contrast
- [ ] Information not conveyed by color alone
- [ ] Focus indicators meet contrast requirements

## Recommendations

[Priority-ordered list of fixes with estimated effort]
```

## Severity Classification

| Severity     | Definition                                           | Action                |
| ------------ | ---------------------------------------------------- | --------------------- |
| **Critical** | WCAG A violation — blocks users entirely             | Fix immediately       |
| **Major**    | WCAG AA violation — significantly impairs experience | Fix before release    |
| **Minor**    | Best practice gap — suboptimal but functional        | Fix in next iteration |

## If Connectors Available

If **~~source control** is connected:

- Audit only changed components in a PR to keep reviews focused
- Track a11y issue resolution across commits

If **~~knowledge base** is connected:

- Reference team accessibility standards and exceptions
- Check for approved ARIA pattern implementations

## Tips

1. **Use semantic HTML first** — 80% of accessibility comes from correct HTML. ARIA is the last resort, not the first tool.
2. **Test with keyboard only** — Unplug your mouse and try to complete every task. This catches most interaction issues.
3. **Labels are cheap, confusion is expensive** — Every input, button, and icon needs an accessible name. When in doubt, label it.
4. **Don't disable focus outlines** — If the default ring is ugly, style it. `outline: none` without a replacement is an accessibility violation.
5. **alt="" is not the same as missing alt** — Decorative images need explicitly empty alt attributes to be skipped by screen readers.
