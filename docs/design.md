# Design

Tokens — every color, font size, weight, spacing step, radius, icon size — live in `web/src/core/styles/theme.ts`.

---

## 1. Character

BySpace is minimal, spacious, quiet, confident. Whitespace is deliberate. Nothing crowds, nothing decorates, nothing apologizes. A row, a label, a control. That is the bar.

The app is calm so the user's work is not. Every visual decision serves either _act on this_ or _understand this_ — never _look at this_.

Consistency comes from component reuse, not from hand-matching styles across surfaces. A row in the projects list, a row in settings, and a row in a modal are the same component, not three implementations that happen to look alike. When two surfaces do the same semantic thing in two different ways, one of them is wrong.

---

## 2. Component reuse

A semantic element used in three or more places is a primitive. One of a kind is a screen.

Primitives live in `web/src/core/components/ui/` and `web/src/core/components/headers/`. Card and row layout live in `web/src/core/styles/settings.ts`. Section structure lives in `web/src/core/components/settings/headings/settings-section.tsx`.

A clickable element styled to look like a button is wrong; the button is `<Button>` (`web/src/core/components/ui/button.tsx`). Bare text styled to look like a section header is wrong; the section header is `<SettingsSection>` (`web/src/core/components/settings/headings/settings-section.tsx`). A custom dialog for a confirmation is wrong; the confirmation is `confirmDialog` (`web/src/core/utils/confirm-dialog.ts`). A hand-rolled overflow menu is wrong; the menu is `<DropdownMenu>` (`web/src/core/components/ui/dropdown-menu.tsx`). A hand-rolled status pill is wrong; the pill is `<StatusBadge>` (`web/src/core/components/ui/status-badge.tsx`).

Before adding a new component, read `components/ui/`. The primitive usually exists.

---

## 3. Hierarchy

Hierarchy is conveyed through weight and color, not size. Most interface text is `fontSize.base`; compact metadata and hints use `fontSize.sm`. The distinction between a row's primary line and its secondary line is `foreground` versus `foregroundMuted`.

The interface face is Geist, self-hosted from `web/public/fonts` with the platform UI faces behind it for CJK (`DEFAULT_UI_FONT_STACK` in `theme.ts`). The interface ramp has a 14px base, which is also the default size. The Appearance **Interface size** setting is the rendered `fontSize.base` value and scales the rest of the UI ramp proportionally. Primary readable content has its own `fontSize.content`, which defaults to 15px. It owns message bodies, composer input, Markdown, and PR prose. Controls, navigation, metadata, tool chrome, code, diffs, editors, and terminals stay on their interface or code tokens. **Code size** remains independent.

Weight is applied by role:

- **Screen titles** — the title in app chrome — use `<ScreenTitle>` (`web/src/core/components/headers/screen-title.tsx`), which renders `fontSize.base` at `fontWeight.medium`; the project beside it is plain `foregroundMuted` text, not a chip. The New workspace hero is the only larger product title; it uses `fontSize["2xl"]` (`web/src/core/screens/new-workspace-screen.tsx`).
- **Structural labels** use `fontWeight.medium`. This applies to section labels above a stack of rows (`web/src/core/components/agent-list.tsx`, `web/src/core/components/keyboard-shortcuts-dialog.tsx`), form field labels above an input inside a modal (`web/src/core/components/add-host-modal.tsx`, `web/src/core/components/pair-link-modal.tsx`), the title at the top of a modal/sheet/dialog (`web/src/core/components/adaptive-modal-sheet.tsx`, `web/src/core/components/ui/combobox.tsx`, `web/src/core/components/welcome-screen.tsx`), inline data emphasis on dense metadata rows (`web/src/core/git/diff-pane.tsx`, `web/src/core/components/file-explorer-pane.tsx`), and, following shadcn/ui, control labels: `<Button>`, `<SegmentedControl>` and tab labels, `<StatusBadge>` and key-cap text, tool-call row labels, and sidebar project titles. The selected sidebar row also turns `medium`; that weight shift is half of its selection signal (§12).
- **Content** uses `fontWeight.normal`. This applies to settings rows (`web/src/core/styles/settings.ts`), idle sidebar workspace titles (`web/src/sidebar/workspace-row.tsx`, `web/src/core/components/agent-list.tsx`), menu items, field text, and `<SidebarCallout>` titles (`web/src/core/components/sidebar-callout.tsx`).

