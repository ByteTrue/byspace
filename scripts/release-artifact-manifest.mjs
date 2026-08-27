import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const kinds = new Set(["npm", "web"]);
const manifestKeys = ["artifact", "commit", "kind", "schemaVersion", "sha256", "version"];

function parseOptions(args) {
  if (args.length % 2 !== 0)
    throw new Error(`Expected option/value pairs, received: ${args.join(" ")}`);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (!option.startsWith("--") || option in options) throw new Error(`Invalid option ${option}`);
    options[option] = args[index + 1];
  }
  return options;
}

function requireOption(options, name) {
  const value = options[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateCommit(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Invalid commit SHA ${commit}`);
}

function expectedArtifactName(kind, version) {
  return kind === "npm" ? `bytetrue-byspace-${version}.tgz` : `byspace-web-${version}.tgz`;
}

function runTar(args, artifactPath, ...entries) {
  const result = spawnSync("tar", [...args, artifactPath, ...entries], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Could not inspect ${basename(artifactPath)}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function validateArtifact(kind, artifactPath, version) {
  const info = statSync(artifactPath);
  if (!info.isFile() || info.size === 0) throw new Error(`${artifactPath} is not a non-empty file`);

  if (kind === "npm") {
    const packedManifest = JSON.parse(runTar(["-xOzf"], artifactPath, "package/package.json"));
    if (packedManifest.name !== "@bytetrue/byspace") {
      throw new Error(`npm artifact contains package ${packedManifest.name ?? "<missing>"}`);
    }
    if (packedManifest.version !== version) {
      throw new Error(
        `npm artifact contains version ${packedManifest.version ?? "<missing>"}, expected ${version}`,
      );
    }
    return;
  }

  const entries = runTar(["-tzf"], artifactPath)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => entry.replace(/^\.\//, ""));
  if (!entries.includes("dist/index.html")) {
    throw new Error("Web artifact does not contain dist/index.html");
  }
  if (entries.some((entry) => entry !== "dist" && !entry.startsWith("dist/"))) {
    throw new Error("Web artifact contains files outside dist/");
  }
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function readManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const keys = Object.keys(manifest).sort();
  if (JSON.stringify(keys) !== JSON.stringify(manifestKeys)) {
    throw new Error(`Artifact manifest has unexpected fields: ${keys.join(", ")}`);
  }
  if (manifest.schemaVersion !== 1 || !kinds.has(manifest.kind)) {
    throw new Error("Unsupported artifact manifest schema");
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.sha256)) {
    throw new Error("Artifact manifest has an invalid SHA-256");
  }
  return manifest;
}

function createManifest(options) {
  const kind = requireOption(options, "--kind");
  const commit = requireOption(options, "--commit");
  const artifactPath = resolve(requireOption(options, "--artifact"));
  const manifestPath = resolve(requireOption(options, "--manifest"));
  if (!kinds.has(kind)) throw new Error(`Unsupported artifact kind ${kind}`);
  validateCommit(commit);

  const artifact = expectedArtifactName(kind, sourceManifest.version);
  if (artifactPath !== join(dirname(manifestPath), artifact)) {
    throw new Error(`${kind} artifact must be named ${artifact} and colocated with its manifest`);
  }
  validateArtifact(kind, artifactPath, sourceManifest.version);

  const manifest = {
    schemaVersion: 1,
    kind,
    commit,
    version: sourceManifest.version,
    artifact,
    sha256: sha256(artifactPath),
  };
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Created ${kind} artifact manifest for ${commit} (sha256 ${manifest.sha256})`);
}

function verifyManifest(options) {
  const expectedKind = requireOption(options, "--kind");
  const expectedCommit = requireOption(options, "--commit");
  const manifestPath = resolve(requireOption(options, "--manifest"));
  if (!kinds.has(expectedKind)) throw new Error(`Unsupported artifact kind ${expectedKind}`);
  validateCommit(expectedCommit);

  const manifest = readManifest(manifestPath);
  if (manifest.kind !== expectedKind) {
    throw new Error(`Artifact kind ${manifest.kind} does not match ${expectedKind}`);
  }
  if (manifest.commit !== expectedCommit) {
    throw new Error(`Artifact commit ${manifest.commit} does not match ${expectedCommit}`);
  }
  if (manifest.version !== sourceManifest.version) {
    throw new Error(
      `Artifact version ${manifest.version} does not match ${sourceManifest.version}`,
    );
  }
  if (manifest.artifact !== expectedArtifactName(expectedKind, sourceManifest.version)) {
    throw new Error(`Artifact filename ${manifest.artifact} is invalid`);
  }

  const artifactPath = join(dirname(manifestPath), manifest.artifact);
  const actualSha256 = sha256(artifactPath);
  if (actualSha256 !== manifest.sha256) {
    throw new Error(`Artifact SHA-256 ${actualSha256} does not match ${manifest.sha256}`);
  }
  validateArtifact(expectedKind, artifactPath, sourceManifest.version);
  console.log(`Verified ${expectedKind} artifact for ${expectedCommit} (sha256 ${actualSha256})`);
}

try {
  const [command, ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  if (command === "create") createManifest(options);
  else if (command === "verify") verifyManifest(options);
  else throw new Error("Usage: release-artifact-manifest.mjs <create|verify> [options]");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
