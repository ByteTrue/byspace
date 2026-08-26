import { describe, expect, it, vi } from "vitest";

const BUILD_ENV_KEYS = [
  "APP_VARIANT",
  "BYSPACE_APP_ID",
  "BYSPACE_BUILD_PROFILE",
  "BYSPACE_ANDROID_FLAVOR",
] as const;

async function loadExpoConfig(env: Partial<Record<(typeof BUILD_ENV_KEYS)[number], string>> = {}) {
  const original = Object.fromEntries(BUILD_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of BUILD_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  vi.resetModules();

  try {
    const config = (await import("./app.config.js")).default;
    return config.expo;
  } finally {
    for (const key of BUILD_ENV_KEYS) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function pluginNames(plugins: readonly unknown[]): unknown[] {
  return plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
}

describe("app config build profiles", () => {
  it("uses the permanent BySpace identifiers", async () => {
    const config = await loadExpoConfig();

    expect(config.scheme).toBe("byspace");
    expect(config.android.package).toBe("com.bytetrue.byspace");
    expect(config.ios.bundleIdentifier).toBe("com.bytetrue.byspace");
  });

  it("advertises profile builds to the native tracing runtime", async () => {
    const config = await loadExpoConfig({ BYSPACE_BUILD_PROFILE: "profile" });

    expect(config.extra.profileBuild).toBe(true);
    expect(config.android.buildProfile).toBe("profile");
  });

  it("keeps camera, notifications, and audio in the default build", async () => {
    const config = await loadExpoConfig();

    expect(pluginNames(config.plugins)).toEqual(
      expect.arrayContaining(["expo-camera", "expo-notifications", "expo-audio"]),
    );
    expect(config.extra.fdroidBuild).toBe(false);
  });

  it("removes proprietary camera and notification plugins from F-Droid builds", async () => {
    const config = await loadExpoConfig({ BYSPACE_ANDROID_FLAVOR: "fdroid" });
    const plugins = pluginNames(config.plugins);

    expect(config.extra.fdroidBuild).toBe(true);
    expect(plugins).not.toContain("expo-camera");
    expect(plugins).not.toContain("expo-notifications");
    expect(config.android.permissions).not.toContain("CAMERA");
    expect(config.android.permissions).not.toContain("android.permission.CAMERA");
  });
});
