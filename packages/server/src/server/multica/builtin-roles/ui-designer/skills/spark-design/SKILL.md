---
name: spark-design
description: "Spark Design component router for AI Web App UI development. Routes UI requirements to Spark Design components, provides installation commands, and uses cached source references for props and usage. Use when building UI with Spark Design, choosing components, asking about component props, or reviewing Spark Design UI."
version: 1.0.0
---

# Spark Design Component Router

Spark Design is a component library (based on shadcn/Radix UI) for AI Web App development. Two installation modes are supported: **CLI** (copy source) and **NPM** (full package).

Documentation site: https://qoderdesign.io.alibaba-inc.com/#/

## Step 0: Detect Installation Mode

Before writing any code, determine which mode the user's project uses:

| Signal                                                                 | Mode         |
| ---------------------------------------------------------------------- | ------------ |
| `package.json` has `"sparkdesign"` in dependencies                     | **NPM**      |
| Project has `components.json` with `aliases.ui` pointing to local path | **CLI**      |
| Existing imports use `from 'sparkdesign'`                              | **NPM**      |
| Existing imports use `from '@/components/ui/...'`                      | **CLI**      |
| User says "npm" / "包引入" / "full package"                            | **NPM**      |
| User says "npx add" / "CLI" / "源码复制"                               | **CLI**      |
| Unclear                                                                | Ask the user |

## Workflow: Using Components

When a user needs UI development:

1. **Route**: Find the right component(s) from the routing table below
2. **Check cache**: Look for cached source in this skill's directory at `src/components/ui/basic/<name>.tsx` or `src/components/ui/chat/<name>/`
3. **Download if missing**: If no cached source, run:
   ```bash
   cd <this-skill-directory> && npx sparkdesign add <component-name>
   ```
   This downloads latest source to the skill dir for reference. The skill dir already has `components.json` configured.
4. **Read source**: Read the downloaded `.tsx` files to understand exact props, types, and patterns
5. **Install in user project** (mode-dependent):
   - **CLI mode**: `cd <user-project-dir> && npx sparkdesign add <component-name>`
   - **NPM mode**: Ensure `sparkdesign` is in dependencies (`npm install sparkdesign` if not). No per-component install needed.
6. **Write code** with the correct import path:
   - **CLI mode**: `import { Button } from '@/components/ui/button'`
   - **NPM mode**: `import { Button } from 'sparkdesign'` (all components from one entry point)

**Important**: Always read the actual source file for accurate props. The routing table below provides brief descriptions only — the source is the ground truth. The cached source applies to both modes — the Props and component API are identical.

**NPM mode style setup**: NPM projects need to import styles once in the app entry:

```tsx
import "sparkdesign/style"; // required: component styles + design tokens
// optional theme overrides:
// import 'sparkdesign/theme.css'  // custom theme
// import 'sparkdesign/scale.css'  // density scale
```

**Cache update**: If user wants the latest version, run `npx sparkdesign add <name> -o` (overwrite) in the skill directory.

**[Docs only] tag**: Components marked `[Docs only]` exist on the documentation site but are NOT yet available via `npx sparkdesign add`. For these, visit the doc page at `https://qoderdesign.io.alibaba-inc.com/#/<name>` and implement from the code examples shown there.

## Basic UI Components

