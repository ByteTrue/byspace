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
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePackedFilename } from "./pack-byspace-output.mjs";

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
  const workspacePath = `./${relative(root, workspaceDir).replaceAll("\\", "/")}`;
  const output = runNpm([
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    destination,
    workspacePath,
  ]);
  return join(
    destination,
    parsePackedFilename(
      output,
      JSON.parse(readFileSync(join(workspaceDir, "package.json"), "utf8")).name,
    ),
  );
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
  manifest.files = ["bin", "dist", "!dist/**/*.map", "README.md", "LICENSE"];
  manifest.bundleDependencies = [];

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
    const bundledDir = join(
      stagingDir,
      "node_modules",
      "@bytetrue",
      workspaceManifest.name.slice("@bytetrue/".length),
    );
    cpSync(join(extractDir, "package"), bundledDir, { recursive: true });

    // npm does not install a bundled package's transitive dependencies during a global install.
    // The public root already owns the flattened dependency graph, so keep bundled workspaces as
    // code-only packages and avoid npm deduping their dependencies into empty directories.
    const bundledManifestPath = join(bundledDir, "package.json");
    const bundledManifest = JSON.parse(readFileSync(bundledManifestPath, "utf8"));
    delete bundledManifest.dependencies;
    delete bundledManifest.optionalDependencies;
    delete bundledManifest.peerDependencies;
    delete bundledManifest.peerDependenciesMeta;
    writeFileSync(bundledManifestPath, `${JSON.stringify(bundledManifest, null, 2)}\n`);

    manifest.dependencies[workspaceManifest.name] = workspaceManifest.version;
    manifest.bundleDependencies.push(workspaceManifest.name);
  }

  writeFileSync(join(stagingDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const finalOutput = runNpm(
    ["pack", "--ignore-scripts", "--json", "--pack-destination", artifactsDir, "."],
    { cwd: stagingDir },
  );
  const finalFilename = parsePackedFilename(finalOutput, manifest.name);
  process.stdout.write(`${join(artifactsDir, finalFilename)}\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
