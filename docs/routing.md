# Routing

The web app's routes are a React Router data router, `web/src/app/router.tsx`, with one entry per
route module in `web/src/core/app/`. The URLs are the ones the Expo app used, so links, bookmarks,
notification targets, and pairing URLs keep working. Code navigates through `web/src/app/navigation.tsx`
(`router.push("/h/...")`, `useLocalSearchParams`, `<Redirect>`), which drives React Router: the
router is a module-level object, so plain modules navigate too.

Read this before changing routes, startup routing, remembered workspace restore, or active
workspace selection.

## The workspace layer

Settings, History, Schedules, and the other app-wide screens cover the workspace instead of
replacing it. `web/src/app/workspace-layer.tsx` keeps the workspace route mounted, hidden with
`display: none`, so a terminal keeps its emulator, a chat its scroll position and drafts, and Back
shows the same screen. `/`, `/open-project`, and `/welcome` replace it.

A covered workspace is still running, so:

- **It is not focused.** `useIsFocused()` (`web/src/app/route-focus.ts`) is false,
  and nothing in it may navigate: a redirect from a covered host layout would take the screen on
  top away.
- **It measures as zero.** Layout code that measures must measure again when it shows, as the tab
  row does with a `ResizeObserver` (`web/src/core/screens/workspace/workspace-desktop-tabs-row.tsx`).
  A tab opened from History while the workspace is covered otherwise never appears.
- **It keeps its route params.** Active-workspace observers read the current pathname, not the
  params; otherwise the covered workspace overwrites the remembered one before Settings or History
  returns.

## Startup

`/` picks a host and goes to `/h/[serverId]`; it never jumps straight into a host leaf. The host
layout (`HostLayout` in `web/src/app/routes.tsx`) redirects an unknown host and scopes a known one,
and that decision has to come before any leaf mounts.

The host index restores the last remembered workspace for that host once the remembered selection
has hydrated and the workspace is not known to be missing. With nothing to restore it goes to
`/open-project`. Restore follows the last workspace the user navigated to, not connection status:
do not send the user to another online host because the remembered one is still connecting or
offline. The workspace screen owns that offline and loading state.

## Going to a workspace

Call `navigateToWorkspace()` (`web/src/core/stores/navigation-active-workspace-store`) from any
route, without branching on where you are. Pass `serverId` and `workspaceId`; when the action
names a tab, pass it as `target`, and that choice wins over attention-aware tab selection.

A workspace never adds a history entry. It replaces the host-level entry, after popping the screens
pushed above it (`web/src/core/navigation/workspace-route-navigation.ts`), so Back from a workspace
leaves the app the way Android's back button does, instead of walking through every workspace the
user visited.

## Agent targets

Notifications and agent URLs carry different targets.

- Notifications carry `serverId`, `workspaceId`, and `agentId`. Route them straight to the
  workspace with the agent open intent.
- Agent URLs carry only `serverId` and `agentId`. Route them through
  `/h/[serverId]/agent/[agentId]`, which waits for the host, resolves the agent's workspace, and
  opens the agent there.

Both converge on `navigateToAgent()`. Do not make notification routing guess a workspace, and do
not add a workspace to the agent URL format.

## Params

Required dynamic params belong to the matched route. If a leaf is missing one, fix its route entry
in `router.tsx`; do not read global params or global state to recover it.

## Regression shape

The failures here are route-tree state, so pure helper tests are not enough. A regression test
seeds `byspace:last-workspace-route-selection` with a valid `{ serverId, workspaceId }`, loads the
app cold, and asserts a real screen is visible.

The policy tests keep the boundary split:

- root startup with a saved workspace returns `/h/[serverId]`;
- the host index with the same saved workspace returns `/h/[serverId]/workspace/[workspaceId]`;
- the host index with nothing to restore returns `/open-project`.

## Checklist

- [ ] Root startup still lands on `/h/[serverId]`, never a host leaf.
- [ ] Going to a workspace uses `navigateToWorkspace()`, with `target` when the action names a tab.
- [ ] A new route has an entry in `router.tsx` at the URL the rest of the app links to.
- [ ] Code in the workspace route behaves while covered: no navigation, no stale zero-size
      measurements, no writes to the remembered workspace.
