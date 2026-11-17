import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shims = path.join(root, ".dev", "corepack");
mkdirSync(shims, { recursive: true });

function run(command, args, env = process.env) {
  // cmd.exe otherwise splits arguments containing spaces before the .cmd shim sees them.
  const windows = process.platform === "win32";
  const result = spawnSync(
    command,
    windows ? args.map((arg) => `"${arg.replaceAll('"', '\\"')}"`) : args,
    {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      shell: windows,
    },
  );
  if (result.error) {
    console.error(result.error.message);
  }
  return result.status ?? 1;
}

const enabled = run("corepack", ["enable", "npm", "--install-directory", shims]);
if (enabled !== 0) {
  console.error("Corepack is required. Install it separately if your Node distribution omits it.");
  process.exit(enabled);
}

if (process.argv[2] === "--setup-ci") {
  if (!process.env.GITHUB_PATH) {
    throw new Error("--setup-ci requires GITHUB_PATH.");
  }
  appendFileSync(process.env.GITHUB_PATH, `${shims}\n`);
  process.exit(0);
}

const env = { ...process.env };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
env[pathKey] = `${shims}${path.delimiter}${env[pathKey] ?? ""}`;
process.exit(run("npm", process.argv.slice(2), env));
