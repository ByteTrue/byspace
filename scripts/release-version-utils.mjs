const versionPattern =
  /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?$/;
const sourceTagPattern =
  /^(?:(?:desktop(?:-(?:windows|linux|macos))?|android)-)?v(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

function assertInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

export function parseReleaseVersion(version) {
  const trimmed = version.trim();
  const match = trimmed.match(versionPattern);
  if (!match?.groups) {
    throw new Error(
      `Unsupported release version "${version}". Expected semver like 0.1.41 or 0.1.41-beta.1.`,
    );
  }

  const major = Number.parseInt(match.groups.major, 10);
  const minor = Number.parseInt(match.groups.minor, 10);
  const patch = Number.parseInt(match.groups.patch, 10);
  const prerelease = match.groups.prerelease ?? null;
  const betaMatch = prerelease?.match(/^beta\.(?<beta>\d+)$/) ?? null;
  const betaNumber = betaMatch?.groups?.beta ? Number.parseInt(betaMatch.groups.beta, 10) : null;

  if (prerelease !== null && betaNumber === null) {
    throw new Error(
      `Unsupported release version "${version}". Expected beta prerelease versions like 0.1.41-beta.1.`,
    );
  }

  assertInteger(major, "major version");
  assertInteger(minor, "minor version");
  assertInteger(patch, "patch version");
  if (betaNumber !== null) {
    assertInteger(betaNumber, "beta number");
  }

  return {
    version: trimmed,
    major,
    minor,
    patch,
    prerelease,
    baseVersion: `${major}.${minor}.${patch}`,
    isPrerelease: prerelease !== null,
    isBeta: betaNumber !== null,
    betaNumber,
  };
}

export function formatReleaseVersion({ major, minor, patch, prerelease = null }) {
  assertInteger(major, "major version");
  assertInteger(minor, "minor version");
  assertInteger(patch, "patch version");
  return prerelease ? `${major}.${minor}.${patch}-${prerelease}` : `${major}.${minor}.${patch}`;
}

export function normalizeReleaseTag(rawTag) {
  const trimmed = rawTag.trim().replace(/^refs\/tags\//, "");
  const match = trimmed.match(sourceTagPattern);
  if (!match?.groups?.version) {
    throw new Error(
      `Unsupported release tag "${rawTag}". Expected vX.Y.Z, vX.Y.Z-beta.N, desktop-v..., or android-v...`,
    );
  }
  return `v${match.groups.version}`;
}

export function getReleaseInfoFromSourceTag(sourceTag) {
  const releaseTag = normalizeReleaseTag(sourceTag);
  const parsed = parseReleaseVersion(releaseTag.slice(1));
  return {
    sourceTag,
    releaseTag,
    version: parsed.version,
    baseVersion: parsed.baseVersion,
    prerelease: parsed.prerelease,
    isPrerelease: parsed.isPrerelease,
    isBeta: parsed.isBeta,
    betaNumber: parsed.betaNumber,
    releaseType: parsed.isPrerelease ? "prerelease" : "release",
    releaseChannel: parsed.isBeta ? "beta" : "latest",
    isSmokeTag: sourceTag.includes("gha-smoke"),
  };
}

export function computeNextReleaseVersion(currentVersion, mode) {
  const parsed = parseReleaseVersion(currentVersion);

  if (mode === "patch" || mode === "minor" || mode === "major") {
    if (parsed.isPrerelease) {
      throw new Error(
        `Cannot cut a stable ${mode} release from prerelease version ${currentVersion}. Promote it first.`,
      );
    }
    if (mode === "patch") {
      return formatReleaseVersion({
        major: parsed.major,
        minor: parsed.minor,
        patch: parsed.patch + 1,
      });
    }
    if (mode === "minor") {
      return formatReleaseVersion({
        major: parsed.major,
        minor: parsed.minor + 1,
        patch: 0,
      });
    }
    return formatReleaseVersion({
      major: parsed.major + 1,
      minor: 0,
      patch: 0,
    });
  }

  if (mode === "beta-patch" || mode === "beta-minor" || mode === "beta-major") {
    if (parsed.isPrerelease) {
      throw new Error(
        `Cannot start a new beta line from prerelease version ${currentVersion}. Use beta-next or promote.`,
      );
    }
    if (mode === "beta-patch") {
      return formatReleaseVersion({
        major: parsed.major,
        minor: parsed.minor,
        patch: parsed.patch + 1,
        prerelease: "beta.1",
      });
    }
    if (mode === "beta-minor") {
      return formatReleaseVersion({
        major: parsed.major,
        minor: parsed.minor + 1,
        patch: 0,
        prerelease: "beta.1",
      });
    }
    return formatReleaseVersion({
      major: parsed.major + 1,
      minor: 0,
      patch: 0,
      prerelease: "beta.1",
    });
  }

  if (mode === "beta-next") {
    if (!parsed.isBeta || parsed.betaNumber === null) {
      throw new Error(
        `Cannot advance beta number from ${currentVersion}. Expected a version like 0.1.41-beta.1.`,
      );
    }
    return formatReleaseVersion({
      major: parsed.major,
      minor: parsed.minor,
      patch: parsed.patch,
      prerelease: `beta.${parsed.betaNumber + 1}`,
    });
  }

  if (mode === "promote") {
    if (!parsed.isBeta) {
      throw new Error(
        `Cannot promote ${currentVersion}. Expected a beta version like 0.1.41-beta.1.`,
      );
    }
    return parsed.baseVersion;
  }

  throw new Error(`Unsupported release mode "${mode}".`);
}

/**
 * Classify the CI state of a commit as seen through `gh run list`.
 *
 * A push does not create a run instantly, so the first poll after `git push` sees no run at all.
 * Treating that as "not green" is what forced a release into two steps; treating it as "wait" is
 * what makes one command possible. A concluded non-success is terminal — retrying the wait would
 * only burn time on a commit that cannot pass.
 *
 * @param {{status?: string, conclusion?: string} | null | undefined} state
 * @returns {"green" | "pending" | "failed"}
 */
export function classifyCiState(state) {
  const status = (state?.status ?? "").trim();
  const conclusion = (state?.conclusion ?? "").trim();
  if (status === "completed") {
    return conclusion === "success" ? "green" : "failed";
  }
  if (
    status === "queued" ||
    status === "in_progress" ||
    status === "requested" ||
    status === "waiting" ||
    status === "pending"
  ) {
    return "pending";
  }
  // No run yet: the push happened seconds ago and Actions has not created it.
  return "pending";
}

// The jobs a release tag must actually have run. A path-filtered run reports success with these
// skipped, and that success tagged v0.25.0 on code no end-to-end suite had ever executed.
export const RELEASE_REQUIRED_JOBS = [
  "format",
  "lint",
  "typecheck",
  "go-tests",
  "sdk-tests",
  "relay-tests",
  "build-e2e",
  "app-tests",
  "playwright",
];

export function normalizeJobName(name) {
  // "playwright (shard 3/16)" and "go-tests (windows-latest)" are variants of one job.
  return name.replace(/\s*\(.*\)$/, "").trim();
}

// Returns the required jobs that never ran and those that did not pass, given a map of
// normalized job name -> list of conclusions (one per variant).
export function verifyReleaseJobs(conclusions) {
  const missing = RELEASE_REQUIRED_JOBS.filter((job) => !conclusions.has(job));
  const failed = RELEASE_REQUIRED_JOBS.filter((job) =>
    (conclusions.get(job) ?? []).some((conclusion) => conclusion !== "success"),
  );
  return { missing, failed };
}

/**
 * Decide what the release tag may do with the pushed commit's CI run.
 *
 * A full green push run is evidence on its own, and waiting for it avoids dispatching a second
 * full run that the shared concurrency group would then serialize behind the first one. A green
 * run that skipped required jobs is not evidence, so the caller dispatches a full run instead.
 * A pending run means wait; a failed one is terminal.
 *
 * @param {{status?: string, conclusion?: string} | null | undefined} pushState
 * @param {Map<string, string[]> | null | undefined} conclusions normalized job name -> conclusions
 * @returns {{action: "wait" | "fail" | "tag" | "dispatch", detail: string}}
 */
export function releaseGateAction(pushState, conclusions) {
  const state = classifyCiState(pushState);
  if (state === "pending") return { action: "wait", detail: "" };
  if (state === "failed") {
    return { action: "fail", detail: "the push CI run did not pass" };
  }
  const { missing, failed } = verifyReleaseJobs(conclusions ?? new Map());
  if (missing.length === 0 && failed.length === 0) return { action: "tag", detail: "" };
  return { action: "dispatch", detail: [...missing, ...failed].join(", ") };
}
