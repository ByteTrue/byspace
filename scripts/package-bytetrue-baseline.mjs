#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const workspaces = ["highlight", "relay", "protocol", "client", "plugin", "server", "cli"];
const bundledPackages = workspaces
  .filter((workspace) => workspace !== "cli")
  .map((workspace) => `@getpaseo/${workspace}`);

const [sourceArgument = process.cwd(), outputArgument = "dist/npm"] = process.argv.slice(2);
const sourceDir = path.resolve(sourceArgument);
const outputDir = path.resolve(outputArgument);
const expectedCommit = process.env.PASEO_SOURCE_COMMIT?.trim();
const temporaryDir = mkdtempSync(path.join(os.tmpdir(), "bytetrue-byspace-pack-"));
const packsDir = path.join(temporaryDir, "packs");
const stagingDir = path.join(temporaryDir, "package");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: sourceDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}

function packWorkspace(workspace) {
  const output = run("npm", [
    "pack",
    "--ignore-scripts",
    "--json",
    `--workspace=@getpaseo/${workspace}`,
    `--pack-destination=${packsDir}`,
  ]);
  const [{ filename }] = JSON.parse(output);
  return path.join(packsDir, filename);
}

function extract(tarball, destination) {
  mkdirSync(destination, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", destination, "--strip-components=1"]);
}

try {
  const rootPackage = JSON.parse(readFileSync(path.join(sourceDir, "package.json"), "utf8"));
  const sourceCommit = run("git", ["rev-parse", "HEAD"]).trim();
  const sourceTree = run("git", ["rev-parse", "HEAD^{tree}"]).trim();

  if (expectedCommit && sourceCommit !== expectedCommit) {
    throw new Error(`Expected source commit ${expectedCommit}, received ${sourceCommit}`);
  }
  if (run("git", ["status", "--porcelain"]).trim()) {
    throw new Error(`Source worktree is not clean: ${sourceDir}`);
  }

  mkdirSync(packsDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  const tarballs = new Map(workspaces.map((workspace) => [workspace, packWorkspace(workspace)]));
  extract(tarballs.get("cli"), stagingDir);
  const packagePath = path.join(stagingDir, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const runtimePackages = [{ packageJson, packagePath }];

  for (const workspace of workspaces.filter((name) => name !== "cli")) {
    const destination = path.join(stagingDir, "node_modules", "@getpaseo", workspace);
    extract(tarballs.get(workspace), destination);
    const internalPackagePath = path.join(destination, "package.json");
    const internalPackage = JSON.parse(readFileSync(internalPackagePath, "utf8"));
    if (
      internalPackage.name !== `@getpaseo/${workspace}` ||
      internalPackage.version !== rootPackage.version
    ) {
      throw new Error(`Unexpected ${workspace} package identity`);
    }
    runtimePackages.push({ packageJson: internalPackage, packagePath: internalPackagePath });
  }

  const externalDependencies = {};
  const externalDependencyEntries = runtimePackages.flatMap(({ packageJson: runtimePackage }) =>
    [runtimePackage.dependencies, runtimePackage.peerDependencies].flatMap((dependencySet) =>
      Object.entries(dependencySet ?? {}).filter(([name]) => !name.startsWith("@getpaseo/")),
    ),
  );
  for (const [name, specifier] of externalDependencyEntries) {
    if (externalDependencies[name] && externalDependencies[name] !== specifier) {
      throw new Error(`Conflicting dependency versions for ${name}`);
    }
    externalDependencies[name] = specifier;
  }

  for (const entry of runtimePackages.slice(1)) {
    entry.packageJson.dependencies = Object.fromEntries(
      Object.entries(entry.packageJson.dependencies ?? {}).filter(([name]) =>
        name.startsWith("@getpaseo/"),
      ),
    );
    entry.packageJson.peerDependencies = Object.fromEntries(
      Object.entries(entry.packageJson.peerDependencies ?? {}).filter(([name]) =>
        name.startsWith("@getpaseo/"),
      ),
    );
    writeFileSync(entry.packagePath, `${JSON.stringify(entry.packageJson, null, 2)}\n`);
  }

  packageJson.name = "@bytetrue/byspace";
  packageJson.bin = { byspace: "bin/byspace" };
  packageJson.repository = {
    type: "git",
    url: "git+https://github.com/ByteTrue/byspace.git",
  };
  packageJson.bugs = { url: "https://github.com/ByteTrue/byspace/issues" };
  packageJson.gitHead = sourceCommit;
  packageJson.dependencies = Object.fromEntries(
    Object.entries({
      ...externalDependencies,
      ...Object.fromEntries(bundledPackages.map((name) => [name, rootPackage.version])),
    }).sort(([left], [right]) => left.localeCompare(right)),
  );
  packageJson.bundledDependencies = bundledPackages;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

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
  const verificationDir = path.join(temporaryDir, "verify");
  extract(tarball, verificationDir);

  const packedPackage = JSON.parse(
    readFileSync(path.join(verificationDir, "package.json"), "utf8"),
  );
  if (packedPackage.name !== "@bytetrue/byspace" || packedPackage.version !== rootPackage.version) {
    throw new Error("Packed package identity does not match the source release");
  }
  if (packedPackage.bin?.byspace !== "bin/byspace") {
    throw new Error("Packed package does not expose the byspace binary");
  }
  for (const dependency of bundledPackages) {
    if (!existsSync(path.join(verificationDir, "node_modules", ...dependency.split("/")))) {
      throw new Error(`Packed package is missing ${dependency}`);
    }
  }

  const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  writeFileSync(path.join(outputDir, "SHA256SUMS.txt"), `${digest}  ${filename}\n`);
  process.stdout.write(
    `${JSON.stringify({ package: packedPackage.name, version: packedPackage.version, sourceCommit, sourceTree, tarball, sha256: digest })}\n`,
  );
} finally {
  rmSync(temporaryDir, { recursive: true, force: true });
}