Control chrome copies shadcn/ui (nova style, `neutral` base colour). The visual contract is `design/component-sheet.html`, and the numbers it uses come from the source snapshot in `design/references/shadcn/`. Read a value from there instead of eyeballing one.

The rule, condensed: text that _names_ a surface or a group is `medium`. Text that lives _inside_ a surface or a group is `normal`. Top-of-screen titles are `<ScreenTitle>`, which is lighter still. The name of the app itself, in a sidebar's corner row, is the one label above `medium`.

Foreground is for the thing being acted on: row titles, section headings, the selected sidebar item. `foregroundMuted` is for context: hints, descriptions, secondary metadata, idle sidebar items, placeholders, status text.

`foregroundExtraMuted` is reserved for passive chrome that must sit behind muted text, such as an always-visible window control. Use the solid token instead of lowering SVG opacity; per-path opacity makes overlapping icon strokes render unevenly. Interactive hover and pressed states return to `foreground`.

Accent is the one CTA per surface. A `<Button variant="default">` filled with `accent` appears at most once on a page. Most pages have zero — settings is mostly toggles and text, the workspace pane is mostly content, the chat composer is the input itself.

Destructive is a color, not a click. Restart-daemon and remove-host are `<Button variant="outline">` in the row trailing slot; the destructive surface only appears inside the `confirmDialog` (`web/src/core/screens/settings/host-page.tsx`). Workspace archive opens a confirm dialog before any red appears (`web/src/sidebar/workspace-row.tsx`). Red appears after the user has indicated intent.

---

## 4. Buttons

The button is `<Button>` (`web/src/core/components/ui/button.tsx`). It has five variants. Each has one job.

`default` is the one primary action on a surface — filled with `accent`. At most one per page. The primary slot inside an `<AdaptiveModalSheet>` and the highlighted action on the welcome screen are the canonical uses.

`secondary` is the paired action when two actions carry equal weight — filled with `surface2`, `surface3` on hover. The component default is `secondary`, which matches its frequency in the codebase.

`outline` is the low-frequency action that lives on a row — `controlFill` behind a `borderAccent` border, `controlFillHover` on hover. Restart, Remove, Update on host detail (`web/src/core/screens/settings/host-page.tsx`). Header split buttons (open in editor, git actions, scripts) use the same outline chrome at `HEADER_CONTROL_HEIGHT`.

`ghost` is structural and non-committal — no border, no fill. Back arrows, header toggles, "Load more" footers (`web/src/core/screens/sessions-screen.tsx`), more-affordances. Ghost is used when the affordance is part of the chrome, not a decision.

Header and toolbar controls use `interactionHighlight` for hovered, pressed, open, and selected
backgrounds. It is a translucent semantic fill so the same control works over the main surface and
the sidebar. Apply it as `backgroundColor`; setting `opacity` on the control also fades its content.

`destructive` is a soft tint (`destructiveSoft`) with `destructive` text, as in shadcn/ui; a solid red slab is wrong. It only appears inside a confirm. The button on the page is `outline`; the destructive button is the confirm button inside the dialog.

Every variant sinks one pixel when pressed instead of fading, and every focusable control takes the same focus ring: the border turns `ring` and a 3px `focusRing` outline sits flush outside it.

Sizes: `xs` for ultra-tight inline triggers. `sm` for any button sitting in a row. `md` is the page default. `lg` is reserved for large standalone CTAs.

Sizes are a shared contract across control kinds, defined once in `control-geometry.ts`. From the `md` breakpoint up they are shadcn/ui's heights, `DESKTOP_CONTROL_HEIGHTS`: `xs` 24px, `sm` 28px, `md` 32px, `lg` 36px. Below it the touch heights stay (`xs` 28, `sm` 32, `md`/`lg` 44) so a phone keeps finger-sized targets. `xs` takes `fontSize.sm` labels; the rest take `fontSize.base`. `<SegmentedControl>` (`web/src/core/components/ui/segmented-control.tsx`) takes the same `xs`/`sm`/`md` sizes — a segmented control next to a `<Button>` of the same size always matches in height and label size. It is shadcn/ui's tabs list: a `surface2` track with a 3px inset (2px at `xs`) holding a raised selected segment (`segmentedThumb` with `shadow.sm`; in dark a translucent fill with a `borderAccent` edge), its corner one step tighter than the track's. Thin chrome such as the file toolbar uses `xs`; settings rows use `sm`. Never shrink a control's font or padding locally to fit a context — if the context needs a smaller control, the size tier is missing or the wrong one is in use.

