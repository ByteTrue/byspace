import assert from "node:assert/strict";
import test from "node:test";

import { goSurface, nodeSurface, surfaceGaps } from "./cli-surface.mjs";

// The port is a rewrite of the node CLI, not a redesign: every command and subcommand that existed
// has to still exist. Four of them silently went missing in the port, and nothing caught it until
// someone typed `byspace daemon reload` and got "unknown command".
test("offers every top-level command the node CLI accepted", () => {
  const gaps = surfaceGaps();
  assert.deepEqual(gaps.missingTopLevel, [], "top-level commands disappeared in the port");
});

test("offers every subcommand the node CLI accepted", () => {
  const gaps = surfaceGaps();
  const rows = Object.entries(gaps.missingSubcommands).map(
    ([group, names]) => `${group}: ${names.join(", ")}`,
  );
  assert.deepEqual(rows, [], `subcommands disappeared in the port:\n${rows.join("\n")}`);
});

// Guards the extractors themselves: a regex that silently matches nothing would make both tests
// above pass on an empty surface, which is how the first audit produced a false "all clear".
test("the extractors actually find commands", () => {
  const node = nodeSurface();
  const go = goSurface();
  assert.ok(node.topLevel.length >= 10, `node top-level surface looks empty: ${node.topLevel}`);
  assert.ok(
    node.groups.daemon?.length >= 8,
    `node daemon group looks empty: ${node.groups.daemon}`,
  );
  assert.ok(go.topLevel.length >= 10, `go top-level surface looks empty: ${go.topLevel}`);
  assert.ok(go.groups.agent?.length >= 15, `go agent group looks empty: ${go.groups.agent}`);
});
