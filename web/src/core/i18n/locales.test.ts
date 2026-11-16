import { describe, expect, it } from "vitest";
import {
  LANGUAGE_OPTIONS,
  formatLanguageOptionLabel,
  parseAppLanguage,
  resolveSupportedLocale,
} from "./locales";

describe("parseAppLanguage", () => {
  it("accepts system and all supported language locales", () => {
    expect(["system", "en", "zh-CN"].map(parseAppLanguage)).toEqual(["system", "en", "zh-CN"]);
  });

  it("returns null for unknown values", () => {
    expect(parseAppLanguage("de")).toBeNull();
    expect(parseAppLanguage(null)).toBeNull();
  });

  it("offers system plus all supported languages", () => {
    expect(LANGUAGE_OPTIONS.map((option) => option.value)).toEqual(["system", "en", "zh-CN"]);
  });
});

describe("formatLanguageOptionLabel", () => {
  it("shows the native language name and English name in English UI", () => {
    const chinese = LANGUAGE_OPTIONS.find((option) => option.value === "zh-CN");

    expect(formatLanguageOptionLabel(chinese!, "en", "System")).toBe(
      "简体中文 - Simplified Chinese",
    );
  });

  it("shows the native language name and Chinese name in Chinese UI", () => {
    const english = LANGUAGE_OPTIONS.find((option) => option.value === "en");

    expect(formatLanguageOptionLabel(english!, "zh-CN", "系统")).toBe("English - 英语");
  });

  it("uses a single label when both language names match", () => {
    const english = LANGUAGE_OPTIONS.find((option) => option.value === "en");
    const chinese = LANGUAGE_OPTIONS.find((option) => option.value === "zh-CN");

    expect(formatLanguageOptionLabel(english!, "en", "System")).toBe("English");
    expect(formatLanguageOptionLabel(chinese!, "zh-CN", "系统")).toBe("简体中文");
  });

  it("uses the active-language name for System", () => {
    const system = LANGUAGE_OPTIONS.find((option) => option.value === "system");

    expect(formatLanguageOptionLabel(system!, "zh-CN", "系统")).toBe("系统");
  });
});

describe("resolveSupportedLocale", () => {
  it("respects explicit language choices", () => {
    expect(resolveSupportedLocale("en", ["zh-CN"])).toBe("en");
    expect(resolveSupportedLocale("zh-CN", ["en-US"])).toBe("zh-CN");
  });

  it("maps English system locales to English", () => {
    expect(resolveSupportedLocale("system", ["en"])).toBe("en");
    expect(resolveSupportedLocale("system", ["en-US"])).toBe("en");
  });

  it("maps Chinese system locales to Simplified Chinese", () => {
    expect(resolveSupportedLocale("system", ["zh"])).toBe("zh-CN");
    expect(resolveSupportedLocale("system", ["zh-CN"])).toBe("zh-CN");
    expect(resolveSupportedLocale("system", ["zh-Hans-US"])).toBe("zh-CN");
  });

  it("does not map Traditional Chinese system locales to Simplified Chinese", () => {
    expect(resolveSupportedLocale("system", ["zh-TW"])).toBe("en");
    expect(resolveSupportedLocale("system", ["zh-Hant"])).toBe("en");
    expect(resolveSupportedLocale("system", ["zh-HK"])).toBe("en");
  });

  it("maps unsupported or missing system locales to English", () => {
    expect(resolveSupportedLocale("system", ["de-DE"])).toBe("en");
    expect(resolveSupportedLocale("system", ["ja-JP"])).toBe("en");
    expect(resolveSupportedLocale("system", [])).toBe("en");
  });
});