A clickable element wrapping text is a sixth variant. It is wrong. `<Button>` accepts `style`, `textStyle`, `leftIcon`, `disabled`, `size`, and `variant`.

---

## 5. Borders

Borders group, separate, or rarely emphasize.

A logical block of related rows lives inside a card — one border around the whole group. The card primitive is `settingsStyles.card`; the keyboard-shortcuts dialog uses the same shape inline (`web/src/core/components/keyboard-shortcuts-dialog.tsx`). The border defines what belongs together.

Rows after the first inside a card carry `settingsStyles.rowBorder` — a single top border. The first row never has one. The same divider pattern appears in the keyboard-shortcuts dialog rows (`web/src/core/components/keyboard-shortcuts-dialog.tsx`). Rows do not need their own background to feel separated.

A list that is itself the page content — sidebar items in `web/src/sidebar/workspace-list.tsx`, the workspace list, the agent list (`web/src/core/components/agent-list.tsx`) — uses spacing and surface, not borders, to separate items. Rows-in-a-card is an interior pattern; lists-as-pages are not.

Pane chrome — the workspace pane header, the file-explorer header, the diff pane header — uses a single bottom border to separate the header from the content (`web/src/core/git/diff-pane.tsx`). One border, no shadow.

`border` frames cards, panes and dividers. `borderAccent` is shadcn/ui's `input` colour: the edge of every control a user types into or presses — fields, the composer, outline and split buttons, checkboxes. In light the two are the same grey; in dark `borderAccent` is one step brighter so controls separate from the cards they sit on. Single-thing borders are wrong; a single bordered element is either a card with one row (use the card) or it does not need a border.

---

## 6. Pickers

Five primitives. The pick is determined by option count, the need to search, and how the picker is anchored.

`<DropdownMenu>` is for a small fixed set anchored to a trigger. Theme picker, kebab menus on workspace and project rows (`web/src/sidebar/project-block.tsx`, `web/src/sidebar/workspace-row.tsx`), row "more" menus. Items can be async (`status: "pending"`) and can include destructive entries. Under ~10 options where the user knows what they're looking for.

`<Combobox>` is for a large or searchable list. Host switcher in the sidebar footer, model selector in the composer, branch switcher in the workspace header (`web/src/core/components/branch-switcher.tsx`). The user types to find the option, or the list is long enough to scroll. Its desktop popover is never narrower than its trigger and grows with its content up to `max(400px, trigger width)`; `desktopMinWidth` raises the floor and never caps the width. Changing that default means re-checking every combobox, since each one was laid out against it.

`<ContextMenu>` is for right-click and long-press on a target. The row is the trigger; there is no visible affordance. Used for incidental actions on workspace rows in the sidebar (`web/src/sidebar/workspace-row.tsx`).

`<AdaptiveModalSheet>` is for a focused task. Multi-field forms (`web/src/core/components/add-host-modal.tsx`, `web/src/core/components/pair-link-modal.tsx`), confirmations with detail, anything that earns a backdrop. Bottom sheet on compact, centered card on desktop. A bare `Dialog` or `Drawer` is wrong for any of these.

`<AdaptiveModalSheet>` owns the presentation. Its content inset — the gutter that puts sheet content on the same rails as the sheet header — and compact bottom safe-area padding are the sheet's, not the caller's. A caller declares layout intent through `contentStyle` and never branches on form factor to add its own margins. If a sheet's first snap point is shorter than its header, content, and safe-area clearance, raise that snap point rather than moving the sheet container.

The desktop card is shadcn/ui's dialog: `popover` fill, hairline `border`, `shadow.lg`, and a footer strip on `surfaceFooter`. Footer actions sit on the right at their content width, cancel before confirm; buttons stretched to share the row are the compact sheet's layout, not the desktop card's.

