#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../../");
const helperRoot = resolve(import.meta.dirname, ".");
const sourceRoot = resolve(helperRoot, "src");
const testRoot = resolve(helperRoot, "tests");
const supervisorSource = join(sourceRoot, "byspace-tunnel-supervisor.c");
const lock = JSON.parse(readFileSync(join(helperRoot, "hev-source.json"), "utf8"));
const gitCommand = process.platform === "darwin" ? "/usr/bin/git" : "git";
const toolEnvironment = {
  ALL_PROXY: process.env.ALL_PROXY,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  HOME: process.env.HOME,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  HTTP_PROXY: process.env.HTTP_PROXY,
  LC_ALL: "C",
  NO_PROXY: process.env.NO_PROXY,
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  SSL_CERT_FILE: process.env.SSL_CERT_FILE,
  TMPDIR: process.env.TMPDIR ?? tmpdir(),
};
for (const [name, value] of Object.entries(toolEnvironment)) {
  if (value === undefined) delete toolEnvironment[name];
}
const args = process.argv.slice(2);
const isProtocolTest = args.includes("--protocol-test");
const unsupportedArgs = args.filter((argument) => argument !== "--protocol-test");
if (unsupportedArgs.length > 0) {
  throw new Error(`unsupported arguments: ${unsupportedArgs.join(", ")}`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: toolEnvironment,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} exited with ${result.status}`);
  }
}

function outputOf(command, commandArgs, cwd = root) {
  return execFileSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: toolEnvironment,
  }).trim();
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function verifyPinnedFiles() {
  for (const [patchPath, expected] of Object.entries(lock.patches)) {
    const actual = sha256File(join(helperRoot, patchPath));
    if (actual !== expected) {
      throw new Error(`patch mismatch for ${patchPath}: expected ${expected}, got ${actual}`);
    }
  }
  return Object.values(lock.licenses).map((license) => {
    const path = join(helperRoot, license.artifact);
    const actual = sha256File(path);
    if (actual !== license.sha256) {
      throw new Error(`bundled license mismatch for ${license.artifact}`);
    }
    return {
      artifact: license.artifact,
      path,
      sha256: license.sha256,
      sourcePaths: license.sourcePaths,
      spdx: license.spdx,
    };
  });
}

function verifySource(source) {
  const commit = outputOf(gitCommand, ["rev-parse", "HEAD"], source);
  const remote = outputOf(gitCommand, ["remote", "get-url", "origin"], source);
  if (commit !== lock.commit) {
    throw new Error(`HEV commit mismatch: expected ${lock.commit}, got ${commit}`);
  }
  if (remote !== lock.repository) {
    throw new Error(`HEV remote mismatch: expected ${lock.repository}, got ${remote}`);
  }
  for (const license of Object.values(lock.licenses)) {
    for (const sourcePath of license.sourcePaths) {
      const actual = sha256File(join(source, sourcePath));
      if (actual !== license.sha256) {
        throw new Error(
          `license mismatch for ${sourcePath}: expected ${license.sha256}, got ${actual}`,
        );
      }
    }
  }

  const actualSubmodulePaths = outputOf(gitCommand, ["submodule", "status", "--recursive"], source)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/)[1])
    .sort();
  const expectedSubmodulePaths = Object.keys(lock.submodules).sort();
  if (JSON.stringify(actualSubmodulePaths) !== JSON.stringify(expectedSubmodulePaths)) {
    throw new Error("HEV recursive submodule set does not match the source lock");
  }

  for (const [path, expected] of Object.entries(lock.submodules)) {
    const gitlink = outputOf(gitCommand, ["ls-tree", "HEAD", "--", path], source);
    const match = /^160000 commit ([0-9a-f]{40})\t/.exec(gitlink);
    if (!match || match[1] !== expected.commit) {
      throw new Error(`HEV gitlink mismatch for ${path}`);
    }
    const actualCommit = outputOf(gitCommand, ["-C", path, "rev-parse", "HEAD"], source);
    const actualRemote = outputOf(gitCommand, ["-C", path, "remote", "get-url", "origin"], source);
    if (actualCommit !== expected.commit) {
      throw new Error(
        `HEV submodule mismatch for ${path}: expected ${expected.commit}, got ${actualCommit}`,
      );
    }
    if (actualRemote !== expected.repository) {
      throw new Error(
        `HEV submodule remote mismatch for ${path}: expected ${expected.repository}, got ${actualRemote}`,
      );
    }
    const dirtySubmodule = outputOf(
      gitCommand,
      ["-C", path, "status", "--porcelain=v1", "--untracked-files=all"],
      source,
    );
    if (dirtySubmodule) throw new Error(`HEV submodule ${path} is not clean`);
  }

  const dirty = outputOf(
    gitCommand,
    ["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"],
    source,
  );
  if (dirty) throw new Error("HEV source tree is not clean");
}

function compilerArgs(hevSource, sdkRoot, extraArgs) {
  const thirdParty = join(hevSource, "third-part");
  return [
    "-std=c11",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-arch",
    "arm64",
    "-D_DARWIN_C_SOURCE",
    "-mmacosx-version-min=14.0",
    "-isysroot",
    sdkRoot,
    "-I",
    sourceRoot,
    "-I",
    join(hevSource, "src"),
    "-I",
    join(hevSource, "src/misc"),
    "-I",
    join(hevSource, "src/core/include"),
    "-I",
    join(thirdParty, "yaml/include"),
    "-I",
    join(thirdParty, "lwip/src/include"),
    "-I",
    join(thirdParty, "lwip/src/ports/include"),
    "-I",
    join(thirdParty, "hev-task-system/include"),
    ...extraArgs,
  ];
}

function buildProtocolTest() {
  const output = join(tmpdir(), `byspace-tunnel-protocol-test-${process.pid}`);
  rmSync(output, { force: true });
  try {
    run(process.env.CC ?? "cc", [
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-I",
      sourceRoot,
      join(sourceRoot, "byspace-tunnel-protocol.c"),
      join(testRoot, "byspace-tunnel-protocol-test.c"),
      "-o",
      output,
    ]);
    run(output, []);
  } finally {
    rmSync(output, { force: true });
  }
}

function ensureSource() {
  const configuredSource = process.env.BYSPACE_HEV_SOURCE_DIR;
  if (configuredSource) {
    const source = resolve(configuredSource);
    verifySource(source);
    return source;
  }

  const source = resolve(root, ".dev/native-src/hev-socks5-tunnel");
  if (!existsSync(join(source, ".git"))) {
    const cloneSource = `${source}.clone-${process.pid}`;

    mkdirSync(dirname(source), { recursive: true });
    rmSync(source, { recursive: true, force: true });
    rmSync(cloneSource, { recursive: true, force: true });
    try {
      run(gitCommand, [
        "clone",
        "--recurse-submodules",
        "--branch",
        lock.version,
        lock.repository,
        cloneSource,
      ]);
      renameSync(cloneSource, source);
    } catch (error) {
      rmSync(cloneSource, { recursive: true, force: true });
      throw error;
    }
  }
  verifySource(source);
  return source;
}

function archiveTree(source, destination, objectId) {
  const archive = execFileSync(gitCommand, ["archive", "--format=tar", objectId], {
    cwd: source,
    env: toolEnvironment,
    maxBuffer: 512 * 1024 * 1024,
  });

  mkdirSync(destination, { recursive: true });
  const extracted = spawnSync("/usr/bin/tar", ["-xf", "-", "-C", destination], {
    env: toolEnvironment,
    input: archive,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (extracted.error) throw extracted.error;
  if (extracted.status !== 0) {
    throw new Error(`extracting pinned source exited with ${extracted.status}`);
  }
}

function runBuildWithLock() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("the first helper target is macOS arm64");
  }
  const outputParent = resolve(root, "artifacts/native");
  const lockPath = join(outputParent, ".darwin-arm64.build.lock");

  mkdirSync(outputParent, { recursive: true });
  const result = spawnSync(
    "/usr/bin/lockf",
    ["-k", "-s", "-t", "0", lockPath, process.execPath, ...process.argv.slice(1)],
    {
      env: { ...process.env, BYSPACE_HELPER_BUILD_LOCKED: "1" },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status === 75) {
    process.stderr.write("another macOS helper build holds the artifact lock\n");
  }
  return result.status ?? 1;
}

function preparePatchedSource(source) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "byspace-hev-build-"));
  const buildSource = join(temporaryRoot, "source");

  try {
    archiveTree(source, buildSource, lock.commit);
    for (const path of Object.keys(lock.submodules)) {
      const destination = join(buildSource, path);

      rmSync(destination, { recursive: true, force: true });
      archiveTree(join(source, path), destination, lock.submodules[path].commit);
    }
    for (const license of Object.values(lock.licenses)) {
      for (const sourcePath of license.sourcePaths) {
        if (sha256File(join(buildSource, sourcePath)) !== license.sha256) {
          throw new Error(`archived license mismatch for ${sourcePath}`);
        }
      }
    }
    for (const patchPath of Object.keys(lock.patches)) {
      run("/usr/bin/patch", ["--batch", "--forward", "-p1", "-i", join(helperRoot, patchPath)], {
        cwd: buildSource,
      });
    }
    return { buildSource, temporaryRoot };
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function buildHelper() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("the first helper target is macOS arm64");
  }
  const identity = "-";
  const outputParent = resolve(root, "artifacts/native");
  const outputRoot = join(outputParent, "darwin-arm64");
  const stagingRoot = join(outputParent, ".darwin-arm64.tmp");
  const previousRoot = join(outputParent, ".darwin-arm64.previous");

  let prepared;
  let completed = false;
  mkdirSync(outputParent, { recursive: true });
  if (!existsSync(outputRoot) && existsSync(previousRoot)) {
    renameSync(previousRoot, outputRoot);
  } else if (existsSync(previousRoot)) {
    rmSync(previousRoot, { recursive: true, force: true });
  }
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });
  try {
    const bundledLicenses = verifyPinnedFiles();
    const source = ensureSource();
    prepared = preparePatchedSource(source);

    const xcrun = "/usr/bin/xcrun";
    const compiler = outputOf(xcrun, ["--find", "clang"]);
    const archiver = outputOf(xcrun, ["--find", "ar"]);
    const stripper = outputOf(xcrun, ["--find", "strip"]);
    const sdkRoot = outputOf(xcrun, ["--sdk", "macosx", "--show-sdk-path"]);
    const sdkVersion = outputOf(xcrun, ["--sdk", "macosx", "--show-sdk-version"]);
    const compilerVersion = outputOf(compiler, ["--version"]);
    const makeVersion = outputOf("/usr/bin/make", ["--version"]).split("\n")[0];
    const buildEnvironment = {
      ...toolEnvironment,
      SDKROOT: sdkRoot,
      MACOSX_DEPLOYMENT_TARGET: "14.0",
      ZERO_AR_DATE: "1",
    };
    const makeFlags = `-arch arm64 -mmacosx-version-min=14.0 -isysroot ${sdkRoot}`;
    run("/usr/bin/make", ["-C", prepared.buildSource, "clean"], {
      env: buildEnvironment,
    });
    run(
      "/usr/bin/make",
      [
        "-C",
        prepared.buildSource,
        "-j",
        String(Math.max(1, cpus().length)),
        "ENABLE_LIBRARY=1",
        `CC=${compiler}`,
        `PP=${compiler} -E`,
        `AR=${archiver}`,
        `STRIP=${stripper}`,
        `CFLAGS=${makeFlags}`,
        `REV_ID=${lock.commit.slice(0, 7)}`,
        "static",
      ],
      { env: buildEnvironment },
    );

    const thirdParty = join(prepared.buildSource, "third-part");
    const stagedOutput = join(stagingRoot, "byspace-tunnel-helper");
    const stagedSupervisor = join(stagingRoot, "byspace-tunnel-supervisor");
    run(
      compiler,
      compilerArgs(prepared.buildSource, sdkRoot, [
        join(sourceRoot, "byspace-tunnel-helper.c"),
        join(sourceRoot, "byspace-macos-tunnel.c"),
        join(sourceRoot, "byspace-tunnel-protocol.c"),
        join(prepared.buildSource, "bin/libhev-socks5-tunnel.a"),
        join(thirdParty, "yaml/bin/libyaml.a"),
        join(thirdParty, "lwip/bin/liblwip.a"),
        join(thirdParty, "hev-task-system/bin/libhev-task-system.a"),
        "-lpthread",
        "-framework",
        "CoreFoundation",
        "-framework",
        "SystemConfiguration",
        "-o",
        stagedOutput,
      ]),
    );
    run(
      compiler,
      compilerArgs(prepared.buildSource, sdkRoot, [supervisorSource, "-o", stagedSupervisor]),
      { env: buildEnvironment },
    );
    const actualArch = outputOf("/usr/bin/lipo", ["-archs", stagedOutput]);
    if (actualArch !== "arm64") {
      throw new Error(`helper architecture mismatch: expected arm64, got ${actualArch}`);
    }
    const deploymentInfo = outputOf("/usr/bin/vtool", ["-show-build", stagedOutput]);
    if (!/\bminos 14\.0\b/.test(deploymentInfo)) {
      throw new Error("helper does not declare macOS 14.0 as its minimum version");
    }
    const supervisorArch = outputOf("/usr/bin/lipo", ["-archs", stagedSupervisor]);
    if (supervisorArch !== "arm64") {
      throw new Error(`supervisor architecture mismatch: expected arm64, got ${supervisorArch}`);
    }
    const unsignedSha256 = sha256File(stagedOutput);
    const unsignedSupervisorSha256 = sha256File(stagedSupervisor);
    run("/usr/bin/codesign", ["--force", "--sign", identity, stagedOutput]);
    run("/usr/bin/codesign", ["--force", "--sign", identity, stagedSupervisor]);
    run("/usr/bin/codesign", ["--verify", "--strict", stagedOutput]);
    run("/usr/bin/codesign", ["--verify", "--strict", stagedSupervisor]);
    const signedSha256 = sha256File(stagedOutput);
    const signedSupervisorSha256 = sha256File(stagedSupervisor);

    const licenses = {};
    for (const license of bundledLicenses) {
      copyFileSync(license.path, join(stagingRoot, license.artifact));
      licenses[license.artifact] = { spdx: license.spdx, sha256: license.sha256 };
    }
    const manifestPath = join(stagingRoot, "manifest.json");
    const temporaryManifest = `${manifestPath}.tmp`;
    writeFileSync(
      temporaryManifest,
      `${JSON.stringify(
        {
          artifact: "byspace-tunnel-helper",
          platform: "darwin",
          arch: actualArch,
          deploymentTarget: "14.0",
          source: {
            repository: lock.repository,
            version: lock.version,
            commit: lock.commit,
            submodules: lock.submodules,
            patches: lock.patches,
          },
          toolchain: { compiler: compilerVersion, sdkVersion, make: makeVersion },

          unsignedSha256,
          sha256: signedSha256,
          supervisorUnsignedSha256: unsignedSupervisorSha256,
          supervisorSha256: signedSupervisorSha256,
          signing: {
            mode: "adhoc",
            identity: null,
            timestamped: false,
            hardenedRuntime: false,
          },
        },
        null,
        2,
      )}\n`,
    );
    renameSync(temporaryManifest, manifestPath);
    if (existsSync(outputRoot)) {
      renameSync(outputRoot, previousRoot);
    }
    try {
      renameSync(stagingRoot, outputRoot);
    } catch (error) {
      if (!existsSync(outputRoot) && existsSync(previousRoot)) {
        renameSync(previousRoot, outputRoot);
      }
      throw error;
    }
    rmSync(previousRoot, { recursive: true, force: true });
    process.stdout.write(`built ${join(outputRoot, "byspace-tunnel-helper")}\n`);
    process.stdout.write(`sha256 ${signedSha256}\n`);
    process.stdout.write(`supervisor ${join(outputRoot, "byspace-tunnel-supervisor")}\n`);
    process.stdout.write(`supervisor sha256 ${signedSupervisorSha256}\n`);
  } finally {
    if (prepared) rmSync(prepared.temporaryRoot, { recursive: true, force: true });
    if (!completed) {
      rmSync(stagingRoot, { recursive: true, force: true });
      if (!existsSync(outputRoot) && existsSync(previousRoot)) {
        renameSync(previousRoot, outputRoot);
      }
    }
  }
}

if (isProtocolTest) {
  buildProtocolTest();
} else if (process.env.BYSPACE_HELPER_BUILD_LOCKED === "1") {
  buildHelper();
} else {
  process.exitCode = runBuildWithLock();
}
