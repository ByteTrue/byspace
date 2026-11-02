// COMPAT(web-switch): the suite runs against both frontends until packages/app is deleted (CI's
// playwright-web job points E2E_STATIC_WEB_DIR at web/dist). Delete this file and every
// `isWebFrontend` branch then, keeping the web/ side.
export const isWebFrontend = /(^|\/)web\/dist\/?$/.test(process.env.E2E_STATIC_WEB_DIR ?? "");

/** web/ removed the BySpace menu: Search, Schedules and Tunnels are rows above the workspaces. */
export const NO_NAV_MENU_IN_WEB =
  "web/ lists Search, Schedules and Tunnels as sidebar rows; there is no BySpace menu";
