import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const MANIFEST_NAME = "client-release-manifest.json";
const CHECKSUMS_NAME = "SHA256SUMS.txt";
const MACOS_SIGNING_MODES = new Set(["ad-hoc", "developer-id-notarized"]);
const WINDOWS_SIGNING_MODES = new Set(["unsigned", "authenticode"]);

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function regularFileNames(directory) {
  return readdirSync(directory)
    .filter((name) => statSync(join(directory, name)).isFile())
    .sort();
}

function requireValue(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function normalizeFingerprint(value) {
  const normalized = requireValue(value, "android certificate SHA-256")
    .replaceAll(":", "")
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("android certificate SHA-256 must contain 64 hexadecimal characters");
  }
  return normalized;
}

function inferPlatform(name) {
  if (/android\.apk$/i.test(name)) return "android";
  if (
    /BySpace-Setup-.*\.(?:exe|zip|blockmap)$/i.test(name) ||
    /^(?:latest|beta)\.yml$/.test(name)
  ) {
    return "windows";
  }
  if (/BySpace-.*\.(?:dmg|zip)(?:\.blockmap)?$/i.test(name) || /(?:^|-)mac\.yml$/i.test(name)) {
    return "macos";
  }
  if (/\.(?:AppImage|deb|rpm|tar\.gz)(?:\.blockmap)?$/i.test(name) || /-linux\.yml$/i.test(name)) {
    return "linux";
  }
  return "shared";
}

function inferArchitecture(name) {
  if (/-arm64(?:\.|-)/i.test(name)) return "arm64";
  if (/-x64(?:\.|-)/i.test(name) || /-x86_64(?:\.|-)/i.test(name)) return "x64";
  return null;
}

function requiredAssetPatterns(version, channel) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const updaterChannel = channel === "stable" ? "latest" : "beta";
  return [
    new RegExp(`^BySpace-${escapedVersion}-arm64\\.dmg$`),
    new RegExp(`^BySpace-${escapedVersion}-arm64\\.zip$`),
    new RegExp(`^BySpace-${escapedVersion}-x64\\.dmg$`),
    new RegExp(`^BySpace-${escapedVersion}-x64\\.zip$`),
    /^BySpace-(?:x64|x86_64)\.AppImage$/,
    new RegExp(`^BySpace-${escapedVersion}-x64\\.deb$`),
    new RegExp(`^BySpace-${escapedVersion}-x64\\.rpm$`),
    new RegExp(`^BySpace-${escapedVersion}-x64\\.tar\\.gz$`),
    new RegExp(`^BySpace-Setup-${escapedVersion}-x64\\.exe$`),
    new RegExp(`^BySpace-Setup-${escapedVersion}-x64\\.zip$`),
    new RegExp(`^BySpace-Setup-${escapedVersion}-arm64\\.exe$`),
    new RegExp(`^BySpace-Setup-${escapedVersion}-arm64\\.zip$`),
    new RegExp(`^BySpace-${escapedVersion}-android\\.apk$`),
    new RegExp(`^${updaterChannel}-mac\\.yml$`),
    new RegExp(`^${updaterChannel}-linux\\.yml$`),
    new RegExp(`^${updaterChannel}\\.yml$`),
  ];
}

function validateReleaseInputs(input) {
  const version = requireValue(input.version, "version");
  const tag = requireValue(input.tag, "tag");
  if (tag !== `v${version}`) {
    throw new Error(`tag ${tag} does not match version ${version}`);
  }
  const commit = requireValue(input.commit, "commit").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("commit must be a full 40-character Git SHA");
  }
  const channel = requireValue(input.channel, "channel");
  if (channel !== "stable" && channel !== "beta") {
    throw new Error(`channel must be stable or beta, got ${channel}`);
  }
  if (!MACOS_SIGNING_MODES.has(input.macosSigning)) {
    throw new Error(`unsupported macOS signing mode: ${input.macosSigning}`);
  }
  if (!WINDOWS_SIGNING_MODES.has(input.windowsSigning)) {
    throw new Error(`unsupported Windows signing mode: ${input.windowsSigning}`);
  }
  return {
    ...input,
    version,
    tag,
    commit,
    channel,
    androidCertSha256: normalizeFingerprint(input.androidCertSha256),
  };
}

function payloadNames(directory) {
  const names = regularFileNames(directory).filter(
    (name) => name !== MANIFEST_NAME && name !== CHECKSUMS_NAME,
  );
  const iosAssets = names.filter((name) =>
    /(?:^|[-_.])ios(?:[-_.]|$)|\.ipa$|\.xcarchive$/i.test(name),
  );
  if (iosAssets.length > 0) {
    throw new Error(`iOS assets are forbidden in BySpace client releases: ${iosAssets.join(", ")}`);
  }
  return names;
}

function validateRequiredAssets(names, version, channel) {
  const missing = requiredAssetPatterns(version, channel).filter(
    (pattern) => !names.some((name) => pattern.test(name)),
  );
  if (missing.length > 0) {
    throw new Error(`missing required client release assets: ${missing.join(", ")}`);
  }
}

