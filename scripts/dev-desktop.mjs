#!/usr/bin/env node
// Runs the Wails v3 desktop client in dev mode against this checkout's .dev/byspace-home
// on 127.0.0.1:6778 (attaching to an existing dev daemon on 6778 or starting it in-process).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureDevBySpaceHome, runDevChild } from "./dev-home.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");
const binary = resolve(
  rootDir,
  "bin",
  process.platform === "win32" ? "byspace-app.exe" : "byspace-app",
);

// Node refuses to spawn .cmd/.bat without a shell (EINVAL), so npm needs shell:true on Windows.
const npmOpts = { cwd: rootDir, stdio: "inherit", shell: process.platform === "win32" };

if (process.env.BYSPACE_SERVICE_DAEMON_PORT && !process.env.BYSPACE_LISTEN) {
  process.env.BYSPACE_LISTEN = `127.0.0.1:${process.env.BYSPACE_SERVICE_DAEMON_PORT}`;
} else {
  process.env.BYSPACE_LISTEN = process.env.BYSPACE_LISTEN || "127.0.0.1:6778";
}

if (process.env.BYSPACE_WORKTREE_PATH && !process.env.BYSPACE_DEV_ROOT) {
  process.env.BYSPACE_DEV_ROOT = process.env.BYSPACE_WORKTREE_PATH;
}

configureDevBySpaceHome();
process.env.BYSPACE_CORS_ORIGINS = process.env.BYSPACE_CORS_ORIGINS || "*";
process.env.BYSPACE_NODE_ENV = process.env.BYSPACE_NODE_ENV || "development";

// The dev window serves web/dist through BYSPACE_WEB_DIR rather than the bundle embedded in the
// binary, so a web/ change needs the web build below and no Go rebuild.
process.env.BYSPACE_WEB_DIR = process.env.BYSPACE_WEB_DIR || resolve(rootDir, "web", "dist");

const skipBuild = process.env.BYSPACE_SKIP_DEV_DESKTOP_BUILD === "1";
if (!skipBuild) {
  if (process.env.BYSPACE_SKIP_DEV_WEB_BUILD !== "1") {
    execFileSync("npm", ["run", "build", "--workspace=@bytetrue/web"], npmOpts);
  }
  execFileSync("make", ["build-app"], { cwd: rootDir, stdio: "inherit" });
}

if (!existsSync(binary)) {
  process.stderr.write(`${binary} is missing. Run \`make build-app\` in ${rootDir}.\n`);
  process.exit(1);
}

// macOS: run the binary from inside an app bundle, as the packaged app does. Notification Center
// (internal/gui/notify.go) only serves bundled apps; outside one, notifications fall back to the
// webview's. A dev bundle id keeps the dev app's notification permission apart from BySpace's.
function devMacBundle() {
  const bundle = resolve(rootDir, "bin", "BySpace Dev.app");
  const executable = resolve(bundle, "Contents", "MacOS", "byspace-app");
  mkdirSync(resolve(bundle, "Contents", "MacOS"), { recursive: true });
  copyFileSync(binary, executable);
  const plist = readFileSync(resolve(rootDir, "build", "darwin", "Info.plist"), "utf8")
    .replaceAll("@VERSION@", "0.0.0-dev")
    .replace("<string>com.bytetrue.byspace</string>", "<string>com.bytetrue.byspace.dev</string>")
    .replace(
      "<key>CFBundleExecutable</key><string>byspace</string>",
      "<key>CFBundleExecutable</key><string>byspace-app</string>",
    )
    .replace(
      "<key>CFBundleName</key><string>BySpace</string>",
      "<key>CFBundleName</key><string>BySpace Dev</string>",
    )
    .replace(
      "<key>CFBundleDisplayName</key><string>BySpace</string>",
      "<key>CFBundleDisplayName</key><string>BySpace Dev</string>",
    )
    // The dev app must not claim byspace:// links from the installed one.
    .replace(/\t<key>CFBundleURLTypes<\/key>[\s\S]*?\n\t<\/array>\n/, "");
  writeFileSync(resolve(bundle, "Contents", "Info.plist"), plist);
  execFileSync("codesign", ["--force", "--sign", "-", bundle], { stdio: "inherit" });
  return executable;
}
const launchBinary = process.platform === "darwin" ? devMacBundle() : binary;

console.log("══════════════════════════════════════════════════════");
console.log("  BySpace Desktop Client Dev (Wails v3)");
console.log("══════════════════════════════════════════════════════");
console.log(`  Home:    ${process.env.BYSPACE_HOME}`);
console.log(`  Daemon:  ${process.env.BYSPACE_LISTEN}`);
console.log(`  Binary:  ${launchBinary}`);
console.log(`  Web UI:  ${process.env.BYSPACE_WEB_DIR}`);
console.log("══════════════════════════════════════════════════════");

await runDevChild(launchBinary, ["app"], { cwd: rootDir, env: process.env });
