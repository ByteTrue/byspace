// Gate the stamped release manifests before anything is published. The rollout
// fields catch a mis-stamped run; the macOS checks catch the failure mode that
// actually bit us, which is a mac manifest that ships one architecture. The
// updater picks the DMG matching the running arch, so a half-populated manifest
// silently strands every user on the missing one.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { MACOS_MINIMUM_DARWIN_VERSION } from "./merge-mac-manifest.mjs";

const REQUIRED_MAC_ARCHITECTURES = ["arm64", "x64"];

function dmgEntriesByArchitecture(files) {
  const found = new Map();
  for (const file of files) {
    const url = typeof file?.url === "string" ? file.url : "";
    if (!url.endsWith(".dmg")) continue;
    const architecture = REQUIRED_MAC_ARCHITECTURES.find((name) => url.endsWith(`-${name}.dmg`));
    if (architecture) found.set(architecture, file);
  }
  return found;
}

function validateMacManifest(manifestPath, manifest) {
  if (manifest.minimumSystemVersion !== MACOS_MINIMUM_DARWIN_VERSION) {
    throw new Error(
      `${manifestPath}: minimumSystemVersion=${manifest.minimumSystemVersion}, expected ${MACOS_MINIMUM_DARWIN_VERSION}`,
    );
  }

  const dmgs = dmgEntriesByArchitecture(manifest.files ?? []);
  for (const architecture of REQUIRED_MAC_ARCHITECTURES) {
    const entry = dmgs.get(architecture);
    if (!entry) {
      throw new Error(`${manifestPath}: missing the ${architecture} DMG entry`);
    }
    if (typeof entry.sha512 !== "string" || entry.sha512.length === 0) {
      throw new Error(`${manifestPath}: ${architecture} DMG entry has no sha512`);
    }
  }
}

export function validateDesktopManifests({ releaseDate, rolloutHours }, paths) {
  if (!Number.isFinite(rolloutHours) || rolloutHours < 0) {
    throw new Error(`expected non-negative rolloutHours, got ${rolloutHours}`);
  }
  if (paths.length === 0) {
    throw new Error("expected at least one manifest to validate");
  }

  for (const manifestPath of paths) {
    const manifest = load(fs.readFileSync(manifestPath, "utf8")) ?? {};
    if (manifest.rolloutHours !== rolloutHours) {
      throw new Error(
        `${manifestPath}: rolloutHours=${manifest.rolloutHours}, expected ${rolloutHours}`,
      );
    }
    if (manifest.releaseDate !== releaseDate) {
      throw new Error(
        `${manifestPath}: releaseDate=${manifest.releaseDate}, expected ${releaseDate}`,
      );
    }
    if (typeof manifest.version !== "string" || manifest.version.length === 0) {
      throw new Error(`${manifestPath}: missing or invalid version`);
    }
    if (manifestPath.endsWith("-mac.yml")) {
      validateMacManifest(manifestPath, manifest);
    }
  }
}

function parseArgs(argv) {
  const paths = [];
  let releaseDate;
  let rolloutHours;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--release-date") {
      releaseDate = argv[++index];
    } else if (argv[index] === "--rollout-hours") {
      rolloutHours = Number(argv[++index]);
    } else {
      paths.push(argv[index]);
    }
  }

  if (!releaseDate || rolloutHours === undefined || paths.length === 0) {
    throw new Error(
      "Usage: node scripts/validate-desktop-manifests.mjs --release-date <date> --rollout-hours <hours> <manifest...>",
    );
  }

  return { releaseDate, rolloutHours, paths };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { releaseDate, rolloutHours, paths } = parseArgs(process.argv.slice(2));
  validateDesktopManifests({ releaseDate, rolloutHours }, paths);
}
