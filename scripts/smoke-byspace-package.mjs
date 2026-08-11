import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const artifact = join(root, "artifacts", `bytetrue-byspace-${version}.tgz`);
const installRoot = mkdtempSync(join(tmpdir(), "byspace-install-smoke-"));
const npmCli = process.env.npm_execpath;
const skipPack = process.argv.includes("--skip-pack");
const globalPackageRoot = join(
  installRoot,
  process.platform === "win32" ? "node_modules" : join("lib", "node_modules"),
);
const globalBinRoot = process.platform === "win32" ? installRoot : join(installRoot, "bin");
const installedPackageRoot = join(globalPackageRoot, "@bytetrue", "byspace");
const installedPackageBin = join(installedPackageRoot, "bin", "byspace");
const installedBinary = join(
  globalBinRoot,
  process.platform === "win32" ? "byspace.cmd" : "byspace",
);
const installedServerExportsUrl = pathToFileURL(
  join(
    installedPackageRoot,
    "node_modules",
    "@bytetrue",
    "byspace-server",
    "dist",
    "server",
    "server",
    "exports.js",
  ),
).href;
const nativeLoadCheck = `
  import { createRequire } from "node:module";
  import { pathToFileURL } from "node:url";
  const require = createRequire(${JSON.stringify(
    join(
      installedPackageRoot,
      "node_modules",
      "@bytetrue",
      "byspace-server",
      "dist",
      "server",
      "server",
      "bootstrap.js",
    ),
  )});
  const pty = require("node-pty");
  const sherpa = require("sherpa-onnx-node");
  const mcpCompatModules = [
    "@modelcontextprotocol/sdk/server/zod-compat.js",
    "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js",
  ];
  await Promise.all(mcpCompatModules.map((specifier) => import(pathToFileURL(require.resolve(specifier)))));
  if (typeof pty.spawn !== "function" || typeof sherpa.OfflineRecognizer !== "function") {
    throw new Error("Installed native modules did not expose their runtime APIs");
  }
`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    ...options,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    const detail = result.error ? `: ${result.error.message}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}${detail}`);
  }
  return result.stdout ?? "";
}

function runNpm(args, options = {}) {
  return npmCli
    ? run(process.execPath, [npmCli, ...args], options)
    : run("npm", args, { ...options, shell: process.platform === "win32" });
}

function runNpmResult(args, options = {}) {
  return npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], {
        cwd: root,
        encoding: "utf8",
        timeout: 120_000,
        ...options,
      })
    : spawnSync("npm", args, {
        cwd: root,
        encoding: "utf8",
        timeout: 120_000,
        ...options,
        shell: process.platform === "win32",
      });
}

function runBinary(args, options = {}) {
  return run(installedBinary, args, {
    ...options,
    shell: process.platform === "win32",
  });
}

function spawnBinary(args, options = {}) {
  return spawnSync(installedBinary, args, {
    ...options,
    shell: process.platform === "win32",
  });
}

function removeInstallRoot() {
  try {
    rmSync(installRoot, { recursive: true, force: true, maxRetries: 30, retryDelay: 1_000 });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (process.platform === "win32" && ["EBUSY", "EPERM", "ENOTEMPTY"].includes(String(code))) {
      console.warn(`Windows kept the stopped smoke-test directory locked: ${installRoot}`);
      return;
    }
    throw error;
  }
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to reserve a TCP port");
  await new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolveClose();
    });
  });
  return address.port;
}

function probeDaemonWebSocket(port) {
  return new Promise((resolveProbe, rejectProbe) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let settled = false;
    const timeout = setTimeout(
      () => finish(new Error("WebSocket did not return server_info within 1.5 seconds")),
      1_500,
    );

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // The probe is already settled; transport cleanup is best-effort.
      }
      if (error) rejectProbe(error);
      else resolveProbe();
    }

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "hello",
          clientId: `package-smoke-${process.pid}`,
          clientType: "cli",
          protocolVersion: 1,
          appVersion: version,
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data);
        if (
          message.type === "session" &&
          message.message?.type === "status" &&
          message.message.payload?.status === "server_info" &&
          typeof message.message.payload.serverId === "string" &&
          message.message.payload.serverId.length > 0
        ) {
          finish();
        }
      } catch {
        // Ignore unrelated messages until the bounded probe expires.
      }
    });
    socket.addEventListener("error", () => finish(new Error("WebSocket transport failed")));
    socket.addEventListener("close", () =>
      finish(new Error("WebSocket closed before server_info")),
    );
  });
}

