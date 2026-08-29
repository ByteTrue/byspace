import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { load as loadYaml } from "js-yaml";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const collisionCriticalPaths = [
  "packages/server/src/server/paseo-home.ts",
  "packages/server/src/server/config.ts",
  "packages/server/src/server/persisted-config.ts",
  "packages/server/src/server/pid-lock.ts",
  "packages/cli/src/commands/daemon/local-daemon.ts",
  "packages/cli/src/commands/daemon/start.ts",
  "packages/cli/src/utils/client.ts",
  "packages/cli/src/commands/project/create.ts",
  "packages/cli/src/utils/client-id.ts",
  "packages/cli/src/utils/command-options.ts",
  "packages/protocol/src/daemon-endpoints.ts",
  "packages/desktop/src/daemon/daemon-manager.ts",
];

for (const path of collisionCriticalPaths) {
  const source = read(path);
  assert.doesNotMatch(
    source,
    /6767|6768|PASEO_HOME|PASEO_LISTEN|PASEO_HOST(?!NAMES)|paseo\.pid|\.paseo\/daemon/iu,
    path,
  );
}

const mobileIdentityPaths = [
  "packages/app/fastlane/Appfile",
  "packages/app/fastlane/Fastfile",
  "packages/app/maestro/test-sidebar-drag-cancellation-ios.sh",
  "packages/app/maestro/test-workspace-create-android-crash.sh",
  "packages/app/maestro/record-workspace-create-android-focus.sh",
  "packages/app/maestro/flows/land-in-chat.yaml",
];
for (const path of mobileIdentityPaths) {
  assert.doesNotMatch(read(path), /sh\.paseo|127\.0\.0\.1:6767|tcp:6767/iu, path);
}

for (const path of [
  "packages/server/src/server/pid-lock.test.ts",
  "packages/cli/tests/22-daemon-stop-supervisor.test.ts",
  "packages/cli/tests/33-daemon-stop-tree-kill.test.ts",
  "packages/cli/tests/34-daemon-stop-stale-reachable.test.ts",
  "packages/desktop/e2e/support/runtime.ts",
]) {
  assert.doesNotMatch(read(path), /paseo\.pid|Another Paseo daemon|127\.0\.0\.1:6767/iu, path);
}

