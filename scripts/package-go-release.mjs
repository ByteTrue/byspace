#!/usr/bin/env node

// Packs the Go daemon into the `@bytetrue/byspace` npm tarball.
//
// The daemon used to ship as Node code that ran anywhere Node ran. A single Go
// binary cannot do that, so the tarball carries one build per platform plus a
// launcher that picks the right one and execs it. The launcher is plain
// CommonJS: it runs before anything reads package.json "type", and `#!`-scripts
// cannot be resolved by npm's Windows shims.
//
// The web bundle is embedded in each binary by //go:embed, so the tarball has no
// assets of its own.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const targets = [
  { goos: "darwin", goarch: "arm64", name: "byspace-darwin-arm64" },
  { goos: "darwin", goarch: "amd64", name: "byspace-darwin-x64" },
  { goos: "linux", goarch: "arm64", name: "byspace-linux-arm64" },
  { goos: "linux", goarch: "amd64", name: "byspace-linux-x64" },
  { goos: "windows", goarch: "amd64", name: "byspace-windows-x64.exe" },
];

const launcher = `#!/usr/bin/env node
// Launcher for the @bytetrue/byspace npm package.
//
// The package ships one Go build per platform because a Go binary cannot be
// universal. Pick the build matching this machine, make it executable (npm does
// not preserve the mode inside a tarball), and hand over with the same argv and
// stdio so exit codes, signals and TTY behaviour stay identical.
"use strict";

const { spawn } = require("node:child_process");
const { chmodSync, existsSync } = require("node:fs");
const path = require("node:path");

const platforms = {
  "darwin-arm64": "byspace-darwin-arm64",
  "darwin-x64": "byspace-darwin-x64",
  "linux-arm64": "byspace-linux-arm64",
  "linux-x64": "byspace-linux-x64",
  "win32-x64": "byspace-windows-x64.exe",
};

const key = \`\${process.platform}-\${process.arch}\`;
const binary = platforms[key];

if (!binary) {
  process.stderr.write(
    \`byspace does not ship a build for \${key}. Supported: \${Object.keys(platforms).join(", ")}.\\n\`,
  );
  process.exit(1);
}

const binaryPath = path.join(__dirname, "..", "vendor", binary);

if (!existsSync(binaryPath)) {
  process.stderr.write(\`byspace is missing its \${key} build at \${binaryPath}. Reinstall the package.\\n\`);
  process.exit(1);
}

if (process.platform !== "win32") {
  // npm strips the executable bit from files inside a tarball, and the daemon
  // refuses to run without it. This is idempotent and cheap.
  chmodSync(binaryPath, 0o755);
}

const child = spawn(binaryPath, process.argv.slice(2), { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("error", (error) => {
  process.stderr.write(\`byspace failed to start: \${error.message}\\n\`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
`;

const [sourceArgument = process.cwd(), outputArgument = "dist/npm"] = process.argv.slice(2);
const sourceDir = path.resolve(sourceArgument);
const outputDir = path.resolve(outputArgument);
const expectedCommit = process.env.BYSPACE_SOURCE_COMMIT?.trim();
const temporaryDir = mkdtempSync(path.join(os.tmpdir(), "byspace-go-pack-"));
const stagingDir = path.join(temporaryDir, "package");

// Filled in once the release version is known; packBinary needs it on every target.
let ldflags = "";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: sourceDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function fail(message) {
  throw new Error(message);
}

function packBinary(target, destination) {
  run("go", ["build", "-trimpath", `-ldflags=${ldflags}`, "-o", destination, "./cmd/byspace"], {
    env: {
      ...process.env,
      CGO_ENABLED: "0",
      GOOS: target.goos,
      GOARCH: target.goarch,
    },
  });
  if (!existsSync(destination)) {
    fail(`go build produced no binary for ${target.goos}/${target.goarch}`);
  }
  return statSync(destination).size;
}

