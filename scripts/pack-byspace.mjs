import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = join(root, "packages", "cli");
const artifactsDir = join(root, "artifacts");
const internalWorkspaces = ["highlight", "protocol", "client", "relay", "server"];
const npmCli = process.env.npm_execpath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    const detail = result.error ? `: ${result.error.message}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}${detail}`);
  }
  return result.stdout ?? "";
}

function runNpm(args, options = {}) {
  return npmCli
    ? run(process.execPath, [npmCli, ...args], options)
    : run("npm", args, { ...options, shell: process.platform === "win32" });
}

function packWorkspace(workspaceDir, destination) {
  const output = runNpm([
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    destination,
    workspaceDir,
  ]);
  const result = JSON.parse(output);
  const filename = result[0]?.filename;
  if (typeof filename !== "string")
    throw new Error(`npm pack returned no filename for ${workspaceDir}`);
  return join(destination, filename);
}

runNpm(["run", "build:server:clean"]);
runNpm(["run", "build:daemon-web-ui"]);

mkdirSync(artifactsDir, { recursive: true });
for (const filename of readdirSync(artifactsDir)) {
  if (/^bytetrue-byspace-.*\.tgz$/.test(filename)) rmSync(join(artifactsDir, filename));
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "byspace-pack-"));
try {
  const tarballsDir = join(temporaryRoot, "tarballs");
  const stagingDir = join(temporaryRoot, "package");
  mkdirSync(tarballsDir, { recursive: true });
  mkdirSync(join(stagingDir, "node_modules", "@bytetrue"), { recursive: true });

  const manifest = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"));
  delete manifest.devDependencies;
  delete manifest.scripts;
  manifest.files = ["bin", "dist", "README.md", "LICENSE"];
  manifest.bundleDependencies = [];
  const internalVersions = new Map();

  cpSync(join(cliDir, "bin"), join(stagingDir, "bin"), { recursive: true });
  cpSync(join(cliDir, "dist"), join(stagingDir, "dist"), { recursive: true });
  cpSync(join(root, "README.md"), join(stagingDir, "README.md"));
  cpSync(join(root, "LICENSE"), join(stagingDir, "LICENSE"));
  chmodSync(join(stagingDir, "bin", "byspace"), 0o755);

  for (const workspace of internalWorkspaces) {
    const workspaceDir = join(root, "packages", workspace);
    const workspaceManifest = JSON.parse(readFileSync(join(workspaceDir, "package.json"), "utf8"));
    for (const [name, range] of Object.entries(workspaceManifest.dependencies ?? {})) {
      if (name === "@bytetrue/byspace" || name.startsWith("@bytetrue/byspace-")) continue;
      const existing = manifest.dependencies[name];
      if (existing && existing !== range) {
        throw new Error(`Conflicting dependency ranges for ${name}: ${existing} and ${range}`);
      }
      manifest.dependencies[name] = range;
    }

    const tarball = packWorkspace(workspaceDir, tarballsDir);
    const extractDir = join(temporaryRoot, `extract-${workspace}`);
    mkdirSync(extractDir, { recursive: true });
    run("tar", ["-xzf", tarball, "-C", extractDir]);
    cpSync(
      join(extractDir, "package"),
      join(
        stagingDir,
        "node_modules",
        "@bytetrue",
        workspaceManifest.name.slice("@bytetrue/".length),
      ),
      { recursive: true },
    );
    manifest.dependencies[workspaceManifest.name] = `file:${tarball}`;
    manifest.bundleDependencies.push(workspaceManifest.name);
    internalVersions.set(workspaceManifest.name, workspaceManifest.version);
  }

  writeFileSync(join(stagingDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  runNpm(["install", "--package-lock-only", "--ignore-scripts"], { cwd: stagingDir });

  const packageLockPath = join(stagingDir, "package-lock.json");
  const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8"));
  for (const [name, version] of internalVersions) {
    manifest.dependencies[name] = version;
    packageLock.packages[""].dependencies[name] = version;
  }
  writeFileSync(join(stagingDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);

  const finalOutput = runNpm(
    ["pack", "--ignore-scripts", "--json", "--pack-destination", artifactsDir, "."],
    { cwd: stagingDir },
  );
  const finalFilename = JSON.parse(finalOutput)[0]?.filename;
  if (typeof finalFilename !== "string") throw new Error("npm pack returned no BySpace artifact");
  process.stdout.write(`${join(artifactsDir, finalFilename)}\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