| CLI Name           | Component       | When to Use                                                                                                     |
| ------------------ | --------------- | --------------------------------------------------------------------------------------------------------------- |
| `alert-dialog`     | AlertDialog     | Confirmation dialogs, destructive action warnings, modal confirmations requiring explicit user choice           |
| `alert`            | Alert           | Inline callout banners: info, success, warning, error notifications within page content                         |
| `aspect-ratio`     | AspectRatio     | Maintain fixed aspect ratios for images, videos, embedded content (e.g. 16/9, 1:1)                              |
| `avatar`           | Avatar          | User profile images with fallback, avatar groups, sized badges (sm/default/lg)                                  |
| `breadcrumb`       | Breadcrumb      | Hierarchical navigation trails showing page path                                                                |
| `button`           | Button          | Clickable actions. variant: primary/secondary/tertiary/outline/ghost/text. size: sm/md/lg. rounded: square/pill |
| `button-group`     | ButtonGroup     | Join adjacent buttons into a single control group, horizontal or vertical                                       |
| `calendar`         | Calendar        | Date selection calendar grid (react-day-picker based)                                                           |
| `card`             | Card            | Surface containers: Card + Header/Title/Description/Action/Content/Footer                                       |
| `carousel`         | Carousel        | Horizontal scrollable content carousel (Embla based)                                                            |
| `chart`            | Chart           | Recharts wrapper: container, tooltip, legend, style helpers                                                     |
| `checkbox`         | Checkbox        | Tri-state checkbox: checked/unchecked/indeterminate. size: sm/md/lg                                             |
| `collapse`         | Collapse        | Vertically stacked expandable panels (accordion). type: single/multiple                                         |
| `collapsible`      | Collapsible     | Minimal show/hide toggle primitive                                                                              |
| `collapsible-card` | CollapsibleCard | Card with collapsible header/content/footer. Used by FileReviewPart, TaskPart, PlanPart                         |
| `combobox`         | Combobox        | Searchable dropdown option picker for small local option sets                                                   |
| `command`          | Command         | Command palette (cmdk based) for search, command menus, keyboard navigation                                     |
| `context-menu`     | ContextMenu     | Right-click menus with items, checkbox, radio, sub-menus, shortcuts                                             |
| `data-table`       | DataTable       | Generic table renderer for structured records with sorting/filtering in userland                                |
| `date-picker`      | DatePicker      | Native date/time picker input                                                                                   |
| `dialog`           | Dialog          | Generic modal. size: sm/default/lg/xl. For non-destructive confirmations and forms                              |
| `direction`        | Direction       | LTR/RTL direction provider for internationalized layouts                                                        |
| `drawer`           | Drawer          | Side panel overlay. side: top/right/bottom/left. For settings, details panels                                   |
| `dropdown-menu`    | DropdownMenu    | Click-triggered dropdown with items, checkbox, radio, sub-menus                                                 |
| `ellipsis-text`    | EllipsisText    | **[Docs only]** Text truncation with tooltip on hover when overflowing. Supports multi-line                     |
| `empty`            | Empty           | Empty state placeholder: media, title, description, action buttons                                              |
| `field`            | Field           | Form field layout: label, description, error message, grouped controls                                          |
| `hover-card`       | HoverCard       | Lightweight preview popup on hover/focus                                                                        |
| `icon-button`      | IconButton      | Icon-only button matching Button variants and sizing                                                            |
| `input`            | Input           | Single-line text input with all native types including file                                                     |
| `input-group`      | InputGroup      | Input with inline/block addons and embedded controls                                                            |
| `input-otp`        | InputOTP        | One-time passcode input (input-otp based)                                                                       |
| `item`             | Item            | Settings rows, records, compact list items                                                                      |
| `kbd`              | Kbd             | Keyboard shortcut display: mono font key caps                                                                   |
| `label`            | Label           | Accessible form label (pairs with Input/Checkbox via htmlFor)                                                   |
| `menubar`          | Menubar         | Application menubar for desktop-style menus                                                                     |
| `native-select`    | NativeSelect    | Native `<select>` wrapper with Spark styling                                                                    |
| `navigation-menu`  | NavigationMenu  | Top-level navigation with sub-menus and panels                                                                  |
| `option-list`      | OptionList      | Option list for Q&A or selection: items, selectedIds, prefix, disabled                                          |
| `pagination`       | Pagination      | Page navigation: prev/next links, page numbers, ellipsis                                                        |
| `popover`          | Popover         | Floating content surface for rich tooltips, mini-forms, popovers                                                |
| `progress`         | Progress        | Progress bar. variant: bar/block. Supports indeterminate state                                                  |
| `radio-group`      | RadioGroup      | Single-select radio group. orientation: vertical/horizontal. size: sm/md/lg                                     |
| `resizable`        | Resizable       | Resizable panel layout with draggable handles                                                                   |
| `scroll-area`      | ScrollArea      | Custom scrollable area (Radix ScrollArea)                                                                       |
| `scrollbar`        | Scrollbar       | Scrollable container with styled scrollbar: maxHeight, visibility control                                       |
| `select`           | Select          | Dropdown select: Root/Trigger/Content/Item/Group/Label/Separator                                                |
| `separator`        | Separator       | Visual/semantic divider: horizontal or vertical                                                                 |
| `sheet`            | Sheet           | Alias for Drawer (side panel overlay)                                                                           |
| `shimmering-text`  | ShimmeringText  | Animated gradient shimmer text with viewport-triggered animations                                               |
| `sidebar-menu`     | SidebarMenu     | Persistent sidebar navigation with selected state and per-item actions                                          |
| `skeleton`         | Skeleton        | Loading placeholder: rectangular or circular shapes                                                             |
| `slider`           | Slider          | Range input: single or multiple thumbs, horizontal/vertical                                                     |
| `spinner`          | Spinner         | Loading indicator (animated icon)                                                                               |
| `switch`           | Switch          | Toggle switch (boolean) or segmented control. variant: toggle/segment                                           |
| `table`            | Table           | Semantic HTML table: Header/Head/Body/Row/Cell/Caption/Footer                                                   |
| `tabs`             | Tabs            | Tab panels. variant: default/line. orientation: horizontal/vertical                                             |
| `tag`              | Tag             | Badge-style tag. appearance: filled/outline. 10+ color options                                                  |
| `textarea`         | Textarea        | Multi-line text input                                                                                           |
| `toast`            | Toast           | **[Docs only]** Toast notifications (sonner based): toast() API                                                 |
| `toggle`           | Toggle          | Two-state button: on/off. variant: default/outline                                                              |
| `toggle-group`     | ToggleGroup     | **[Docs only]** Group of toggle buttons: single/multiple selection                                              |
| `tooltip`          | Tooltip         | Portal tooltip on hover. placement: top/bottom/left/right                                                       |
| `typography`       | Typography      | Heading, paragraph, list style utilities                                                                        |