async function waitForDaemon(env, port) {
  const deadline = Date.now() + 20_000;
  const url = `http://127.0.0.1:${port}/`;
  let lastFailure = "Daemon probes did not run";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      const body = await response.text();
      if (response.ok && body.includes("__BYSPACE_INITIAL_DAEMON_CONNECTION__")) {
        await probeDaemonWebSocket(port);
        return;
      }
      lastFailure = `HTTP ${response.status}; embedded Web UI marker: ${body.includes("__BYSPACE_INITIAL_DAEMON_CONNECTION__")}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
  }
  const daemonLogPath = join(env.BYSPACE_HOME, "daemon.log");
  const daemonLog = existsSync(daemonLogPath)
    ? readFileSync(daemonLogPath, "utf8").slice(-20_000)
    : "<daemon.log was not created>";
  throw new Error(
    `Packaged daemon did not become ready within 20 seconds\nLast probe: ${lastFailure}\nDaemon log:\n${daemonLog}`,
  );
}

let daemonStarted = false;
let env;
let failure;
let cleanupFailure;
try {
  if (!skipPack) runNpm(["run", "pack:byspace"], { timeout: 600_000 });
  if (!existsSync(artifact)) throw new Error(`Package artifact not found at ${artifact}`);
  const port = await reservePort();
  const home = join(installRoot, "home");
  env = {
    ...process.env,
    BYSPACE_HOME: home,
    BYSPACE_LISTEN: `127.0.0.1:${port}`,
    BYSPACE_RELAY_ENABLED: undefined,
    BYSPACE_RELAY_ENDPOINT: undefined,
    BYSPACE_RELAY_PUBLIC_ENDPOINT: undefined,
    BYSPACE_RELAY_USE_TLS: undefined,
    BYSPACE_RELAY_PUBLIC_USE_TLS: undefined,
    BYSPACE_APP_BASE_URL: undefined,
    BYSPACE_CORS_ORIGINS: undefined,
  };

  runNpm(["install", "--global", "--prefix", installRoot, "--no-audit", "--no-fund", artifact], {
    timeout: 600_000,
  });
  if (!existsSync(installedPackageBin) || !existsSync(installedBinary)) {
    throw new Error(`Global install did not create ${installedBinary}`);
  }
  const installedSkillsRoot = join(
    installedPackageRoot,
    "node_modules",
    "@bytetrue",
    "byspace-server",
    "dist",
    "skills",
  );
  const expectedBundledSkills = [
    "byspace",
    "byspace-advisor",
    "byspace-committee",
    "byspace-handoff",
    "byspace-loop",
    "byspace-project-setup",
  ];
  const installedBundledSkills = readdirSync(installedSkillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(installedBundledSkills) !== JSON.stringify(expectedBundledSkills)) {
    throw new Error(
      `Global install bundled unexpected orchestration skills: ${installedBundledSkills.join(", ")}`,
    );
  }
  for (const skillName of expectedBundledSkills) {
    if (!existsSync(join(installedSkillsRoot, skillName, "SKILL.md"))) {
      throw new Error(`Global install is missing bundled orchestration skill: ${skillName}`);
    }
  }
  const forbiddenSkillDirectories = new Set([
    ".git",
    ".pi-subagents",
    ".venv",
    "evals",
    "node_modules",
    "target",
  ]);
  const pendingSkillDirectories = [installedSkillsRoot];
  while (pendingSkillDirectories.length > 0) {
    const directory = pendingSkillDirectories.pop();
    if (!directory) break;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (forbiddenSkillDirectories.has(entry.name)) {
        throw new Error(`Global install packaged development skill directory: ${entry.name}`);
      }
      pendingSkillDirectories.push(join(directory, entry.name));
    }
  }
  if (existsSync(join(installedSkillsRoot, "byspace-project-setup-workspace"))) {
    throw new Error("Global install packaged sibling skill evaluation workspace");
  }
  const dependencyTree = runNpmResult(
    ["ls", "--global", "--prefix", installRoot, "--all", "--json"],
    { timeout: 120_000 },
  );
  if (dependencyTree.status !== 0) {
    process.stderr.write(dependencyTree.stdout ?? "");
    process.stderr.write(dependencyTree.stderr ?? "");
    throw new Error("Global install has missing or invalid dependencies");
  }
  run(process.execPath, ["--input-type=module", "--eval", nativeLoadCheck], { env });
  const installedManifest = JSON.parse(
    readFileSync(join(installedPackageRoot, "package.json"), "utf8"),
  );
  if (installedManifest.repository?.url !== "git+https://github.com/ByteTrue/byspace.git") {
    throw new Error(
      `Installed package has invalid repository metadata: ${JSON.stringify(installedManifest.repository)}`,
    );
  }
  const installedVersion = runBinary(["--version"], { env }).trim();
  if (installedVersion !== version) {
    throw new Error(`Installed version ${installedVersion} does not match ${version}`);
  }
  if (!runBinary(["--help"], { env }).includes("Usage: byspace")) {
    throw new Error("Installed CLI help did not render");
  }

  const expectedHostedRelease = version.includes("-")
    ? {
        appBaseUrl: "https://app-beta.byspace.zijieapi.de5.net",
        relayEndpoint: "relay-beta.byspace.zijieapi.de5.net:443",
      }
    : {
        appBaseUrl: "https://app.byspace.zijieapi.de5.net",
        relayEndpoint: "relay.byspace.zijieapi.de5.net:443",
      };
  const pairingProbeScript = `
    const { generateLocalPairingOffer, loadConfig, parseConnectionOfferFromUrl } =
      await import(${JSON.stringify(installedServerExportsUrl)});
    const config = loadConfig(${JSON.stringify(home)});
    const pairing = await generateLocalPairingOffer({
      byspaceHome: config.byspaceHome,
      releaseVersion: config.daemonVersion,
      relayEnabled: true,
      relayEndpoint: config.relayEndpoint,
      relayPublicEndpoint: config.relayPublicEndpoint,
      relayUseTls: config.relayUseTls,
      relayPublicUseTls: config.relayPublicUseTls,
      appBaseUrl: config.appBaseUrl,
      includeQr: false,
    });
    const pairingUrl = pairing.url ? new URL(pairing.url) : null;
    const offer = pairing.url ? parseConnectionOfferFromUrl(pairing.url) : null;
    if (!pairingUrl || !offer) {
      throw new Error("Installed server did not generate a relay opt-in offer");
    }
    process.stdout.write(JSON.stringify({
      appBaseUrl: (pairingUrl.origin + pairingUrl.pathname).replace(/\\/$/, ""),
      relayEndpoint: offer.relay.endpoint,
      relayUseTls: offer.relay.useTls,
      relayEnabled: pairing.relayEnabled,
    }));
  `;
  const pairingProbe = JSON.parse(
    run(process.execPath, ["--input-type=module", "--eval", pairingProbeScript], { env }),
  );
  if (
    pairingProbe.appBaseUrl !== expectedHostedRelease.appBaseUrl ||
    pairingProbe.relayEndpoint !== expectedHostedRelease.relayEndpoint ||
    pairingProbe.relayUseTls !== true ||
    pairingProbe.relayEnabled !== true
  ) {
    throw new Error(
      `Installed server resolved unexpected hosted defaults: ${JSON.stringify(pairingProbe)}`,
    );
  }

  runBinary(["daemon", "start"], { env });
  daemonStarted = true;
  await waitForDaemon(env, port);
  const daemonPid = JSON.parse(readFileSync(join(home, "byspace.pid"), "utf8"));
  if (
    !Number.isInteger(daemonPid.pid) ||
    daemonPid.pid <= 0 ||
    daemonPid.listen !== `127.0.0.1:${port}`
  ) {
    throw new Error(`Daemon used unexpected runtime metadata: ${JSON.stringify(daemonPid)}`);
  }
  try {
    process.kill(daemonPid.pid, 0);
  } catch (error) {
    throw new Error(`Daemon PID ${daemonPid.pid} is not alive`, { cause: error });
  }
  const defaultPersistedConfig = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  if (
    defaultPersistedConfig.daemon?.relay?.enabled !== false ||
    defaultPersistedConfig.app?.baseUrl !== expectedHostedRelease.appBaseUrl ||
    !defaultPersistedConfig.daemon?.cors?.allowedOrigins?.includes(expectedHostedRelease.appBaseUrl)
  ) {
    throw new Error(
      `Daemon persisted unexpected release defaults: ${JSON.stringify(defaultPersistedConfig)}`,
    );
  }
  process.stdout.write(`BySpace ${version} package smoke passed on port ${port}.\n`);
} catch (error) {
  failure = error;
} finally {
  if (daemonStarted && env && existsSync(installedPackageBin)) {
    const stop = spawnBinary(
      ["daemon", "stop", "--force", "--timeout", "5", "--kill-timeout", "5"],
      {
        env,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    if (stop.status !== 0) {
      process.stderr.write(stop.stdout ?? "");
      process.stderr.write(stop.stderr ?? "");
      cleanupFailure = new Error(
        "Packaged daemon cleanup failed; installation prefix was preserved",
      );
    }
  }
  if (!cleanupFailure) {
    removeInstallRoot();
  }
}

if (cleanupFailure) throw cleanupFailure;
if (failure) throw failure;
