/**
 * Static web UI serving for the self-hosted single container.
 *
 * Ports the cache/content-type rules of `packages/server/src/server/web-ui.ts`
 * to a plain `node:http` handler (the relay package does not depend on express).
 * Serves on the same origin as the relay so one domain + one certificate covers
 * both the app and wss://host/ws.
 */

import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json",
};

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function selectEncoding(acceptEncoding: string | undefined): "br" | "gzip" | null {
  if (!acceptEncoding) {
    return null;
  }
  const normalized = acceptEncoding.toLowerCase();
  if (normalized.includes("br")) {
    return "br";
  }
  if (normalized.includes("gzip")) {
    return "gzip";
  }
  return null;
}

function isHashedAsset(filePath: string): boolean {
  const base = path.basename(filePath);
  // Match content hashes like index-abc123def4567890.js or main.abc123def456.css.
  return /[-.][0-9a-f]{16,}[-.]/i.test(base);
}

function isInsideDir(targetPath: string, dirPath: string): boolean {
  const resolvedDir = path.resolve(dirPath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedDir || resolvedTarget.startsWith(resolvedDir + path.sep);
}

interface ResolvedTarget {
  resolvedFile: string;
  isIndexHtml: boolean;
}

function safeStat(filePath: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

function resolveTargetFile(distDir: string, requestPath: string): ResolvedTarget | null {
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(distDir, safePath);

  const stat = safeStat(filePath);
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  const finalStat = safeStat(filePath);
  if (!finalStat?.isFile()) {
    filePath = path.join(distDir, "index.html");
    const fallbackStat = safeStat(filePath);
    if (!fallbackStat?.isFile()) {
      return null;
    }
  }

  if (!isInsideDir(filePath, distDir)) {
    return null;
  }

  const resolvedFile = path.resolve(filePath);
  const isIndexHtml = path.basename(resolvedFile).toLowerCase() === "index.html";
  return { resolvedFile, isIndexHtml };
}

interface ContentEncodingResult {
  finalFile: string;
  contentEncoding: string | null;
}

function resolveContentEncoding(
  resolvedFile: string,
  acceptEncoding: string | undefined,
): ContentEncodingResult {
  const encoding = selectEncoding(acceptEncoding);
  if (!encoding) {
    return { finalFile: resolvedFile, contentEncoding: null };
  }
  const compressedFile = `${resolvedFile}.${encoding === "br" ? "br" : "gz"}`;
  const compressedStat = safeStat(compressedFile);
  if (compressedStat?.isFile()) {
    return { finalFile: compressedFile, contentEncoding: encoding };
  }
  return { finalFile: resolvedFile, contentEncoding: null };
}

function setResponseCacheHeaders(
  res: ServerResponse,
  isIndexHtml: boolean,
  resolvedFile: string,
): void {
  if (isIndexHtml) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  } else if (isHashedAsset(resolvedFile)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "no-cache");
  }
}

export type StaticWebHandler = (req: IncomingMessage, res: ServerResponse) => boolean;

/**
 * Returns a request handler serving `distDir`, or null when the directory has
 * no index.html (relay-only deployments). The handler answers every request it
 * can resolve and returns false only for paths outside the web root, which the
 * relay answers with 404.
 */
export function createStaticWebHandler(distDir: string): StaticWebHandler | null {
  if (!safeStat(path.join(distDir, "index.html"))?.isFile()) {
    return null;
  }

  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method not allowed");
      return true;
    }

    let requestPath: string;
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      requestPath = url.pathname;
    } catch {
      return false;
    }

    const target = resolveTargetFile(distDir, requestPath);
    if (!target) {
      return false;
    }

    const { resolvedFile, isIndexHtml } = target;
    const acceptEncoding = isIndexHtml ? undefined : req.headers["accept-encoding"];
    const { finalFile, contentEncoding } = resolveContentEncoding(resolvedFile, acceptEncoding);

    res.setHeader("Content-Type", getContentType(resolvedFile));
    if (contentEncoding) {
      res.setHeader("Content-Encoding", contentEncoding);
      res.setHeader("Vary", "Accept-Encoding");
    }
    setResponseCacheHeaders(res, isIndexHtml, resolvedFile);

    if (req.method === "HEAD") {
      res.writeHead(200);
      res.end();
      return true;
    }

    res.writeHead(200);
    const stream = createReadStream(finalFile);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
      }
      res.end();
    });
    stream.pipe(res);
    return true;
  };
}
