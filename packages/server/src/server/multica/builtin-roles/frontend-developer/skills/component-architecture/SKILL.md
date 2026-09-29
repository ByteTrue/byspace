---
name: component-architecture
description: Design reusable component structures, composition strategies, and state management patterns. Use when building a component library, refactoring a monolithic component, designing props/state interfaces, or establishing component boundaries and data flow.
argument-hint: "<component or feature to architect>"
---

# /component-architecture

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../../CONNECTORS.md).

Design clean, reusable component architectures with clear boundaries, composition patterns, and state management strategies.

## Usage

```
/component-architecture $ARGUMENTS
```

## Modes

**Decompose a UI**: "Break this dashboard into reusable components"
**Design props interface**: "Design the API for a DataTable component"
**Refactor structure**: "This 500-line component needs to be split"
**State strategy**: "How should state flow in this multi-step form?"

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                 COMPONENT ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────┤
│  STANDALONE (always works)                                      │
│  ✓ Analyze UI requirements and identify component boundaries    │
│  ✓ Design component tree with clear parent-child relationships  │
│  ✓ Define props interfaces and state ownership                  │
│  ✓ Establish composition patterns (slots, render props, HOCs)   │
│  ✓ Map data flow and event propagation                          │
│  ✓ Produce a component spec document                            │
├─────────────────────────────────────────────────────────────────┤
│  SUPERCHARGED (when tools connected)                            │
│  + Source control: inspect existing components for reuse        │
│  + Knowledge base: align with team component conventions        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1 — Identify Component Boundaries

Analyze the UI and draw boundaries based on:

- **Single Responsibility**: Each component does one thing well.
- **Reusability**: Could this piece appear elsewhere? Extract it.
- **Data ownership**: Who owns this state? That's a component boundary.
- **Visual grouping**: Elements that move together, resize together, or hide together belong together.

### Boundary signals

| Signal                                          | Action                                           |
| ----------------------------------------------- | ------------------------------------------------ |
| A section has its own loading/error state       | Separate component                               |
| Props are being drilled through 3+ levels       | Introduce context or composition                 |
| A component renders conditionally based on mode | Split into variants or use composition           |
| A piece of UI repeats with different data       | Extract into a list item component               |
| A section could be lazy-loaded independently    | Separate component at route or viewport boundary |

---

## Step 2 — Design the Component Tree

Produce an ASCII component tree showing the hierarchy:

```
<App>
  ├── <Header>
  │   ├── <Logo />
  │   ├── <Navigation>
  │   │   └── <NavItem /> ×N
  │   └── <UserMenu />
  ├── <Main>
  │   ├── <Sidebar>
  │   │   └── <FilterPanel />
  │   └── <Content>
  │       ├── <DataTable>
  │       │   ├── <TableHeader />
  │       │   └── <TableRow /> ×N
  │       └── <Pagination />
  └── <Footer />
```

For each component, annotate:

- **Type**: Container (stateful) or Presentational (stateless)
- **State owned**: What state does this component manage?
- **Props received**: Key props from parent
- **Events emitted**: Callbacks or events sent upward

---

## Step 3 — Define Props Interfaces

Design the public API for each non-trivial component. Follow these principles:

### Props design rules

1. **Minimal surface area** — Only expose what consumers need. Internal implementation details are not props.
2. **Sensible defaults** — Every optional prop should have a default that produces reasonable behavior.
3. **Composition over configuration** — Prefer `children`/slots over boolean flags that toggle internal behavior.
4. **Consistent naming** — `onX` for callbacks, `isX`/`hasX` for booleans, plural for arrays.
5. **Type safety** — Define TypeScript interfaces or PropTypes for every component.

### Props interface format

```typescript
interface DataTableProps {
  // Required
  columns: ColumnDef[];
  data: Row[];

  // Optional — behavior
  sortable?: boolean; // default: false
  selectable?: boolean; // default: false
  onRowClick?: (row: Row) => void;
  onSelectionChange?: (selected: Row[]) => void;

  // Optional — appearance
  density?: "compact" | "default" | "comfortable"; // default: 'default'
  striped?: boolean; // default: false

  // Composition slots
  emptyState?: ReactNode;
  rowActions?: (row: Row) => ReactNode;
}
```