try {
  const rootPackage = JSON.parse(readFileSync(path.join(sourceDir, "package.json"), "utf8"));
  const version = rootPackage.version;
  if (!version) {
    fail("Root package.json has no version");
  }

  const sourceCommit = run("git", ["rev-parse", "HEAD"]).trim();
  const sourceTree = run("git", ["rev-parse", "HEAD^{tree}"]).trim();

  if (expectedCommit && sourceCommit !== expectedCommit) {
    fail(`Expected source commit ${expectedCommit}, received ${sourceCommit}`);
  }
  if (run("git", ["status", "--porcelain"]).trim()) {
    fail(`Source worktree is not clean: ${sourceDir}`);
  }

  const bundledWeb = path.join(sourceDir, "internal", "webui", "dist");
  if (!existsSync(bundledWeb)) {
    fail("internal/webui/dist is missing; run `npm run build:daemon-web-ui` first");
  }

  mkdirSync(path.join(stagingDir, "bin"), { recursive: true });
  mkdirSync(path.join(stagingDir, "vendor"), { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  ldflags = `-s -w -X main.version=${version}`;
  const sizes = {};
  for (const target of targets) {
    sizes[target.name] = packBinary(target, path.join(stagingDir, "vendor", target.name));
  }

  writeFileSync(path.join(stagingDir, "bin", "byspace"), launcher);
  chmodSync(path.join(stagingDir, "bin", "byspace"), 0o755);

  // The published name stays @bytetrue/byspace: every install and upgrade path
  // already points at it, and npm keys upgrades by name.
  const staged = {
    name: "@bytetrue/byspace",
    version,
    description: rootPackage.description,
    license: rootPackage.license,
    bin: { byspace: "bin/byspace" },
    files: ["bin", "vendor", "LICENSE", "README.md"],
    engines: { node: ">=22" },
    os: targets
      .map((target) => (target.goos === "windows" ? "win32" : target.goos))
      .filter((value, index, all) => all.indexOf(value) === index),
    repository: {
      type: "git",
      url: "git+https://github.com/ByteTrue/byspace.git",
    },
    bugs: { url: "https://github.com/ByteTrue/byspace/issues" },
    gitHead: sourceCommit,
  };
  writeFileSync(path.join(stagingDir, "package.json"), `${JSON.stringify(staged, null, 2)}\n`);

  cpSync(path.join(sourceDir, "LICENSE"), path.join(stagingDir, "LICENSE"));
  cpSync(
    path.join(sourceDir, "scripts", "bytetrue-package-readme.md"),
    path.join(stagingDir, "README.md"),
  );

  const output = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", `--pack-destination=${outputDir}`],
    { cwd: stagingDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const [{ filename }] = JSON.parse(output);
  const tarball = path.join(outputDir, filename);

  const verifyDir = path.join(temporaryDir, "verify");
  mkdirSync(verifyDir, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", verifyDir, "--strip-components=1"]);

  const packed = JSON.parse(readFileSync(path.join(verifyDir, "package.json"), "utf8"));
  if (packed.name !== "@bytetrue/byspace" || packed.version !== version) {
    fail("Packed package identity does not match the source release");
  }
  if (packed.bin?.byspace !== "bin/byspace" || Object.keys(packed.bin).length !== 1) {
    fail("Packed package does not expose exactly one byspace launcher");
  }
  for (const target of targets) {
    const packedBinary = path.join(verifyDir, "vendor", target.name);
    if (!existsSync(packedBinary)) {
      fail(`Packed package is missing ${target.name}`);
    }
    if (statSync(packedBinary).size !== sizes[target.name]) {
      fail(`Packed ${target.name} does not match the size that was built`);
    }
  }

  const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  writeFileSync(path.join(outputDir, "SHA256SUMS.txt"), `${digest}  ${filename}\n`);
  process.stdout.write(
    `${JSON.stringify({
      package: packed.name,
      version: packed.version,
      sourceCommit,
      sourceTree,
      tarball,
      sha256: digest,
      binaryBytes: sizes,
    })}\n`,
  );
} finally {
  rmSync(temporaryDir, { recursive: true, force: true });
}
