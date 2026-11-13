import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { constants as zlibConstants, createBrotliCompress, createGzip } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE_DIST = path.join(REPO_ROOT, "web", "dist");
// The Node daemon used to serve this bundle from packages/server/dist. That package is now
// archived; the Go binary embeds the bundle directly via //go:embed internal/webui/dist.
const TARGET_DIST = path.join(REPO_ROOT, "internal", "webui", "dist");
// Git tracks this empty file so the embed directory exists in a fresh clone. Wiping the directory
// deletes it, which leaves the worktree dirty — and the release packer refuses a dirty worktree, so
// every `release:*` command failed right after building the bundle.
const TARGET_KEEP = path.join(TARGET_DIST, ".keep");
const COMPRESS_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".svg", ".map"]);

function fmtMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

// npm is a .cmd shim on Windows; spawn refuses to run a .cmd without a shell, so every release
// command failed here after the Go build, right before the bundle step.
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const NPM_OPTIONS = { shell: process.platform === "win32" };

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
        return;
      }
      resolve();
    });
  });
}

async function buildWebApp() {
  // web/ imports the workspace packages through their built dist/, which a fresh checkout (the
  // release workflow, the Docker build) does not have yet.
  console.log("Building workspace packages...");
  await run(NPM, ["run", "build:app-deps"], { cwd: REPO_ROOT, ...NPM_OPTIONS });
  console.log("Building the web app (web/)...");
  await run(NPM, ["run", "build", "--workspace=@bytetrue/web"], {
    cwd: REPO_ROOT,
    ...NPM_OPTIONS,
  });
}

async function cleanTarget() {
  console.log(`Cleaning ${path.relative(REPO_ROOT, TARGET_DIST)}...`);
  await rm(TARGET_DIST, { recursive: true, force: true });
  await mkdir(TARGET_DIST, { recursive: true });
  await writeFile(TARGET_KEEP, "");
}

async function copyAssets() {
  console.log(`Copying assets to ${path.relative(REPO_ROOT, TARGET_DIST)}...`);
  await cp(SOURCE_DIST, TARGET_DIST, { recursive: true, force: true });
}

async function compressFile(filePath) {
  const brotliPath = `${filePath}.br`;
  const gzipPath = `${filePath}.gz`;
  await Promise.all([
    pipeline(
      createReadStream(filePath),
      // Quality 6 compresses the 20 MB bundle ~25x faster than BROTLI_MAX_QUALITY (11) on 2-core
      // CI runners while staying within ~3% of the max-quality size.
      createBrotliCompress({
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
        },
      }),
      createWriteStream(brotliPath),
    ),
    pipeline(createReadStream(filePath), createGzip(), createWriteStream(gzipPath)),
  ]);
}

async function precompressAssets(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const dirs = entries.filter((entry) => entry.isDirectory());

  for (const file of files) {
    const filePath = path.join(dir, file.name);
    if (COMPRESS_EXTENSIONS.has(path.extname(file.name).toLowerCase())) {
      await compressFile(filePath);
    }
  }

  for (const subdir of dirs) {
    await precompressAssets(path.join(dir, subdir.name));
  }
}

async function measureBundle(dir) {
  let raw = 0;
  let gzip = 0;
  let brotli = 0;

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      const info = await stat(entryPath);
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".br") {
        brotli += info.size;
      } else if (ext === ".gz") {
        gzip += info.size;
      } else {
        raw += info.size;
      }
    }
  }

  await walk(dir);
  return { raw, gzip, brotli };
}

async function main() {
  await buildWebApp();

  const sourceStat = await stat(SOURCE_DIST).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error(`Web app build not found at ${SOURCE_DIST}`);
  }

  await cleanTarget();
  await copyAssets();
  await precompressAssets(TARGET_DIST);

  const sizes = await measureBundle(TARGET_DIST);
  console.log("Daemon web UI bundle:");
  console.log(`  raw:    ${fmtMiB(sizes.raw)}`);
  console.log(`  gzip:   ${fmtMiB(sizes.gzip)}`);
  console.log(`  brotli: ${fmtMiB(sizes.brotli)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
