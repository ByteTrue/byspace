import { describe, expect, it } from "vitest";
import { APP_SETTINGS_KEY, loadAppSettingsFromStorage } from "../hooks/use-settings/storage";
import { createInMemoryKeyValueStorage } from "../hooks/use-settings/fakes";
import { LANGUAGE_OPTIONS, parseAppLanguage } from "./locales";

// Guards the product decision to ship only English and Simplified Chinese
// (bywork/work/i18n-two-locales): settings persisted by a build that still had
// the other seven locales must fall back to system, not crash or stick.
describe("two-locale cut", () => {
  it("offers only system, English, and Simplified Chinese", () => {
    expect(LANGUAGE_OPTIONS.map((option) => option.value)).toEqual(["system", "en", "zh-CN"]);
  });

  it("rejects removed locales as explicit choices", () => {
    for (const removed of ["ar", "es", "fr", "ja", "ko", "pt-BR", "ru"]) {
      expect(parseAppLanguage(removed)).toBeNull();
    }
  });

  it.each(["ar", "es", "fr", "ja", "ko", "pt-BR", "ru"])(
    "reads persisted %s language as system while keeping other settings",
    async (removed) => {
      const deps = {
        storage: createInMemoryKeyValueStorage({
          [APP_SETTINGS_KEY]: JSON.stringify({ language: removed, theme: "dark" }),
        }),
      };

      const settings = await loadAppSettingsFromStorage(deps);

      expect(settings.language).toBe("system");
      expect(settings.theme).toBe("dark");
    },
  );
});
