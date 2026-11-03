import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import net from "node:net";
import dotenv from "dotenv";

const RESERVED_LOCAL_PORTS = new Set([
  6767, // Developer daemon.
  61680, // OpenCode's default local server.
]);

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function getAvailableE2EPort(): Promise<number> {
  for (;;) {
    const port = await getAvailablePort();
    if (!RESERVED_LOCAL_PORTS.has(port)) return port;
  }
}

async function loadHarnessEnvironment(repoRoot: string): Promise<void> {
  const envTestPath = path.join(repoRoot, ".env.test");
  if (existsSync(envTestPath)) dotenv.config({ path: envTestPath });
}

const STATIC_MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function resolveStaticWebDir(repoRoot: string): string {
  const explicit = process.env.E2E_STATIC_WEB_DIR?.trim();
  const dir = explicit ? path.resolve(repoRoot, explicit) : path.join(repoRoot, "web/dist");
  if (!existsSync(path.join(dir, "index.html"))) {
    throw new Error(`${dir} is not built: run \`npm run build --workspace=@bytetrue/web\` first.`);
  }
  return dir;
}

async function startStaticWebServer(port: number, staticDir: string): Promise<http.Server> {
  const indexHtml = readFileSync(path.join(staticDir, "index.html"));
  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (reqUrl.pathname === "/status") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("packager-status:running");
      return;
    }
    const relPath = decodeURIComponent(reqUrl.pathname).replace(/^\/+/, "");
    const candidate = path.resolve(staticDir, relPath || "index.html");
    if (!candidate.startsWith(staticDir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const ext = path.extname(candidate).toLowerCase();
    const contentType = STATIC_MIME_TYPES[ext] ?? "application/octet-stream";

    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
        res.end(readFileSync(candidate));
        return;
      }
      if (existsSync(candidate + ".gz") && statSync(candidate + ".gz").isFile()) {
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Encoding": "gzip",
          "Cache-Control": "no-cache",
        });
        res.end(readFileSync(candidate + ".gz"));
        return;
      }
    } catch {
      // Fall through to SPA index fallback
    }

    if (!ext || ext === ".html") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(indexHtml);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return server;
}

export default async function globalSetup() {
  if (process.env.BYSPACE_REPLICA_CACHE_MEASUREMENT === "1") {
    if (!process.env.BYSPACE_REPLICA_CACHE_MEASUREMENT_URL) {
      throw new Error("BYSPACE_REPLICA_CACHE_MEASUREMENT_URL must be set for live measurement");
    }
    return;
  }
  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  await loadHarnessEnvironment(repoRoot);

  const metroPort = await getAvailableE2EPort();
  const staticDir = resolveStaticWebDir(repoRoot);
  const staticServer = await startStaticWebServer(metroPort, staticDir);
  process.env.E2E_METRO_PORT = String(metroPort);
  console.log(`[e2e] Static web bundle served on port ${metroPort} from ${staticDir}`);
  return async () => {
    await new Promise<void>((resolve) => staticServer.close(() => resolve()));
    console.log("[e2e] Static web server stopped");
  };
}