---

## Step 4 — State Management Strategy

Choose the right state strategy based on scope:

| State scope             | Strategy                                | Example                              |
| ----------------------- | --------------------------------------- | ------------------------------------ |
| Single component        | `useState` / `ref`                      | Form input value, toggle open/closed |
| Parent-child (2 levels) | Props + callbacks                       | Selected item in list → detail panel |
| Subtree (3+ levels)     | Context / `provide`/`inject`            | Theme, locale, auth user             |
| Cross-cutting / global  | Store (Zustand, Pinia, Redux)           | Shopping cart, notifications         |
| Server data             | Data fetching lib (TanStack Query, SWR) | API responses, cache                 |
| URL-derived             | Router state                            | Current page, filters, search params |

### State placement rules

1. **Lift state to the lowest common ancestor** — not higher.
2. **Colocate state with the UI that uses it** — don't put form state in a global store.
3. **Derive, don't duplicate** — if a value can be computed from existing state, don't store it separately.
4. **Server state ≠ client state** — use a data fetching library for server data; don't manually sync into local state.

---

## Step 5 — Composition Patterns

Select patterns based on the framework and use case:

### React

| Pattern                          | Use when                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `children` prop                  | General content projection                                                      |
| Render props / function-as-child | Consumer needs control over rendering with parent's data                        |
| Custom hooks                     | Shared stateful logic without UI                                                |
| Compound components              | Tightly coupled components that share implicit state (e.g., `<Tabs>` + `<Tab>`) |
| Higher-order components          | Cross-cutting concerns (rarely needed with hooks)                               |

### Vue

| Pattern                    | Use when                                   |
| -------------------------- | ------------------------------------------ |
| Named slots / scoped slots | Content projection with data exposure      |
| Composables (`use*`)       | Shared stateful logic                      |
| `provide` / `inject`       | Subtree-scoped state without prop drilling |
| Renderless components      | Expose logic without dictating markup      |

### General

| Pattern                     | Use when                                                   |
| --------------------------- | ---------------------------------------------------------- |
| Controlled vs. uncontrolled | Components that manage form-like state — offer both modes  |
| Headless UI                 | Logic-only components (no styles) for maximum flexibility  |
| Adapter pattern             | Wrapping third-party components with a stable internal API |

---

## Output — Component Architecture Spec

```markdown
# Component Architecture: [Feature / Page Name]

## Component Tree

[ASCII tree with annotations]

## Component Catalog

### [ComponentName]

- **Type**: Container / Presentational
- **Responsibility**: [one sentence]
- **Props**: [interface or key props list]
- **State owned**: [local state description, or "none"]
- **Events**: [callbacks emitted]
- **Composition**: [children, slots, render props used]

## State Management

[Strategy chosen and rationale]

## Data Flow Diagram

[ASCII or described: which components talk to which, via what mechanism]

## Decisions & Trade-offs

- [Decision made and why]
- [Alternative considered and why rejected]

## File Structure (Suggested)

[Directory layout for the components]
```

## If Connectors Available

If **~~source control** is connected:

- Inspect existing components to identify reuse opportunities
- Check for existing design patterns and conventions in the codebase

If **~~knowledge base** is connected:

- Reference team component naming conventions and patterns
- Check for existing component library documentation

## Tips

1. **Start from the UI, not the data** — Draw component boundaries based on what users see and interact with, then wire up the data.
2. **Favor composition over inheritance** — In every framework, composing small components beats extending large ones.
3. **Name components by what they ARE, not what they DO** — `<UserAvatar>` over `<RenderUserImage>`.
4. **One file, one component** — Unless components are tightly coupled (compound pattern), keep them in separate files.
5. **Design for deletion** — Components should be easy to remove or replace without cascading changes.