Tooltips invert against the surface (`tooltip` fill, `tooltipForeground` text, no border or shadow); a key cap inside one reads `TooltipSurfaceContext` and inverts with it. Text inside tooltip content takes `tooltipForeground` or `tooltipForegroundMuted`, never `foreground`.

`confirmDialog` is for destructive yes/no and imperative confirmation. Promise-based: `await confirmDialog({ destructive: true, ... })`. Anything where a wrong click loses work.

Three themes is `DropdownMenu`. Thirty hosts is `Combobox`. A label and a value is `AdaptiveModalSheet`. "Are you sure?" is `confirmDialog`.

---

## 7. Density and rhythm

Settings detail pages, the projects detail page, and any list+detail content sit inside a centered, max-width 720 column (`web/src/core/screens/settings-screen.tsx`, `web/src/core/screens/projects-screen.tsx`). Lines stay readable, the eye does not have to track wide horizontal distances. Form modals carry their own narrower content frame (`web/src/core/components/add-host-modal.tsx`).

Workspace and chat surfaces use the full width — these are working surfaces, not reading surfaces. The composer carries `MAX_CONTENT_WIDTH` from `web/src/core/constants/layout.ts` to keep lines readable while letting the workspace pane fill the rest.

Sections sit apart. `<SettingsSection>` owns its own bottom margin; the next thing is wrapped in another `<SettingsSection>`. The agent-list `sectionHeading` carries the same `marginTop`/`marginBottom` rhythm (`web/src/core/components/agent-list.tsx`). Adding `marginBottom` to a section is wrong.

A section or group explains itself through the `info` prop on `<SettingsSection>` or `<SettingsGroup>` — an info icon beside the header that opens a tooltip (`web/src/core/components/settings/headings/settings-info-tip.tsx`). A muted paragraph between the header and the card is wrong: it sits in the section's own gap, so it reads as a second heading rather than as prose belonging to the header. Explanatory copy that describes one row belongs to that row, as `settingsStyles.rowHint` inside the card.

A section may collapse (`collapsible` on `<SettingsSection>`, chevron on the header) when it is not the reason someone opened the page and its length would push the sections that are below the fold — an unbounded list, a catalog visited once per install, a long log. Collapsing is for length, not for tidiness: a collapsed section hides whether the thing it owns is configured at all, so anything worth reading at a glance stays open. When a section does open collapsed, its header carries a `collapsedSummary` for the state the reader would otherwise have to expand to see — a count, an enabled fraction — rather than a bare label. `defaultCollapsed` defaults to false; a page whose every section starts closed is an index, not a settings page.

Cards inside a section sit closer than sections. Rows inside a card touch — only the divider separates them. The rhythm is page → spacious; section → spacious; card → tight.

Settings rows are shadcn/ui items: at least 56px tall with 12px vertical padding, inside a card with a hairline `border`, a `borderRadius.xl` corner and no shadow. Sidebar list items are 32px rows on desktop (36px on compact). Compressing rows below the established density to fit more on the screen is wrong. Too many rows means more cards or more sections, not smaller rows.

The whitespace is the design.

---

## 8. Alignment

Things align to their glyphs, not to their boxes. A row's leading icon, its title, and the label of the button in its trailing slot sit on the same rails — the ink lines up, not the padding, not the touch target, not the hover background.

Pick the rails from the content, then hold them. A settings card establishes a leading rail at the icon's left edge and a trailing rail at the last glyph's right edge; every row in that card uses the same two. A row whose icon is absent still starts its title on the leading rail. Indentation is a new rail, not an arbitrary offset.

The pressable is bigger than the glyph, and that is fine. Hit areas grow outward from the aligned content — they never move it. A button that looks two pixels off because its padding is asymmetric is misaligned even though its box is correct.

Optical alignment beats arithmetic when a glyph disagrees with its bounding box. Icons with visual weight on one side, chevrons, and single-character labels usually need a small nudge to look centered. Trust the eye, then leave a comment saying the offset is optical.

One row off the rail makes the whole card look unconsidered.

---

## 9. Responsiveness

Compact-first. The small case is designed; the large case adds chrome around it.

