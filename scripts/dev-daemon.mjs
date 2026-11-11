#!/usr/bin/env node
// Runs the Go dev daemon on 127.0.0.1:6778 with this checkout's dev home.
//
// Same contract as the Node dev daemon it replaces: BYSPACE_SERVICE_DAEMON_PORT wins when BySpace
// runs it as a workspace service, otherwise BYSPACE_LISTEN defaults to the dev port. The daemon
// serves the web UI embedded in the binary, so `make build` (binary only) is the default; set
// BYSPACE_DEV_BUILD_WEB_UI=1 to re-export the app first.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureDevBySpaceHome, runDevChild } from "./dev-home.mjs";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");
const binary = resolve(rootDir, "bin", process.platform === "win32" ? "byspace.exe" : "byspace");

if (process.env.BYSPACE_SERVICE_DAEMON_PORT && !process.env.BYSPACE_LISTEN) {
  process.env.BYSPACE_LISTEN = `0.0.0.0:${process.env.BYSPACE_SERVICE_DAEMON_PORT}`;
} else {
  process.env.BYSPACE_LISTEN = process.env.BYSPACE_LISTEN || "127.0.0.1:6778";
}

if (process.env.BYSPACE_WORKTREE_PATH && !process.env.BYSPACE_DEV_ROOT) {
  process.env.BYSPACE_DEV_ROOT = process.env.BYSPACE_WORKTREE_PATH;
}

configureDevBySpaceHome();
process.env.BYSPACE_CORS_ORIGINS = process.env.BYSPACE_CORS_ORIGINS || "*";
// The dev daemon is the development build, so it exposes the scripted providers the specs and the
// perf profiles create agents with. A packaged daemon never sets this and therefore never lists
// "Mock Load Test" next to the real providers.
process.env.BYSPACE_NODE_ENV = process.env.BYSPACE_NODE_ENV || "development";

// Local speech models live outside the home so a worktree reset does not re-download them.
const localModelsDir =
  process.env.BYSPACE_LOCAL_MODELS_DIR || join(homedir(), ".byspace/models/local-speech");
process.env.BYSPACE_LOCAL_MODELS_DIR = localModelsDir;
mkdirSync(localModelsDir, { recursive: true });

// A workspace service is built during worktree setup, so only rebuild when asked.
const skipBuild =
  process.env.BYSPACE_SKIP_DEV_SERVER_BUILD === "1" ||
  (process.env.BYSPACE_SERVICE_DAEMON_PORT !== undefined &&
    process.env.BYSPACE_SKIP_DEV_SERVER_BUILD !== "0");

if (!skipBuild) {
  const target = process.env.BYSPACE_DEV_BUILD_WEB_UI === "1" ? "build-full" : "build";
  try {
    execFileSync("make", [target], { cwd: rootDir, stdio: "inherit" });
  } catch (error) {
    // Windows without make (no WSL, no MSYS): `make build` is one `go build` line, so run it here.
    // Without this fallback `npm run dev:daemon` dies on spawnSync ENOENT and the dev daemon can
    // never start, which pushes people to test against the production daemon instead.
    if (error.code !== "ENOENT") throw error;
    if (target === "build-full") {
      execFileSync("npm", ["run", "build:daemon-web-ui"], { cwd: rootDir, stdio: "inherit" });
    }
    const { version } = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
    const ldflags = `-s -w -X main.version=${version} -X github.com/ByteTrue/byspace/internal/cli.DefaultVersion=${version}`;
    execFileSync(
      "go",
      ["build", "-tags", "nogui", "-trimpath", "-ldflags", ldflags, "-o", binary, "."],
      {
        cwd: rootDir,
        stdio: "inherit",
        env: { ...process.env, CGO_ENABLED: "0" },
      },
    );
  }
}

if (!existsSync(binary)) {
  process.stderr.write(
    `${binary} is missing. Run \`make build\` (or \`go build -tags nogui -o ${binary} .\`).\n`,
  );
  process.exit(1);
}

console.log("══════════════════════════════════════════════════════");
console.log("  BySpace Dev Daemon (Go)");
console.log("══════════════════════════════════════════════════════");
console.log(`  Home:    ${process.env.BYSPACE_HOME}`);
console.log(`  Models:  ${localModelsDir}`);
console.log(`  Listen:  ${process.env.BYSPACE_LISTEN}`);
console.log(`  Binary:  ${binary}`);
console.log("══════════════════════════════════════════════════════");

await runDevChild(binary, ["serve"], { cwd: rootDir, env: process.env });
