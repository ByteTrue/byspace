import { expect, test } from "@playwright/test";
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(__dirname, "../../../..");
const projectName = basename(repositoryRoot);

let daemon: ChildProcess;
let daemonBinary: string;
let executablePath: string;
let home: string;
let listenPort: number;
let rootURL: string;
let output = "";
let temporaryRoot: string;

test.beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "byspace-browser-e2e-"));
  home = join(temporaryRoot, "home");
  executablePath = join(temporaryRoot, "bin");
  daemonBinary = join(temporaryRoot, process.platform === "win32" ? "byspace.exe" : "byspace");
  await mkdir(home, { recursive: true });
  await mkdir(executablePath, { recursive: true });
  execFileSync("go", ["build", "-o", daemonBinary, "./cmd/byspace"], {
    cwd: join(repositoryRoot, "go"),
    stdio: "inherit",
  });
  const fakePi = join(executablePath, process.platform === "win32" ? "pi.cmd" : "pi");
  if (process.platform === "win32") {
    throw new Error("Go daemon browser tracer currently requires a POSIX test host");
  }
  await writeFile(
    fakePi,
    await readFile(join(repositoryRoot, "fixtures", "pi", "fake-rpc.mjs"), "utf8"),
    "utf8",
  );
  await chmod(fakePi, 0o755);

  listenPort = await availablePort();
  rootURL = `http://localhost:${listenPort}`;
  await startDaemon();
});

test.afterAll(async () => {
  if (daemon?.exitCode === null) {
    await stopDaemon();
  }
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("serves the copied Web app and completes, follows, and resumes a Pi turn", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const fallback = await page.request.get(`${rootURL}/deep/spa/route`);
  expect(fallback.status()).toBe(200);
  expect(await fallback.text()).toContain("__PASEO_INITIAL_DAEMON_CONNECTION__");

  await page.goto(rootURL);
  await expect(page.getByText(projectName, { exact: true }).last()).toBeVisible();
  await page.getByText(projectName, { exact: true }).last().click();

  const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
  await expect(composer).toBeEditable();
  await page.getByText("Select model", { exact: true }).click();
  await page.getByText("Default", { exact: true }).last().click();
  await composer.fill("browser tracer");
  await composer.press("Enter");

  await expect(
    page.getByTestId("user-message").getByText("browser tracer", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("from fake pi", { exact: true })).toBeVisible();
  await expect(page.getByText("Couldn't refresh agent history.", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);

  await page.reload();
  await expect(
    page.getByTestId("user-message").getByText("browser tracer", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("from fake pi", { exact: true })).toBeVisible();

  let listed: { entries?: Array<{ agent?: { id?: string; status?: string } }> } = {};
  await expect
    .poll(async () => {
      const { stdout } = await execFileAsync(daemonBinary, [
        "agent",
        "list",
        "--home",
        home,
        "--json",
      ]);
      listed = JSON.parse(stdout) as typeof listed;
      return listed.entries?.[0]?.agent?.status;
    })
    .toBe("idle");
  const agentId = listed.entries?.[0]?.agent?.id;
  expect(agentId).toBeTruthy();

  await stopDaemon();
  await startDaemon();
  await page.reload();
  await expect(
    page.getByTestId("user-message").getByText("browser tracer", { exact: true }),
  ).toBeVisible();

  let followed = "";
  const follow = spawn(
    daemonBinary,
    ["agent", "timeline", "--home", home, "--follow", "--json", agentId!],
    { cwd: repositoryRoot, env: daemonEnvironment(), stdio: ["ignore", "pipe", "pipe"] },
  );
  follow.stdout?.on("data", (chunk) => {
    followed += String(chunk);
  });
  follow.stderr?.on("data", (chunk) => {
    followed += String(chunk);
  });
  try {
    await expect.poll(() => followed, { timeout: 10_000 }).toContain("browser tracer");

    const resumedComposer = page.getByRole("textbox").last();
    await expect(resumedComposer).toBeEditable();
    await resumedComposer.fill("browser tracer after restart");
    await resumedComposer.press("Enter");
    await expect(
      page
        .getByTestId("user-message")
        .getByText("browser tracer after restart", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("from fake pi", { exact: true })).toHaveCount(2);
    await expect.poll(() => followed, { timeout: 10_000 }).toContain("browser tracer after restart");
  } finally {
    if (follow.exitCode === null) follow.kill("SIGINT");
    await waitForExit(follow).catch(() => undefined);
  }
});

async function availablePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("could not allocate daemon port")));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

function daemonEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${executablePath}${delimiter}${process.env.PATH ?? ""}` };
}

async function startDaemon(): Promise<void> {
  daemon = spawn(
    daemonBinary,
    [
      "daemon",
      "start",
      "--foreground",
      "--home",
      home,
      "--listen",
      `127.0.0.1:${listenPort}`,
      "--web-dir",
      join(repositoryRoot, "packages", "app", "dist"),
    ],
    { cwd: repositoryRoot, env: daemonEnvironment(), stdio: ["ignore", "pipe", "pipe"] },
  );
  daemon.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  daemon.stderr?.on("data", (chunk) => {
    output += String(chunk);
  });
  await waitForPidRecord();
}

async function stopDaemon(): Promise<void> {
  await execFileAsync(daemonBinary, ["daemon", "stop", "--home", home]);
  await waitForExit(daemon);
}

async function waitForPidRecord(): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (daemon.exitCode !== null) {
      throw new Error(`Go daemon exited early (${daemon.exitCode}): ${output}`);
    }
    try {
      const record = JSON.parse(await readFile(join(home, "byspace.pid"), "utf8")) as {
        listen: string;
      };
      return record.listen;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`timed out waiting for Go daemon: ${output}`);
}

function waitForExit(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    process.once("exit", () => resolve());
    process.once("error", reject);
  });
}
