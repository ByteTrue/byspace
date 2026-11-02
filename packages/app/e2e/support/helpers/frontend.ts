// COMPAT(web-switch): the suite runs against web/ unless E2E_USE_METRO=1 or E2E_STATIC_WEB_DIR
// points at packages/app's export, until packages/app is deleted. Delete this file and every
// `isWebFrontend` branch then, keeping the web/ side.
export const isWebFrontend =
  process.env.E2E_USE_METRO !== "1" &&
  !/(^|\/)packages\/app\/dist\/?$/.test(process.env.E2E_STATIC_WEB_DIR ?? "");

/** web/ removed the BySpace menu: Search, Schedules and Tunnels are rows above the workspaces. */
export const NO_NAV_MENU_IN_WEB =
  "web/ lists Search, Schedules and Tunnels as sidebar rows; there is no BySpace menu";