The list+detail pattern is canonical and reused across surfaces. The settings shell (`web/src/core/screens/settings-screen.tsx`) and the projects screen (`web/src/core/screens/projects-screen.tsx`) implement it identically:

- On compact: full-screen list with `<BackHeader>` at the top. Tapping a row pushes a full-screen detail with its own `<BackHeader>` that returns to the list.
- On desktop: a 320px sidebar on the left holds the list with `surfaceSidebar` background. The content pane on the right holds the selected detail with `<ScreenHeader>`, `<HeaderIconBadge>`, and `<ScreenTitle>`.

The branching is one `useIsCompactFormFactor()` check at the top of the screen component. The list and the detail are the same components in both layouts; only the framing changes.

The workspace screen (`web/src/core/screens/workspace/workspace-screen.tsx`) follows a different but parallel rule: tabs collapse on compact, panes split on desktop. The sidebar (`web/src/app/app-sidebar.tsx`) is overlaid on compact and pinned on desktop.

On a narrow desktop route, app navigation yields to the rendered content topology when the remaining width cannot preserve its center target: Settings keeps its 320px list + 400px detail split, and a workspace Explorer keeps its current visible width plus a 400px center pane. That is a topology decision at the app container, not a second compact breakpoint. Temporary width clamps are render-only; widening restores the user's saved sidebar widths. The 720px desktop breakpoint preserves the default 320px sidebar and target 400px center width when the Explorer is closed; it is product policy, not a layout gate.

The left sidebar's top-left corner and the Explorer dock's top-right corner each hold one control at a fixed position. The sidebar collapse toggle and the Explorer toggle render from two hosts apiece — the pinned sidebar or a content header, the Explorer dock's tab rail or a content header — and both hosts keep the toggle's own frame on the same pixel. That works because the row and the hairline under it add up to `HEADER_INNER_HEIGHT` in both hosts, leaving the same content box to center in, so expanding or collapsing a panel never moves the pointer target. Exactly one host renders each toggle; see `web/src/core/components/sidebar/sidebar-toggle-host.ts`, `web/src/core/contexts/desktop-sidebar-visibility-context.tsx`, and `resolveWorkspaceExplorerToggleOwner`.

Which surface hosts a corner toggle is a placement rule, not platform gating, and no corner needs clearance declared for it. Everything above the app shell in those corners is the app's own chrome.

A new list+detail feature copies the settings shell. A new workspace-shaped feature copies the workspace shell. Inventing a third shape happens in design review, not in a PR.

---

## 10. Copy and voice

Sentence case. "Pair a device", "Danger zone", "Restart daemon", "Inject BySpace tools", "No sessions yet", "Load more". Proper nouns retain casing — BySpace, Beta, Stable, Local. Title case is wrong.

No trailing periods on row titles, labels, or buttons. No trailing period on a single-clause hint: "What happens when you press Enter while the agent is running" (`web/src/core/screens/settings-screen.tsx`). Periods exist inside multi-sentence prose: "Restarts the daemon process. The app will reconnect automatically."

Empty-state strings are short noun phrases or short sentences: "No projects yet", "Select a project", "No sessions yet" (`web/src/core/screens/sessions-screen.tsx`), "Host not found".

Buttons are imperative: Save, Cancel, Restart, Remove, Update, Install update, Add host, Load more. In-flight labels are present-participle with a literal three-dot ellipsis: "Saving...", "Restarting...", "Removing...", "Loading...".

Error copy is direct. "Unable to remove host" (`web/src/core/screens/settings/host-page.tsx`), not "Sorry, we couldn't remove the host." Recovery instructions are concrete: "Wait for it to come online before restarting." Errors describe state; they do not editorialize.

Terminology:

- Workspace, never "checkout".
- Host, except where the user-facing concept is the daemon process itself ("Restart daemon").
- Project, not "repo" or "repository".
- Provider, not "model provider".
- Session and agent are distinct: a session is a historical entry in `sessions-screen.tsx`; an agent is a live entity in the workspace.

---

## 11. States

Loading is inline by default. `<LoadingSpinner size={14} color={foregroundMuted} />` sits next to the thing it relates to (`web/src/core/screens/settings/providers-section.tsx`). Page-level loading is a centered `<LoadingSpinner size="large">` (`web/src/core/screens/sessions-screen.tsx`). Card-level loading is a single short line, not a spinner. In-row dropdown items use `<DropdownMenuItem status="pending" pendingLabel="Removing...">`; the menu item handles its own pending state.

