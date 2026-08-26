import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const readWorkflow = (name) => readFileSync(resolve(root, ".github", "workflows", name), "utf8");

test("CI builds Web once, embeds it in one package, and smokes that package on every OS", () => {
  const workflow = readWorkflow("ci.yml");
  assert.match(
    workflow,
    /go run github\.com\/rhysd\/actionlint\/cmd\/actionlint@v1\.7\.12 -no-color -shellcheck= -pyflakes=/,
  );
  assert.doesNotMatch(workflow, /npm run build:web/);
  assert.equal(workflow.match(/npm run pack:byspace/g)?.length, 1);
  assert.doesNotMatch(workflow, /npm run pack:byspace -- --skip-web-export/);
  assert.match(workflow, /^  package-artifact:\n    runs-on: ubuntu-latest$/m);
  assert.match(workflow, /release-artifact-manifest\.mjs create --kind web/);
  assert.match(workflow, /name: byspace-web-app/);
  assert.match(workflow, /release-artifact-manifest\.mjs create --kind npm/);
  assert.match(workflow, /name: byspace-npm-package/);
  assert.match(workflow, /^  distribution:\n    needs: package-artifact$/m);
  assert.match(workflow, /release-artifact-manifest\.mjs verify --kind npm/);
  assert.match(workflow, /^  distribution:[\s\S]*?cache: "npm"[\s\S]*?smoke:package/m);
  assert.match(workflow, /npm run smoke:package -- --skip-pack/);
});

test("npm package bundles and smoke-loads the private plugin runtime", () => {
  const packScript = readFileSync(resolve(root, "scripts", "pack-byspace.mjs"), "utf8");
  const smokeScript = readFileSync(resolve(root, "scripts", "smoke-byspace-package.mjs"), "utf8");

  assert.match(packScript, /internalWorkspaces = \[[^\]]*"plugin"/);
  assert.match(smokeScript, /require\.resolve\("@bytetrue\/byspace-plugin"\)/);
  assert.match(smokeScript, /require\.resolve\("@bytetrue\/byspace-plugin\/server"\)/);
});

test("client publisher builds every public client from one immutable exact-CI tag", () => {
  const workflow = readWorkflow("client-release.yml");
  const npmWorkflow = readWorkflow("npm-release.yml");
  const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const packagedDesktopSmoke = readFileSync(
    resolve(root, "packages", "desktop", "e2e", "packaged-app-smoke.js"),
    "utf8",
  );
  assert.match(workflow, /push:\n    tags:\n      - "v\*"/);
  assert.doesNotMatch(workflow, /workflow_dispatch|inputs\.tag/);
  assert.doesNotMatch(workflow, /checkout_ref|--clobber|eas-cli|--platform ios|\.ipa/);
  assert.equal(workflow.match(/run: npm run build:desktop:web/g)?.length, 3);
  assert.equal(workflow.match(/run: npm run build:desktop:runtime/g)?.length, 3);
  assert.equal(workflow.match(/run: npm run build:desktop:main/g)?.length, 3);
  assert.equal(rootPackage.scripts["build:desktop:runtime"], "npm run build:server:clean");
  assert.equal(
    rootPackage.scripts["build:desktop:main"],
    "npm run build:main --workspace=@bytetrue/byspace-desktop",
  );
  assert.doesNotMatch(workflow, /npm run build:web --workspace=@bytetrue\/byspace-desktop/);
  assert.doesNotMatch(workflow, /npm config set script-shell/);
  assert.match(
    npmWorkflow,
    /curl -fsSL --retry 72 --retry-all-errors --retry-delay 5 --retry-max-time 360/,
  );
  assert.doesNotMatch(workflow, /^ {6}CSC_LINK: \$\{\{ secrets\.APPLE_CERTIFICATE \}\}$/m);
  assert.match(
    workflow,
    /for name in CSC_LINK CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID/,
  );
  assert.match(packagedDesktopSmoke, /"--no-mcp"/);
  assert.doesNotMatch(packagedDesktopSmoke, /--no-inject-mcp/);
  assert.match(
    workflow,
    /gh run list .*--workflow CI --commit "\$sha" --event push --status success/,
  );
  assert.match(workflow, /needs: \[release-context, mac, linux, windows, android\]/);
  assert.match(workflow, /BYSPACE_REQUIRE_RELEASE_SIGNING=1/);
  assert.match(workflow, /ANDROID_RELEASE_KEYSTORE_BASE64/);
  assert.match(workflow, /apksigner.*verify --verbose --print-certs/);
  assert.match(workflow, /android-signing\.json/);
  assert.match(workflow, /merge-updater-manifest\.mjs/);
  assert.match(workflow, /runner: macos-14/);
  assert.match(workflow, /runner: macos-15-intel/);
  assert.match(workflow, /runner: windows-2022/);
  assert.match(workflow, /runner: windows-11-arm/);
  assert.match(workflow, /architecture: x64/);
  assert.equal(workflow.match(/working-directory: packages\/desktop/g)?.length, 3);
  assert.match(workflow, /export CSC_NAME=-/);
  assert.match(workflow, /release\/mac-arm64\/BySpace\.app/);
  assert.match(workflow, /release\/mac\/BySpace\.app/);
  assert.equal(workflow.match(/verify-desktop-package\.mjs/g)?.length, 3);
  assert.doesNotMatch(workflow, /resources\/server\/daemon-worker\.js/);
  assert.doesNotMatch(workflow, /byspace-native-keymap/);
  assert.doesNotMatch(workflow, /resources\/app\/package\.json/);
  assert.match(workflow, /win-arm64-unpacked/);
  assert.doesNotMatch(workflow, /electron-builder --win[^\n]*--x64 --arm64/);
  assert.match(workflow, /\.blockmap/);
  assert.match(workflow, /updater_channel=latest/);
  assert.match(workflow, /updater_channel=beta/);
  assert.match(workflow, /UPDATER_CHANNEL/);
  assert.match(workflow, /stamp-rollout\.mjs .*--rollout-hours 0/);
  assert.equal(workflow.match(/client-release-manifest\.mjs verify/g)?.length, 2);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /Refusing to replace existing release asset with different bytes/);
  assert.match(workflow, /Download and verify published client assets/);
  assert.equal(existsSync(resolve(root, ".github", "workflows", "desktop-release.yml")), false);
  assert.equal(existsSync(resolve(root, ".github", "workflows", "desktop-rollout.yml")), false);
  assert.equal(existsSync(resolve(root, ".github", "workflows", "android-apk-release.yml")), false);
  assert.equal(existsSync(resolve(root, "packages", "app", ".eas", "workflows")), false);
  const inactiveIosPolicy = readFileSync(
    resolve(root, "packages", "app", "release-source", "eas-workflows", "README.md"),
    "utf8",
  );
  assert.match(inactiveIosPolicy, /iOS is not built, submitted, or uploaded by active CD/);
});

