import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import {
  openAddProviderArea,
  openSettingsHost,
  openSettingsHostSection,
} from "../support/helpers/settings";

test.describe("ACP onboarding", () => {
  test("offers provider presets alongside the copy-prompt handoff", async ({ page }) => {
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, getServerId());
    await openSettingsHostSection(page, getServerId(), "agents");

    await openAddProviderArea(page);
    await expect(page.getByRole("textbox", { name: "Search providers" })).toBeVisible();
  });
});