Empty states are short noun phrases. Centered, muted, one or two lines. Sessions screen pairs the empty noun with a single ghost button to navigate back (`web/src/core/screens/sessions-screen.tsx`); that pairing is the maximum elaboration. Illustrations and CTAs disguised as empty states are wrong.

Inline errors are a single sentence in `palette.red[300]` `xs`, sitting under the field or inside the card it relates to (`web/src/core/screens/settings/providers-section.tsx`).

Page-level alerts — informational notices, success confirmations, warnings, or recoverable errors that need a small visible block on the page — use `<Alert>` (`web/src/core/components/ui/alert.tsx`). Variants: `default`, `info`, `success`, `warning`, `error`. The chrome is quiet by design: a 1px tinted border, transparent background, a small variant-tinted icon, the title in the variant accent, the description in `foregroundMuted`. Actions go in the `children` slot as `<Button variant="outline" size="sm">` — recovery actions are low-frequency and outline keeps them quiet alongside the alert's accent (`web/src/core/screens/project-settings-screen.tsx`). One `<Alert>` at a time per region.

Sidebar callouts — cross-cutting alerts that apply across the whole app, like worktree setup — register through `useSidebarCallouts()` and render in the left sidebar via `<SidebarCallout>` (`web/src/core/components/sidebar-callout.tsx`). The chrome (top-border-only, full-width action buttons) is tuned for that ~280px column. Canonical source: `web/src/core/components/worktree-setup-callout-source.tsx`. Never import `<SidebarCallout>` into a page — that's what `<Alert>` is for.

Imperative errors are `showAlert("Error", "Unable to ...")` (`~/lib/alert`, shown as an error toast; not this component) for failures that interrupt the flow and have no place on the page.

Disabled state is `opacity: theme.opacity[50]` on the outer control. Color changes for disabled state are wrong; a disabled button is the same button, dimmer.

Partial failure (a list mostly fine but one source errored) is a bordered banner above the list, listing each failure in red-300 `xs` (`web/src/core/screens/projects-screen.tsx`). The list still renders.

State surfaces at the smallest scope it affects. Field error stays under the field; page error is a banner; flow-stopping error is an `Alert`.

Changing state must not move the layout. A row that grows when its badge arrives, a card that reflows when a count resolves, a list that jumps as data streams in — all wrong. Reserve the space the loaded state will need, so the skeleton, the spinner, and the content occupy the same box. A surface that shifts under the user stops feeling calm.

---

## 12. List rows

The row anatomy is a content column with an optional trailing slot. Inside a card the row is `settingsStyles.row`. Inside a sidebar list the row carries its own padding and `borderRadius.md` per item (`web/src/sidebar/workspace-row.tsx`).

Rows that drill into a detail lead with a chevron in the trailing slot (`ChevronRight`, `iconSize.sm`, `foregroundMuted`). The whole row is the button. Pair-device row (`web/src/core/screens/settings/host-page.tsx`), provider row (`web/src/core/screens/settings/providers-section.tsx`), project row in the projects list. Chevron means navigation.

Kebab menus (`<DropdownMenu>` with `<MoreVertical size={14} />` trigger) are for actions on the row, not navigation. Trigger style: `padding: 2`, `borderRadius: 4`, hover background `surface2`. Menu position: `align="end"`. Items use `<DropdownMenuItem leading={<Icon size={14} color={foregroundMuted} />} ...>`. Visibility is hover on desktop and always on compact layouts ([hover.md](hover.md); `web/src/sidebar/project-block.tsx`).

A row may carry both a chevron and a kebab when both navigation and row-level actions apply. Chevron sits at the end; kebab sits before it.

Switches and segmented controls also sit in the trailing slot. A row that both navigates and toggles is a button row with a `<Switch>` in the trailing slot — the switch calls `event.stopPropagation()` so the row press does not fire (`web/src/core/screens/settings/providers-section.tsx`). Sidebar items that hold a status dot, a count, and a kebab follow the same rule (`web/src/sidebar/workspace-row.tsx`).

