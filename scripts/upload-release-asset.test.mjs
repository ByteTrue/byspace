import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.join(import.meta.dirname, "upload-release-asset.sh");

function fixture(remoteSha) {
  const root = mkdtempSync(path.join(tmpdir(), "byspace-upload-asset-test-"));
  const git = path.join(root, "git");
  const gh = path.join(root, "gh");
  const log = path.join(root, "gh.log");
  const asset = path.join(root, "asset.tgz");

  writeFileSync(
    git,
    `#!/usr/bin/env bash\nif [[ "$1" == "fetch" ]]; then exit 0; fi\nif [[ "$1" == "rev-list" ]]; then printf '%s\\n' "${remoteSha}"; exit 0; fi\nexit 2\n`,
  );
  writeFileSync(
    gh,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$GH_LOG"\nif [[ "$1 $2" == "release view" ]]; then exit 0; fi\nif [[ "$1 $2" == "release upload" ]]; then exit 0; fi\nexit 2\n`,
  );
  chmodSync(git, 0o755);
  chmodSync(gh, 0o755);
  writeFileSync(asset, "release bytes");
  return { root, log, asset };
}

function run(state, expectedSha) {
  return spawnSync("bash", [script, "v1.2.3", state.asset, expectedSha], {
    encoding: "utf8",
    env: {
      ...process.env,
      GH_LOG: state.log,
      GITHUB_REPOSITORY: "ByteTrue/byspace",
      PATH: `${state.root}:${process.env.PATH}`,
    },
  });
}

test("rejects a moved remote tag before querying or uploading release assets", () => {
  const state = fixture("badbad");
  const result = run(state, "expected");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /remote tag v1\.2\.3 points to badbad, expected expected/);
  assert.throws(() => readFileSync(state.log, "utf8"));
});

test("uploads only after the remote tag matches the expected commit", () => {
  const state = fixture("expected");
  const result = run(state, "expected");
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(state.log, "utf8"), /release upload v1\.2\.3 .*asset\.tgz/);
});