test("Playwright CI keeps twelve matching isolated shards", () => {
  const workflow = readWorkflow("ci.yml");
  const jobStart = workflow.indexOf("\n  playwright:");
  const jobEnd = workflow.indexOf("\n  relay-tests:", jobStart);
  assert.notEqual(jobStart, -1);
  assert.notEqual(jobEnd, -1);
  const playwrightJob = workflow.slice(jobStart, jobEnd);
  const rows = Array.from(
    { length: 12 },
    (_, index) => `          - { label: "shard ${index + 1}/12", shard: ${index + 1} }`,
  ).join("\n");
  assert.ok(
    playwrightJob.includes(`      matrix:\n        include:\n${rows}\n    name: playwright`),
  );
  const command =
    "        run: npm run test:e2e --workspace=@bytetrue/byspace-app -- --shard=${{ matrix.shard }}/12";
  assert.deepEqual(
    playwrightJob.split("\n").filter((line) => line.includes("npm run test:e2e")),
    [command],
  );
});

test("npm publisher selects a successful push CI run and promotes its exact artifact", () => {
  const workflow = readWorkflow("npm-release.yml");
  assert.match(
    workflow,
    /gh run list .*--workflow CI --commit "\$sha" --event push --status success/,
  );
  assert.match(workflow, /run-id: \$\{\{ steps\.release_input\.outputs\.ci_run_id \}\}/);
  assert.equal(workflow.match(/release-artifact-manifest\.mjs verify --kind npm/g)?.length, 2);
  assert.match(workflow, /npm run release:publish/);
  assert.doesNotMatch(workflow, /npm run release:check/);
  assert.doesNotMatch(workflow, /run: npm ci/);
});

test("App deploy selects the same CI Web artifact and preserves channel inputs", () => {
  const workflow = readWorkflow("deploy-app.yml");
  assert.match(
    workflow,
    /gh run list .*--workflow CI --commit "\$EXPECTED_SHA" --event push --status success/,
  );
  assert.match(workflow, /run-id: \$\{\{ steps\.release_input\.outputs\.ci_run_id \}\}/);
  assert.match(workflow, /name: byspace-web-app/);
  assert.match(workflow, /release-artifact-manifest\.mjs verify --kind web/);
  assert.match(workflow, /node scripts\/npm-retry\.mjs ci/);
  assert.match(workflow, /cd packages\/app && npx wrangler pages deploy dist/);
  assert.match(workflow, /--project-name "\$PAGES_PROJECT"/);
  assert.match(workflow, /--commit-hash "\$EXPECTED_SHA"/);
  assert.doesNotMatch(workflow, /expo export/);
  assert.doesNotMatch(workflow, /build:app-deps/);
});

test("Desktop clean app dependency builds leave every workspace dependency consumable", () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const cleanBuild = packageJson.scripts["build:app-deps:clean"];

  assert.match(cleanBuild, /npm run build:client:clean/);
  assert.match(cleanBuild, /npm run build --workspace=@bytetrue\/byspace-expo-two-way-audio/);
  assert.doesNotMatch(
    cleanBuild,
    /npm run clean --workspace=@bytetrue\/byspace-expo-two-way-audio/,
  );
  assert.match(packageJson.scripts["build:desktop"], /^npm run build:app-deps:clean/);
  assert.equal(
    packageJson.scripts["build:desktop:web"],
    "cd packages/app && cross-env BYSPACE_WEB_PLATFORM=electron npx expo export --platform web",
  );
  assert.match(packageJson.scripts["build:desktop"], /npm run build:desktop:web/);
});
