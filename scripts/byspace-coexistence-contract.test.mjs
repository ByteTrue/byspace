import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const collisionCriticalPaths = [
  "packages/server/src/server/paseo-home.ts",
  "packages/server/src/server/config.ts",
  "packages/server/src/server/persisted-config.ts",
  "packages/server/src/server/pid-lock.ts",
  "packages/cli/src/commands/daemon/local-daemon.ts",
  "packages/cli/src/commands/daemon/start.ts",
  "packages/cli/src/utils/client.ts",
  "packages/cli/src/utils/client-id.ts",
  "packages/cli/src/utils/command-options.ts",
  "packages/protocol/src/daemon-endpoints.ts",
  "packages/desktop/src/daemon/daemon-manager.ts",
];

for (const path of collisionCriticalPaths) {
  const source = read(path);
  assert.doesNotMatch(
    source,
    /6767|6768|PASEO_HOME|PASEO_LISTEN|paseo\.pid|\.paseo\/daemon/iu,
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

const appConfig = read("packages/app/app.config.js");
assert.match(appConfig, /packageId: "com\.bytetrue\.byspace"/u);
assert.match(appConfig, /packageId: "com\.bytetrue\.byspace\.debug"/u);
assert.match(appConfig, /scheme: "byspace"/u);

const desktopConfig = read("packages/desktop/electron-builder.yml");
assert.match(desktopConfig, /appId: com\.bytetrue\.byspace\.desktop/u);
assert.match(desktopConfig, /productName: BySpace/u);
assert.doesNotMatch(desktopConfig, /paseo:\/\//iu);

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
assert.match(dockerWorkflow, /if \[\[ "\$\{publish\}" == "true" \]\]; then/u);
assert.match(dockerWorkflow, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/u);

const dryRunReleaseWorkflows = [
  ".github/workflows/android-apk-release.yml",
  ".github/workflows/ios-unsigned-release.yml",
  ".github/workflows/npm-release.yml",
];
for (const path of dryRunReleaseWorkflows) {
  const workflow = read(path);
  assert.match(workflow, /workflow_dispatch/u, path);
  assert.match(workflow, /publish:/u, path);
  assert.match(workflow, /Verify exact current-main CI SHA/u, path);
  assert.match(workflow, /SHOULD_PUBLISH|outputs\.publish/u, path);
}

console.log("BySpace coexistence contract OK");
