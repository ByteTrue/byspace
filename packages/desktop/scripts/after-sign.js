const { execFileSync } = require("node:child_process");
const path = require("node:path");

const { smokePackagedDesktopApp } = require("../e2e/packaged-app-smoke.js");

const EXECUTABLE_NAME = "BySpace";
const APPLE_SIGNING_ENV_NAMES = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appPath = path.join(context.appOutDir, `${EXECUTABLE_NAME}.app`);
  const presentCredentials = APPLE_SIGNING_ENV_NAMES.filter(
    (name) => process.env[name]?.trim().length > 0,
  );
  if (presentCredentials.length > 0 && presentCredentials.length < APPLE_SIGNING_ENV_NAMES.length) {
    throw new Error("Apple signing/notarization credentials must be all present or all absent");
  }

  if (presentCredentials.length === 0) {
    const entitlements = path.resolve(__dirname, "..", "build", "entitlements.mac.plist");
    execFileSync(
      "codesign",
      [
        "--force",
        "--deep",
        "--sign",
        "-",
        "--options",
        "runtime",
        "--entitlements",
        entitlements,
        appPath,
      ],
      { stdio: "inherit" },
    );
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  }

  if (process.env.BYSPACE_DESKTOP_SMOKE !== "1") {
    return;
  }

  await smokePackagedDesktopApp({ appPath });
};
