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
const bareByspaceHome = await mkdtemp(join(tmpdir(), "byspace-onboard-bare-home-"));
const noRelayByspaceHome = await mkdtemp(join(tmpdir(), "byspace-onboard-no-relay-home-"));
const port = await getAvailablePort();
const barePort = await getAvailablePort();
const noRelayPort = await getAvailablePort();
const relayEndpoint = "127.0.0.1:9";
const hostedRelease = resolveBySpaceHostedRelease(resolveCliVersion());

try {
  console.log("Test 1: `byspace onboard --relay` prints pairing info");
  const onboard =
    await $`BYSPACE_HOME=${byspaceHome} BYSPACE_LISTEN=127.0.0.1:${port} BYSPACE_PAIRING_QR=0 BYSPACE_RELAY_ENDPOINT=${relayEndpoint} BYSPACE_RELAY_PUBLIC_ENDPOINT=${relayEndpoint} BYSPACE_RELAY_USE_TLS=false BYSPACE_RELAY_PUBLIC_USE_TLS=false npx byspace onboard --relay`.nothrow();

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
    relayEndpoint,
    "pairing offer should use the local test relay",
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

  console.log("Test 2: non-interactive onboarding does not preconfigure a dictation model");
  const configRaw = await readFile(join(byspaceHome, "config.json"), "utf-8");
  const config = JSON.parse(configRaw) as {
    app?: { baseUrl?: string };
    features?: {
      dictation?: { stt?: { model?: string | null } };
    };
  };

  assert.strictEqual(
    config.app?.baseUrl,
    hostedRelease.appBaseUrl,
    "persisted config should use the current CLI release app",
  );
  assert.strictEqual(
    config.features?.dictation?.stt?.model,
    undefined,
    "onboarding should not select a dictation model",
  );
  const daemonLog = await readFile(join(byspaceHome, "daemon.log"), "utf-8");
  assert(
    !daemonLog.includes("Ensuring local speech models"),
    "daemon should not attempt local speech model setup during onboarding",
  );
  console.log("✓ non-interactive run left dictation model selection empty\n");

  console.log("Test 3: bare non-interactive onboarding keeps relay opt-in");
  const bareOnboard =
    await $`BYSPACE_HOME=${bareByspaceHome} BYSPACE_LISTEN=127.0.0.1:${barePort} BYSPACE_PAIRING_QR=0 BYSPACE_RELAY_ENDPOINT=${relayEndpoint} BYSPACE_RELAY_PUBLIC_ENDPOINT=${relayEndpoint} BYSPACE_RELAY_USE_TLS=false BYSPACE_RELAY_PUBLIC_USE_TLS=false npx byspace`.nothrow();

  assert.strictEqual(
    bareOnboard.exitCode,
    0,
    `bare onboarding should succeed:\nstdout:\n${bareOnboard.stdout}\nstderr:\n${bareOnboard.stderr}`,
  );
  assert(
    !bareOnboard.stdout.includes("#offer="),
    "bare onboarding should not print a pairing offer",
  );
  assert(
    bareOnboard.stdout.includes("Daemon is running with relay off."),
    "bare onboarding should explain that relay remains off",
  );
  assert(
    bareOnboard.stdout.includes("connect another device directly"),
    "bare onboarding should print direct connection guidance",
  );
  console.log("✓ bare non-interactive onboarding keeps relay opt-in\n");

  console.log("Test 4: `byspace onboard --no-relay` suppresses pairing");
  const noRelayOnboard =
    await $`BYSPACE_HOME=${noRelayByspaceHome} BYSPACE_LISTEN=127.0.0.1:${noRelayPort} BYSPACE_PAIRING_QR=0 BYSPACE_RELAY_ENDPOINT=${relayEndpoint} BYSPACE_RELAY_PUBLIC_ENDPOINT=${relayEndpoint} BYSPACE_RELAY_USE_TLS=false BYSPACE_RELAY_PUBLIC_USE_TLS=false npx byspace onboard --no-relay`.nothrow();

  assert.strictEqual(
    noRelayOnboard.exitCode,
    0,
    `--no-relay onboarding should succeed:\nstdout:\n${noRelayOnboard.stdout}\nstderr:\n${noRelayOnboard.stderr}`,
  );
  assert(
    !noRelayOnboard.stdout.includes("#offer="),
    "--no-relay onboarding should not print a pairing offer",
  );
  assert(
    noRelayOnboard.stdout.includes("Relay pairing skipped because --no-relay was provided."),
    "--no-relay onboarding should explain why pairing was skipped",
  );
  console.log("✓ --no-relay onboarding suppresses pairing\n");
} finally {
  await Promise.all([
    $`BYSPACE_HOME=${byspaceHome} npx byspace daemon stop --home ${byspaceHome} --force`.nothrow(),
    $`BYSPACE_HOME=${bareByspaceHome} npx byspace daemon stop --home ${bareByspaceHome} --force`.nothrow(),
    $`BYSPACE_HOME=${noRelayByspaceHome} npx byspace daemon stop --home ${noRelayByspaceHome} --force`.nothrow(),
  ]);
  await Promise.all([
    rm(byspaceHome, { recursive: true, force: true }),
    rm(bareByspaceHome, { recursive: true, force: true }),
    rm(noRelayByspaceHome, { recursive: true, force: true }),
  ]);
}

console.log("=== Onboarding tests passed ===");