Hover and selection share one fill, `surfaceSidebarSelected` (= `surface2`, shadcn/ui's `sidebar-accent`), in both the settings list+detail and the sidebar list (`web/src/core/screens/settings-screen.tsx`, `web/src/core/components/agent-list.tsx`). The selected row is told apart by a 2px `foreground` bar on its left edge and a `medium` title, not by a darker fill. Horizontal tabs (workspace tabs, the Explorer rail) are the other half of that pair: no fill, and the active tab carries a 2px `foreground` underline on the bar's bottom edge. Vertical lists use the left bar, horizontal tabs use the underline; do not swap them.

---

## 13. Status pills and badges

There is exactly one token per status signal — `statusSuccess`, `statusDanger`, `statusWarning`, `statusMerged` — and every status surface uses it: PR state icons, CI check icons and pies, diff stats, file-change icons, status pills, usage bars. A surface does not get a quieter or louder variant because of where it sits. If a dense list feels loud, that is a density or weight problem; fix the density, not the color. The tokens are generated, not hand-picked — see the rule in `web/src/core/styles/theme.ts` and regenerate rather than nudging one value. The level is set by the densest consumer, the sidebar workspace list.

Status **dots** are the one exception, and they are a family of their own — `statusDotSuccess`, `statusDotDanger`, `statusDotWarning`, `statusDotRunning`, read only through the bucket table in `web/src/sidebar/status-visuals.tsx`. Same hues and the same generation rule, but their own band: 90% of gamut chroma against the status family's 55–60%. A dot is a few points of solid color with no shape to read and no label attached, and the running one pulses, so at the status band's chroma the dots read dimmer than the metadata beside them — backwards, since the dot is the row's state. Lightness is set by hue separation rather than by distance from the surface: at 6pt four dark hues on a light surface all read as one dark blob no matter how much contrast they have. So the light band runs as bright as the contrast floor allows at L=0.62, the last step where all four clear 3:1 against the sidebar's `surface2`; the dark band sits at L=0.72, where danger turns pink above. All four move together; regenerate the set, never one hue.

Status pills use the status token for text on a borderless `surface2` pill (shadcn/ui's secondary badge); a muted pill uses `foreground` text. The neutral shell keeps the signal legible without manufacturing translucent colors outside the theme. The `<StatusBadge>` primitive (`web/src/core/components/ui/status-badge.tsx`) is canonical; a pill never reaches into `palette`.

Status dots — the small filled circles next to a host or agent name — are `borderRadius.full` filled with the status token. Which token a given agent state maps to is owned by the bucket table in `web/src/sidebar/status-visuals.tsx`; every sidebar status surface reads it rather than restating the mapping. They sit in the trailing slot of a sidebar row or as a leading marker on a status pill.

Identity badges — the project icon, the sidebar host badge, and the PR-panel participant avatar — do not use the theme palette. They draw from the fixed ten-color identity table in `web/src/core/styles/identity-colors.ts`, whose hexes are held to one contrast band so a color identifies rather than ranks. Project icons and PR avatars use it as a fill with a white letter — that is `identityColor`, one theme-independent hex per identity. Host badges use it as a _foreground_ on both the glyph and the label, which is a different contrast problem that the fill table cannot solve: no single hex clears 4.5:1 against both a near-white and a dark sidebar. Foregrounds therefore come from `identityForeground(name, colorScheme)`, one set per scheme, hue unchanged. That set is generated on the **status family's** lightness and chroma fraction, because a meta row puts a host badge beside a CI check and a diff stat, and two families at different lightness make the brighter one shout. Change the status band and this one changes with it. A host with no color assigned falls back to `foregroundMuted`. The table is theme-independent by design; do not fork it per theme, and do not add hexes to it without recomputing the band.

New status pills use `<StatusBadge>`. Identity, shortcut, and interactive link badges remain separate because color does not encode status there.

---

## 14. Forbidden

- `fontWeight.medium` on idle row titles, body text, menu items, or `<SidebarCallout>` titles. Medium is the structural and control-label tier described in §3. Anything else is `normal`. `<ScreenTitle>` is `medium` and is never overridden.
- A clickable element wrapping text to make a button. `<Button>` exists.
- Bare text for a section header inside settings. `<SettingsSection>` exists.
- A muted paragraph between a section header and its card. Section-level explanation is the header's `info` tooltip (§7).
- A "Settings" CTA on a detail page. Detail pages are settings; settings is reached from the sidebar, the host entry, or a row's kebab menu.
- The word "checkout" in UI strings or identifiers. The term is "workspace".
- New color tokens or hardcoded hex outside the palette. The identity color table is the documented exception (§13), not a license.
- Placeholder text dimmed beyond `foregroundMuted`. No extra opacity, no italics, no ghost-text.
- Hover-revealed controls that only JavaScript reveals, or that compact layouts cannot reach. Hover is CSS `group-hover` with a compact fallback ([hover.md](hover.md)).
- Spacing values outside the scale. `padding: 20` and `gap: 10` are wrong.
- Color changes for disabled state. Opacity only.
- Destructive actions without `confirmDialog`. Restart, remove, and future destructive actions are confirmed. Archive workspace is confirmed only when its worktree backing reports uncommitted changes or unpushed commits; otherwise it archives immediately.
- Bespoke status pills. `<StatusBadge>` is the pill primitive.
- A bare `Dialog` or `Drawer` for a focused task. `<AdaptiveModalSheet>` is the modal primitive.
- A hand-rolled spinner. `<LoadingSpinner>` is the loading primitive.

---

## 15. Canonical surfaces by pattern

| Pattern                                             | Reference                                                                                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List+detail (compact stack, desktop sidebar+pane)   | `web/src/core/screens/settings-screen.tsx`, `web/src/core/screens/projects-screen.tsx`                                                                          |
| Detail card+row                                     | `web/src/core/screens/settings/host-page.tsx`, `web/src/core/screens/settings/providers-section.tsx`                                                            |
| Section grouping inside a card list                 | `web/src/core/components/settings/headings/settings-section.tsx`                                                                                                |
| Form modal (label + input fields, primary + cancel) | `web/src/core/components/add-host-modal.tsx`, `web/src/core/components/pair-link-modal.tsx`                                                                     |
| Destructive confirmation                            | `confirmDialog` invoked from `web/src/core/screens/settings/host-page.tsx`                                                                                      |
| Centered hero / first-run                           | `web/src/core/components/welcome-screen.tsx`                                                                                                                    |
| Sidebar list (workspaces, hosts)                    | `web/src/sidebar/workspace-list.tsx`, `web/src/app/app-sidebar.tsx`                                                                                             |
| Live list of items with sections (agents)           | `web/src/core/components/agent-list.tsx`                                                                                                                        |
| Historical list (sessions)                          | `web/src/core/screens/sessions-screen.tsx`                                                                                                                      |
| Workspace pane (multi-tab, split)                   | `web/src/core/screens/workspace/workspace-screen.tsx`                                                                                                           |
| Composer / message input                            | `web/src/core/composer/index.tsx`, `web/src/core/composer/input/input.tsx`                                                                                      |
| Pane chrome with single bottom border               | `web/src/core/git/diff-pane.tsx`, `web/src/core/components/file-explorer-pane.tsx`, `web/src/core/components/terminal-pane.tsx`                                 |
| Page-level alert (info / success / warning / error) | `web/src/core/components/ui/alert.tsx`, `web/src/core/screens/project-settings-screen.tsx`                                                                      |
| Sidebar callout (cross-cutting alert)               | `web/src/core/components/sidebar-callout.tsx`, `web/src/core/contexts/sidebar-callout-context.tsx`, `web/src/core/components/worktree-setup-callout-source.tsx` |
| Searchable picker                                   | `web/src/core/components/ui/combobox.tsx`, `web/src/core/components/branch-switcher.tsx`                                                                        |
| Trigger-anchored menu                               | `web/src/core/components/ui/dropdown-menu.tsx` (used in `web/src/sidebar/workspace-row.tsx`, theme picker)                                                      |
| Right-click / long-press menu                       | `web/src/core/components/ui/context-menu.tsx` (used in `web/src/sidebar/workspace-row.tsx`)                                                                     |
| Headers (back, screen, menu)                        | `web/src/core/components/headers/back-header.tsx`, `screen-header.tsx`, `menu-header.tsx`                                                                       |