function validateUpdaterAssetReferences(directory, names) {
  const manifests = names.filter((name) => /^(?:latest|beta)(?:-mac|-linux)?\.yml$/.test(name));
  for (const manifest of manifests) {
    const references = Array.from(
      readFileSync(join(directory, manifest), "utf8").matchAll(
        /^\s*(?:url|path):\s*["']?([^"'\s]+)["']?\s*$/gm,
      ),
      (match) => basename(decodeURIComponent(match[1])),
    );
    if (references.length === 0) {
      throw new Error(`updater manifest contains no asset references: ${manifest}`);
    }
    for (const reference of references) {
      if (!names.includes(reference)) {
        throw new Error(`updater manifest ${manifest} references missing asset: ${reference}`);
      }
    }
  }
}

export function createClientReleaseManifest(input) {
  const normalized = validateReleaseInputs(input);
  const directory = resolve(normalized.directory);
  const names = payloadNames(directory);
  validateRequiredAssets(names, normalized.version, normalized.channel);
  validateUpdaterAssetReferences(directory, names);

  const assets = names.map((name) => {
    const path = join(directory, name);
    return {
      name,
      platform: inferPlatform(name),
      architecture: inferArchitecture(name),
      bytes: statSync(path).size,
      sha256: sha256(path),
    };
  });
  const manifest = {
    schemaVersion: 1,
    repository: "ByteTrue/byspace",
    tag: normalized.tag,
    version: normalized.version,
    commit: normalized.commit,
    channel: normalized.channel,
    signing: {
      android: {
        mode: "release-key",
        certificateSha256: normalized.androidCertSha256,
      },
      macos: { mode: normalized.macosSigning },
      windows: { mode: normalized.windowsSigning },
    },
    ios: {
      published: false,
      reason: "source-retained-but-excluded-from-cd",
    },
    assets,
  };

  const manifestPath = join(directory, MANIFEST_NAME);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const checksumNames = [...names, MANIFEST_NAME].sort();
  writeFileSync(
    join(directory, CHECKSUMS_NAME),
    `${checksumNames.map((name) => `${sha256(join(directory, name))}  ${name}`).join("\n")}\n`,
  );
  return manifest;
}

export function verifyClientReleaseManifest({ directory, tag, commit }) {
  const resolvedDirectory = resolve(directory);
  const manifest = JSON.parse(readFileSync(join(resolvedDirectory, MANIFEST_NAME), "utf8"));
  const normalized = validateReleaseInputs({
    directory: resolvedDirectory,
    tag: tag ?? manifest.tag,
    version: manifest.version,
    commit: commit ?? manifest.commit,
    channel: manifest.channel,
    androidCertSha256: manifest.signing?.android?.certificateSha256,
    macosSigning: manifest.signing?.macos?.mode,
    windowsSigning: manifest.signing?.windows?.mode,
  });
  if (manifest.tag !== normalized.tag || manifest.commit !== normalized.commit) {
    throw new Error("client release manifest does not match the expected tag and commit");
  }
  if (manifest.ios?.published !== false) {
    throw new Error("client release manifest must explicitly exclude iOS publication");
  }

  const names = payloadNames(resolvedDirectory);
  validateRequiredAssets(names, normalized.version, normalized.channel);
  validateUpdaterAssetReferences(resolvedDirectory, names);
  const listedNames = manifest.assets.map((asset) => asset.name).sort();
  if (JSON.stringify(listedNames) !== JSON.stringify(names)) {
    throw new Error("client release manifest asset list does not match files on disk");
  }
  for (const asset of manifest.assets) {
    const path = join(resolvedDirectory, asset.name);
    if (statSync(path).size !== asset.bytes || sha256(path) !== asset.sha256) {
      throw new Error(`client release asset failed integrity verification: ${asset.name}`);
    }
  }

  const expectedChecksumLines = [...names, MANIFEST_NAME]
    .sort()
    .map((name) => `${sha256(join(resolvedDirectory, name))}  ${name}`);
  const actualChecksumLines = readFileSync(join(resolvedDirectory, CHECKSUMS_NAME), "utf8")
    .trimEnd()
    .split("\n");
  if (JSON.stringify(actualChecksumLines) !== JSON.stringify(expectedChecksumLines)) {
    throw new Error(`${CHECKSUMS_NAME} does not match the release payload`);
  }
  return manifest;
}

function parseArgs(argv) {
  const command = argv.shift();
  const values = {};
  while (argv.length > 0) {
    const key = argv.shift();
    if (!key?.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    const value = argv.shift();
    if (!value) throw new Error(`missing value for ${key}`);
    values[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return { command, values };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { command, values } = parseArgs(process.argv.slice(2));
  if (command === "create") {
    createClientReleaseManifest(values);
  } else if (command === "verify") {
    verifyClientReleaseManifest(values);
  } else {
    throw new Error(
      "Usage: node scripts/client-release-manifest.mjs <create|verify> --directory <path> [release metadata]",
    );
  }
}
