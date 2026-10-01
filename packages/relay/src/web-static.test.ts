/**
 * Static web serving for the self-hosted single container: the same rules as
 * packages/server/src/server/web-ui.ts, ported to node:http.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNodeRelayServer } from "./node-adapter.js";
import { createStaticWebHandler } from "./web-static.js";

interface ResponseInfo {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(port: number, requestPath: string, method = "GET"): Promise<ResponseInfo> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: requestPath, method }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("static web handler", () => {
  let distDir: string;
  let port: number;
  let relay: ReturnType<typeof createNodeRelayServer>;

  beforeAll(async () => {
    distDir = mkdtempSync(path.join(tmpdir(), "byspace-web-static-"));
    writeFileSync(path.join(distDir, "index.html"), "<html><body>app</body></html>");
    mkdirSync(path.join(distDir, "_expo", "static", "js", "web"), { recursive: true });
    writeFileSync(
      path.join(distDir, "_expo", "static", "js", "web", "index-c17c9072504cda23.js"),
      "console.log(1);",
    );
    mkdirSync(path.join(distDir, "schemas"), { recursive: true });
    writeFileSync(path.join(distDir, "schemas", "byspace.config.v1.json"), '{"type":"object"}');
    writeFileSync(path.join(distDir, "sw.js"), "// service worker");

    relay = createNodeRelayServer({ port: 0, host: "127.0.0.1", webDir: distDir });
    await new Promise<void>((resolve, reject) => {
      relay.server.once("error", reject);
      relay.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = relay.server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to acquire port");
    }
    port = address.port;
  });

  afterAll(async () => {
    await relay.close();
    rmSync(distDir, { recursive: true, force: true });
  });

  it("serves index.html with no-store", async () => {
    const res = await request(port, "/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.body).toContain("app");
  });

  it("serves hashed assets as immutable", async () => {
    const res = await request(port, "/_expo/static/js/web/index-c17c9072504cda23.js");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers["content-type"]).toContain("application/javascript");
  });

  it("serves runtime schemas with no-cache", async () => {
    const res = await request(port, "/schemas/byspace.config.v1.json");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("falls back to index.html for client-side routes", async () => {
    const res = await request(port, "/sessions/abc");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("app");
  });

  it("keeps /health on the relay", async () => {
    const res = await request(port, "/health");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });

  it("rejects path traversal", async () => {
    const res = await request(port, "/..%2f..%2fetc%2fpasswd");
    // Either 404 (outside root) or the SPA fallback - never file contents.
    expect(res.body).not.toContain("root:");
  });

  it("answers HEAD with headers only", async () => {
    const res = await request(port, "/", "HEAD");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toBe("");
  });
});

describe("static web handler disabled", () => {
  it("returns null when distDir has no index.html", () => {
    const emptyDir = mkdtempSync(path.join(tmpdir(), "byspace-web-static-empty-"));
    try {
      expect(createStaticWebHandler(emptyDir)).toBeNull();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
