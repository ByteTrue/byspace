# Expo Router

BySpace's browser route tree is fragile because Expo Router and React Navigation do
not fail loudly when a nested route is mounted under the wrong layout. The usual
symptom is blank content or a route with missing local parameters.

Read this before changing `packages/app/src/app`, startup routing, remembered
workspace restore, or active workspace selection.

## Ownership

Each layout owns only the routes directly inside its directory.

- The root layout registers `h/[serverId]`.
- The root layout does not register host leaf routes such as
  `h/[serverId]/workspace/[workspaceId]`, `h/[serverId]/open-project`, or
  `h/[serverId]/index`.
- `packages/app/src/app/h/[serverId]/_layout.tsx` owns the host leaves with
  relative screen names: `index`, `workspace/[workspaceId]/index`,
  `agent/[agentId]`, `sessions`, `open-project`, and `settings`.

Expo Router warns with `[Layout children]: No route named ...` when a layout
registers grandchildren. Treat that warning as a route-tree bug. That shape can
mount a nested index route without its local dynamic params and render blank
content.

## Startup

The root `/` route chooses a host boundary. It does not jump directly into a host
leaf.

- Good: `/` -> `/h/[serverId]`
- Bad: `/` -> `/h/[serverId]/workspace/[workspaceId]`

`/h/[serverId]` is the host home route. The host index restores the last
remembered workspace for that host after the remembered selection has hydrated
and the workspace has not been proven missing. If there is no restorable
workspace, it goes to global `/open-project`.

This restore is based on the last navigated workspace, not current connection
status. Do not redirect to another online host just because the remembered host
is still connecting or offline; the workspace screen owns that offline/loading
state.

This split is deliberate. The host layout must mount first so local dynamic
params exist before any nested workspace leaf is selected.

## App-Wide Route Hops

When app-wide routes such as `/new`, `/settings`, or `/sessions` navigate back
into a host workspace, use `navigateToWorkspace()`. Do not make the caller
branch on its current route.

Pass only `serverId` and `workspaceId` for normal attention-aware navigation.
When the action names a specific tab, pass it as `target`; that explicit choice
is authoritative. Callers should not choose between separate route and tab
navigation APIs.

The root stack owns `h/[serverId]`; the host stack owns
`workspace/[workspaceId]/index`. Repeated global-route hops must `POP_TO` the
root host route and pass the nested workspace screen when a host route is
already mounted, or Expo Router can append extra hidden workspace deck entries.
The workspace navigation helper inspects the mounted navigation state to make
that decision; if no host route is mounted yet, it falls back to ordinary route
navigation.

Those hidden entries are not harmless: composer floating panels can measure
against the wrong deck and disappear offscreen.

Hidden host routes may keep their local params while an app-wide route is
foregrounded. Active-workspace observers must prefer the current pathname and
only use local param fallback during cold mount (`/` or empty pathname), or a
hidden workspace can overwrite the remembered workspace before Settings or
History returns.

## Params

Required dynamic params belong to the matched route.

Do not paper over missing required params by reading global params in the leaf.
If `useLocalSearchParams()` misses a required param, fix layout ownership or the
startup route shape.

Use the host route context for host-owned leaves that need the host id after
`h/[serverId]/_layout.tsx` has matched. Do not make a leaf recover from an
unmatched tree by guessing from global state.

## App Directory

Keep non-route modules out of `src/app`. Expo Router treats ordinary `.ts` and
`.tsx` files there as routes, which produces `missing the required default
export` warnings and pollutes the route tree.

Put shared route policy in `src/navigation`, `src/utils`, stores, or another
non-route directory.

## Regression Shape

Pure helper tests are useful but not enough. A browser regression should launch
the Web app with seeded persisted state:

1. Seed `byspace:last-workspace-route-selection` with a valid
   `{ serverId, workspaceId }`.
2. Load `/` in a fresh browser context.
3. Assert the URL crosses the host boundary and settles on the remembered
   workspace.
4. Assert the workspace screen is visible and no `[Layout children]` warning
   appears.
5. Exercise browser back/forward navigation and one app-wide route hop, then
   assert the visible workspace and URL still agree.

The pure policy tests should still enforce the boundary split:

- root startup with a saved workspace returns `/h/[serverId]`;
- host index with the same saved workspace returns
  `/h/[serverId]/workspace/[workspaceId]`;
- host index with no restorable workspace returns `/open-project`.

## Checklist

Before landing route changes:

- [ ] Did you change `packages/app/src/app`? Re-read this file.
- [ ] Did you touch remembered workspace restore? Keep root on `/h/[serverId]`.
- [ ] Did a route return to a workspace? Use `navigateToWorkspace()` and pass a
      `target` when the action names a specific tab.
- [ ] Did you add a route? Register it in the layout that directly owns it.
- [ ] Did `useLocalSearchParams()` lose a required param? Fix the route tree.
- [ ] Did the browser show blank content or lose a required route param? Suspect
      route ownership before stores, themes, or rendering.
