import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";
import { parseReleaseVersion } from "./release-version-utils.mjs";

const root = resolve(import.meta.dirname, "..");
const packageName = "@bytetrue/byspace";
const publishScriptPath = resolve(root, "scripts", "publish-byspace.mjs");

function readCurrentVersion() {
  return JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
}

export function buildReleaseVerifyPublishArgs(version) {
  const { isPrerelease } = parseReleaseVersion(version);
  return ["--dry-run", "--skip-pack", ...(isPrerelease ? ["--tag", "beta"] : [])];
}

function requestRegistryStatus(url) {
  return new Promise((resolveStatus, reject) => {
    const request = httpsRequest(url, { method: "GET", timeout: 15_000 }, (response) => {
      response.resume();
      response.on("end", () => resolveStatus(response.statusCode ?? 0));
    });

    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error(`Timed out fetching ${url}`)));
    request.end();
  });
}

export async function isPublishedVersion(version, deps = {}) {
  const getStatus = deps.getStatus ?? requestRegistryStatus;
  const status = await getStatus(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
  );

  if (status === 200) return true;
  if (status === 404) return false;
  throw new Error(`Failed to verify npm publication for ${packageName}@${version}: HTTP ${status}`);
}

function runPublishScript(args) {
  const result = spawnSync(process.execPath, [publishScriptPath, ...args], {
    cwd: root,
    stdio: "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = result.error ? `: ${result.error.message}` : "";
    throw new Error(
      `${process.execPath} ${[publishScriptPath, ...args].join(" ")} failed${detail}`,
    );
  }
}

export async function verifyRelease(version, deps = {}) {
  const checkPublished =
    deps.checkPublished ?? ((currentVersion) => isPublishedVersion(currentVersion, deps));
  const runPublish = deps.runPublish ?? runPublishScript;
  const log = deps.log ?? ((message) => process.stdout.write(`${message}\n`));

  if (await checkPublished(version)) {
    log(`Skipping dry-run publish verify for already-published ${packageName}@${version}.`);
    return;
  }

  runPublish(buildReleaseVerifyPublishArgs(version));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await verifyRelease(readCurrentVersion());
}
