import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const readWorkflow = (name) => readFileSync(resolve(root, ".github", "workflows", name), "utf8");

test("CI builds Web once, embeds it in one package, and smokes that package on every OS", () => {
  const workflow = readWorkflow("ci.yml");
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

test("Android artifact workflow uses existing release helpers and self-contained metadata", () => {
  const workflow = readWorkflow("android-apk-release.yml");
  assert.match(workflow, /emit-release-env\.mjs --source-tag/);
  assert.match(workflow, /sha256sum/);
  assert.doesNotMatch(workflow, /validate-release-tag\.mjs|android-release-metadata\.mjs/);
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
});