const rootPackage = JSON.parse(read("package.json"));
const cliPackage = JSON.parse(read("packages/cli/package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
assert.equal(rootPackage.name, "byspace");
assert.deepEqual(cliPackage.bin, { byspace: "bin/byspace" });
assert.deepEqual(packageLock.packages["packages/cli"].bin, { byspace: "bin/byspace" });

const serverConfig = read("packages/server/src/server/config.ts");
assert.match(serverConfig, /DEFAULT_PORT = 6777/u);
assert.match(serverConfig, /env\.BYSPACE_LISTEN/u);

const paths = read("packages/server/src/server/paseo-home.ts");
assert.match(paths, /env\.BYSPACE_HOME/u);
assert.match(paths, /"~\/\.byspace"/u);

const cliClient = read("packages/cli/src/utils/client.ts");
assert.match(cliClient, /process\.env\.BYSPACE_HOST/u);
assert.doesNotMatch(cliClient, /process\.env\.PASEO_HOST/u);

const appConfig = read("packages/app/app.config.js");
assert.match(appConfig, /packageId: "com\.bytetrue\.byspace"/u);
assert.match(appConfig, /packageId: "com\.bytetrue\.byspace\.debug"/u);
assert.match(appConfig, /scheme: "byspace"/u);

const desktopConfig = read("packages/desktop/electron-builder.yml");
assert.match(desktopConfig, /appId: com\.bytetrue\.byspace\.desktop/u);
assert.match(desktopConfig, /productName: BySpace/u);
assert.doesNotMatch(desktopConfig, /paseo:\/\//iu);

const easConfig = JSON.parse(read("packages/app/eas.json"));
assert.equal(easConfig.submit, undefined, "upstream store submission profiles must stay disabled");

const hostedDefaults = [
  serverConfig,
  read("packages/app/src/components/hosts/host-picker.tsx"),
  read("packages/cli/src/commands/hub/authority.ts"),
].join("\n");
assert.match(hostedDefaults, /relay\.byspace\.cc\.cd/u);
assert.match(hostedDefaults, /https:\/\/hub\.byspace\.cc\.cd/u);

const liveRelayTest = read("packages/relay/src/live-relay.e2e.test.ts");
assert.match(liveRelayTest, /wss:\/\/relay\.byspace\.cc\.cd/u);
assert.doesNotMatch(liveRelayTest, /relay\.paseo\.sh/iu);

const deployAppWorkflow = read(".github/workflows/deploy-app.yml");
assert.doesNotMatch(deployAppWorkflow, /workflow_dispatch/u);
assert.match(deployAppWorkflow, /Verify exact current-main CI SHA/u);
assert.match(deployAppWorkflow, /persist-credentials: false/u);
assert.ok(
  deployAppWorkflow.indexOf("Verify exact current-main CI SHA") <
    deployAppWorkflow.indexOf("npm-retry.mjs ci"),
  "Web deployment must pass the release gate before running repository install code",
);
assert.equal(
  existsSync(new URL("../.github/workflows/deploy-website.yml", import.meta.url)),
  false,
  "marketing website deployment must stay disabled",
);

const desktopReleaseWorkflow = read(".github/workflows/desktop-release.yml");
assert.doesNotMatch(desktopReleaseWorkflow, /desktop-(?:macos-|linux-|windows-)?v\*/u);
assert.doesNotMatch(
  desktopReleaseWorkflow,
  /Verify exact current-main CI SHA\s+if:/u,
  "release publishing must not skip the exact-SHA gate",
);

const dockerWorkflow = read(".github/workflows/docker.yml");
const dockerConfig = loadYaml(dockerWorkflow);
assert.deepEqual(Object.keys(dockerConfig.on.workflow_dispatch.inputs), ["byspace_version"]);
assert.match(dockerWorkflow, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/u);
assert.match(dockerWorkflow, /Revalidate remote release tag before image push/u);
assert.ok(
  dockerWorkflow.indexOf("Revalidate remote release tag before image push") <
    dockerWorkflow.lastIndexOf("docker/build-push-action"),
  "Docker must refresh the remote release tag before pushing the public image",
);
assert.match(dockerWorkflow, /ref: \$\{\{ needs\.setup\.outputs\.release_sha \}\}/u);

for (const path of [
  ".github/workflows/deploy-relay.yml",
  ".github/workflows/deploy-website.yml",
  ".github/workflows/release-notes-sync.yml",
  ".github/workflows/desktop-rollout.yml",
  "packages/app/.eas/workflows/release-ios-beta.yml",
  "packages/app/.eas/workflows/release-mobile.yml",
  "packages/app/.eas/workflows/resubmit-ios-review.yml",
]) {
  assert.equal(
    existsSync(new URL(`../${path}`, import.meta.url)),
    false,
    `${path} must stay disabled`,
  );
}

const dryRunReleaseWorkflows = [
  ".github/workflows/android-apk-release.yml",
  ".github/workflows/ios-unsigned-release.yml",
  ".github/workflows/npm-release.yml",
  ".github/workflows/desktop-release.yml",
];
for (const path of dryRunReleaseWorkflows) {
  const workflow = read(path);
  assert.match(workflow, /workflow_dispatch/u, path);
  assert.match(workflow, /publish:/u, path);
  assert.match(workflow, /Verify exact current-main CI SHA/u, path);
  assert.match(workflow, /persist-credentials: false/u, path);
}

const readonlyJobs = {
  ".github/workflows/android-apk-release.yml": ["dry-run"],
  ".github/workflows/ios-unsigned-release.yml": ["context", "build"],
  ".github/workflows/npm-release.yml": ["context", "package"],
  ".github/workflows/desktop-release.yml": ["publish-macos", "publish-linux", "publish-windows"],
};
for (const [path, jobNames] of Object.entries(readonlyJobs)) {
  const jobs = loadYaml(read(path)).jobs;
  for (const jobName of jobNames) {
    const job = jobs[jobName];
    assert.deepEqual(job.permissions, { contents: "read" }, `${path}:${jobName}`);
    assert.doesNotMatch(
      JSON.stringify(job),
      /\$\{\{\s*secrets\./u,
      `${path}:${jobName} must not receive secrets`,
    );
  }
}

const uploadHelper = read("scripts/upload-release-asset.sh");
assert.match(uploadHelper, /"\$#" -ne 3/u);
assert.match(
  uploadHelper,
  /git fetch origin "refs\/tags\/\$release_tag:refs\/tags\/\$release_tag" --force/u,
);
assert.ok(
  uploadHelper.indexOf("git fetch origin") < uploadHelper.indexOf("gh release view"),
  "asset helper must revalidate the remote tag before every public asset check or upload",
);

for (const path of [
  ".github/workflows/android-apk-release.yml",
  ".github/workflows/ios-unsigned-release.yml",
  ".github/workflows/npm-release.yml",
  ".github/workflows/desktop-release.yml",
  ".github/workflows/docker.yml",
]) {
  const workflow = read(path);
  const calls = workflow.split("\n").filter((line) => /upload-release-asset\.sh\s+"/u.test(line));
  assert.ok(calls.length > 0, `${path} must upload through the immutable asset helper`);
  for (const call of calls) {
    assert.match(
      call,
      /upload-release-asset\.sh\s+"[^"]+"\s+"[^"]+"\s+"[^"]+"\s*$/u,
      `${path} must pass the expected commit SHA to every public asset upload`,
    );
  }
  assert.doesNotMatch(workflow, /--clobber/u, `${path} must not overwrite release assets`);
}

for (const path of [
  "packages/app/src/agent-skills/index.tsx",
  "packages/app/src/components/welcome-screen.tsx",
  "packages/app/src/desktop/components/desktop-updates-section.tsx",
  "packages/app/src/desktop/components/integrations-section.tsx",
  "packages/app/src/desktop/components/pair-device-section.tsx",
  "packages/app/src/desktop/updates/rosetta-callout-source.tsx",
  "packages/app/src/screens/settings/metadata-generation-page.tsx",
]) {
  assert.doesNotMatch(read(path), /paseo\.sh/iu, path);
}

for (const path of ["README.md", "README.zh-CN.md", "README.ja.md", "README.ko.md"]) {
  assert.doesNotMatch(
    read(path),
    /paseo\.sh|github\.com\/getpaseo\/paseo\/releases|npm install -g @getpaseo\/cli|^paseo\s|:6767/imu,
    path,
  );
}

for (const path of ["packages/client/README.md", "packages/client/examples/README.md"]) {
  const source = read(path);
  assert.doesNotMatch(source, /npm install @getpaseo\/client|paseo\.sh/iu, path);
  assert.match(source, /not (?:a |a separately )?supported/iu, path);
}

const releasePackage = JSON.parse(read("package.json"));
assert.equal(releasePackage.scripts["release:publish"], undefined);
assert.equal(releasePackage.scripts["release:publish:beta"], undefined);
for (const name of [
  "release:beta:patch",
  "release:beta:minor",
  "release:beta:next",
  "release:promote",
  "release:patch",
  "release:minor",
]) {
  assert.doesNotMatch(releasePackage.scripts[name], /npm publish/u, name);
}
assert.match(read("scripts/set-release-version.mjs"), /--no-git-tag-version/u);
const releasePush = read("scripts/push-current-release-tag.mjs");
assert.match(releasePush, /"push", "origin", "HEAD:main"/u);
assert.match(releasePush, /"gh", \[\s*"run",\s*"list"/u);
assert.ok(
  releasePush.indexOf('"status",\n  "success"') < releasePush.indexOf('"tag", "-a"'),
  "release tag must be created only after exact-SHA CI succeeds",
);

console.log("BySpace coexistence contract OK");
