#!/usr/bin/env npx tsx

import assert from "node:assert";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "zx";
import { getAvailablePort } from "./helpers/network.ts";
import { parseConnectionOfferFromUrl } from "@bytetrue/byspace-protocol/connection-offer";
import { resolveBySpaceHostedRelease } from "@bytetrue/byspace-protocol/release-channel";
import { resolveCliVersion } from "../src/version.js";

$.verbose = false;

console.log("=== Onboarding Command ===\n");

const byspaceHome = await mkdtemp(join(tmpdir(), "byspace-onboard-home-"));
const port = await getAvailablePort();
const hostedRelease = resolveBySpaceHostedRelease(resolveCliVersion());

try {
  console.log("Test 1: `byspace` runs blocking onboarding and prints pairing info");
  const onboard =
    await $`BYSPACE_HOME=${byspaceHome} BYSPACE_LISTEN=127.0.0.1:${port} BYSPACE_PAIRING_QR=0 npx byspace`.nothrow();

  assert.strictEqual(
    onboard.exitCode,
    0,
    `onboard should succeed:\nstdout:\n${onboard.stdout}\nstderr:\n${onboard.stderr}`,
  );
  assert(onboard.stdout.includes("Scan to pair"), "onboard output should include scan header");
  assert(
    onboard.stdout.includes("Pairing link"),
    "onboard output should include pairing link header",
  );
  assert(onboard.stdout.includes("#offer="), "onboard output should include pairing offer URL");
  assert(
    onboard.stdout.includes(`${hostedRelease.appBaseUrl}/#offer=`),
    "pairing link should use the current CLI release app",
  );
  const outputLines = onboard.stdout.split("\n");
  const pairingLineIndex = outputLines.findIndex((line) =>
    line.includes(`${hostedRelease.appBaseUrl}/#offer=`),
  );
  assert.notStrictEqual(pairingLineIndex, -1, "onboard output should contain a pairing URL");
  let pairingUrl = outputLines[pairingLineIndex]
    .slice(outputLines[pairingLineIndex].indexOf("https://"))
    .replace(/\s+│\s*$/, "");
  for (const line of outputLines.slice(pairingLineIndex + 1)) {
    const fragment = line
      .replace(/^\s*│\s*/, "")
      .replace(/\s*│\s*$/, "")
      .trim();
    if (!/^[A-Za-z0-9_-]+$/.test(fragment)) break;
    pairingUrl += fragment;
  }
  assert.strictEqual(
    parseConnectionOfferFromUrl(pairingUrl)?.relay.endpoint,
    hostedRelease.relayEndpoint,
    "pairing offer should use the current CLI release relay",
  );
  assert(
    onboard.stdout.includes("CLI quick reference"),
    "onboard output should include CLI quick reference",
  );
  assert(
    onboard.stdout.includes("byspace --help"),
    "onboard output should include --help shortcut",
  );
  assert(onboard.stdout.includes("byspace ls"), "onboard output should include ls shortcut");
  assert(
    onboard.stdout.includes('byspace run "your prompt"'),
    "onboard output should include run shortcut",
  );
  assert(
    onboard.stdout.includes("byspace status"),
    "onboard output should include status shortcut",
  );
  assert(
    onboard.stdout.includes(join(byspaceHome, "daemon.log")),
    "onboard output should include daemon log path",
  );

  const status =
    await $`BYSPACE_HOME=${byspaceHome} npx byspace daemon status --home ${byspaceHome}`.nothrow();
  assert.strictEqual(status.exitCode, 0, `daemon status should succeed: ${status.stderr}`);
  assert(status.stdout.includes("running"), "daemon should be running when onboarding exits");
  console.log("✓ onboarding prints pairing info and waits for daemon readiness\n");

  console.log("Test 2: non-interactive onboarding persists voice disabled config");
  const configRaw = await readFile(join(byspaceHome, "config.json"), "utf-8");
  const config = JSON.parse(configRaw) as {
    app?: { baseUrl?: string };
    features?: {
      dictation?: { enabled?: boolean };
      voiceMode?: { enabled?: boolean };
    };
  };

  assert.strictEqual(
    config.app?.baseUrl,
    hostedRelease.appBaseUrl,
    "persisted config should use the current CLI release app",
  );
  assert.strictEqual(
    config.features?.dictation?.enabled,
    false,
    "dictation.enabled should be false",
  );
  assert.strictEqual(
    config.features?.voiceMode?.enabled,
    false,
    "voiceMode.enabled should be false",
  );
  const daemonLog = await readFile(join(byspaceHome, "daemon.log"), "utf-8");
  assert(
    !daemonLog.includes("Ensuring local speech models"),
    "daemon should not attempt local speech model setup when voice is disabled",
  );
  console.log("✓ non-interactive run persisted voice disabled choices\n");
} finally {
  await $`BYSPACE_HOME=${byspaceHome} npx byspace daemon stop --home ${byspaceHome} --force`.nothrow();
  await rm(byspaceHome, { recursive: true, force: true });
}

console.log("=== Onboarding tests passed ===");