## Chat / AI Components

| CLI Name                   | Component              | When to Use                                                                             |
| -------------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `ask-user-part`            | AskUserPart            | AI asking user for confirmation with collapsible card and Skip/Run actions              |
| `browser-action-part`      | BrowserActionPart      | Display browser verification steps from AI Agent with Skip/Run buttons                  |
| `chat-input`               | ChatInput              | Chat composer: supports FolderButton, IconButton, SendButton, GenerationStatusBar       |
| `code-block-part`          | CodeBlockPart          | Code display in collapsible card: syntax highlight, filename, diff, generating state    |
| `conversation-anchor-nav`  | ConversationAnchorNav  | Right-side anchor rail for long conversations: auto-highlight visible message           |
| `file-attachment`          | FileAttachment         | File attachment chip in ChatInput: icon + filename + close button                       |
| `file-card`                | FileCard               | File card in chat flow: icon + filename + optional size, clickable                      |
| `file-review-part`         | FileReviewPart         | File review display with collapsible card and action buttons                            |
| `folder-button`            | FolderButton           | Folder selector button for ChatInput: label, selected state, clear                      |
| `generated-images-grid`    | GeneratedImagesGrid    | Flex grid for AI-generated images with +N overlay during generation                     |
| `generation-status-bar`    | GenerationStatusBar    | Green status bar above input: status text, icon, elapsed time                           |
| `hint-banner`              | HintBanner             | In-message hint: type wiki or credits (depleted + recharge link)                        |
| `image-attachment`         | ImageAttachment        | Image thumbnail attachment in ChatInput: closable, click to preview                     |
| `image-generating`         | ImageGenerating        | Image generation placeholder: fluid background + icon + overlay text                    |
| `markdown`                 | MarkdownBody           | Markdown renderer with GFM and math (KaTeX) support                                     |
| `mermaid-part`             | MermaidPart            | Mermaid diagram renderer for flowcharts, sequence diagrams, etc.                        |
| `permission-card`          | PermissionCard         | Auth/permission card: title, description, command; Deny/Allow actions                   |
| `plan-part`                | PlanPart               | Implementation plan display with View/Build action buttons                              |
| `queue-indicator`          | QueueIndicator         | Queue indicator above composer: remove, send-now, collapsible                           |
| `reasoning-step`           | ReasoningStep          | Reasoning step display: completed/in-progress status, expandable details                |
| `related-prompts`          | RelatedPrompts         | Recommended prompts above input: up to 3 items                                          |
| `response`                 | Response               | AI response container: streaming, static display, image generating states               |
| `send-button`              | SendButton             | Send/stop/recording button: normal/generating/recording states                          |
| `streaming-markdown-block` | StreamingMarkdownBlock | Token-by-token markdown streaming with CJK-aware segmentation and tail fade             |
| `task-part`                | TaskPart               | Task list with status tracking: completed/uncompleted/skipped                           |
| `terminal-code-block-part` | TerminalCodeBlockPart  | Terminal command + output display with auto-run indicators                              |
| `thinking-indicator`       | ThinkingIndicator      | Lottie thinking animation + text, used at end of Response                               |
| `tool-invocation-card`     | ToolInvocationCard     | Tool execution card: status icon + tool name + params + expandable response             |
| `user-message`             | UserMessage            | User message bubble container in chat flow                                              |
| `user-question-part`       | UserQuestion           | **[Docs only]** Multi-step questionnaire: single/multi-select, custom input, navigation |
| `user-question-answer`     | UserQuestionAnswer     | Summary card for UserQuestion submissions: auto Answer/Answers label                    |

## Scenario Quick Reference

**Forms & Input**: Field + Input/Textarea/Select/Checkbox/RadioGroup/Switch + Button
**Data Display**: Table/DataTable + Pagination + Tag + Avatar + Skeleton
**Navigation**: Tabs + Breadcrumb + NavigationMenu + SidebarMenu + Pagination
**Feedback**: Toast + Alert + Progress + Spinner + Dialog/AlertDialog
**Overlay/Popup**: Dialog + Drawer/Sheet + Popover + Tooltip + HoverCard + DropdownMenu + ContextMenu
**Layout**: Card + Separator + Resizable + Collapse + ScrollArea + AspectRatio
**Chat UI (full)**: ChatInput + Response + UserMessage + SendButton + GenerationStatusBar
**Chat Code**: CodeBlockPart + TerminalCodeBlockPart + MermaidPart
**Chat Status**: ThinkingIndicator + ReasoningStep + TaskPart + PlanPart + ToolInvocationCard
**Chat Files**: FileAttachment + FileCard + FileReviewPart + ImageAttachment + GeneratedImagesGrid
**Chat Interaction**: AskUserPart + PermissionCard + UserQuestion + RelatedPrompts + HintBanner
