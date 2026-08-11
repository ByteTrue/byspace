import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const readWorkflow = (name) => readFileSync(resolve(root, ".github", "workflows", name), "utf8");

test("CI builds Web once, embeds it in one package, and smokes that package on every OS", () => {
  const workflow = readWorkflow("ci.yml");
  assert.equal(workflow.match(/npm run build:web/g)?.length, 1);
  assert.match(workflow, /^  package-artifact:\n    needs: app-tests$/m);
  assert.match(workflow, /name: byspace-web-app/);
  assert.match(workflow, /release-artifact-manifest\.mjs verify --kind web/);
  assert.match(workflow, /npm run pack:byspace -- --skip-web-export/);
  assert.match(workflow, /name: byspace-npm-package/);
  assert.match(workflow, /release-artifact-manifest\.mjs create --kind npm/);
  assert.match(workflow, /^  distribution:\n    needs: package-artifact$/m);
  assert.match(workflow, /release-artifact-manifest\.mjs verify --kind npm/);
  assert.match(workflow, /npm run smoke:package -- --skip-pack/);
});

test("Playwright CI keeps eight matching isolated shards", () => {
  const workflow = readWorkflow("ci.yml");
  const rows = Array.from(
    { length: 8 },
    (_, index) => `          - { label: "shard ${index + 1}/8", shard: ${index + 1} }`,
  ).join("\n");
  assert.ok(workflow.includes(`      matrix:\n        include:\n${rows}\n    name: playwright`));
  assert.equal(workflow.match(/--shard=/g)?.length, 1);
  assert.match(
    workflow,
    /run: npm run test:e2e --workspace=@bytetrue\/byspace-app -- --shard=\$\{\{ matrix\.shard \}\}\/8/,
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
