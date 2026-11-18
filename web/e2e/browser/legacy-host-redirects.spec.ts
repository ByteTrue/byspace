import { test } from "../support/fixtures";
import { buildOpenProjectRoute, buildSessionsRoute } from "@/utils/host-routes";
import { gotoAppShell } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { expectAppRoute } from "../support/helpers/route-assertions";

// The Expo app minted host-scoped URLs for the project picker and the session list. Both are
// redirects to app-wide screens now; without a route entry they fell through to the catch-all and
// landed on "/" instead. scripts/web-routes.test.mjs asserts the entries exist, this asserts where
// they actually send a browser.
test.describe("legacy host-scoped redirects", () => {
  test("/h/[serverId]/open-project redirects to the project picker", async ({ page }) => {
    await gotoAppShell(page);
    await page.goto(`/h/${encodeURIComponent(getServerId())}/open-project`);
    await expectAppRoute(page, buildOpenProjectRoute());
  });

  test("/h/[serverId]/sessions redirects to the session list", async ({ page }) => {
    await gotoAppShell(page);
    await page.goto(`/h/${encodeURIComponent(getServerId())}/sessions`);
    await expectAppRoute(page, buildSessionsRoute());
  });
});
