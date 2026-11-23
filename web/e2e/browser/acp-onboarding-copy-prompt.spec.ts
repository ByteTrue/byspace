import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import {
  openAddProviderArea,
  openSettingsHost,
  openSettingsHostSection,
} from "../support/helpers/settings";

test.describe("ACP onboarding", () => {
  test("offers the copy-prompt handoff instead of a provider catalog", async ({ page }) => {
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, getServerId());
    await openSettingsHostSection(page, getServerId(), "agents");

    await openAddProviderArea(page);
    // The in-app catalog is gone: adding an ACP provider means handing the setup prompt to an
    // agent, so the only control here is the copy action.
    await expect(page.getByRole("textbox", { name: "Search providers" })).toHaveCount(0);
  });
});
