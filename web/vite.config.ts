import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.join(webRoot, "src");
const overridesDir = path.join(webSrc, "overrides");
const appSrc = path.resolve(webRoot, "../packages/app/src");
const shimsDir = path.join(webSrc, "shims");

// Every file in src/shims/ stands in for the package it is named after (react-native.ts,
// expo-router.tsx, ...; `__` is a `/`, so expo__dom.ts is expo/dom). The react-native shim has no
// components, so a shared module that renders React Native UI fails to build and has to be
// overridden in src/overrides/.
const shimAliases = fs.readdirSync(shimsDir).map((file) => ({
  find: new RegExp(
    `^${file
      .replace(/\.tsx?$/, "")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("__", "/")}$`,
  ),
  replacement: path.join(shimsDir, file),
}));

// Metro resolves `.web` files first; shared packages/app modules rely on that.
const EXTENSIONS = [".web.tsx", ".web.ts", ".tsx", ".ts", ".mjs", ".js", ".jsx", ".json"];

function resolveModuleFile(base: string): string | null {
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONS) {
    const index = path.join(base, `index${ext}`);
    if (fs.existsSync(index)) return index;
  }
  return null;
}

/**
 * Transitional (until the cutover deletes packages/app): `@/x` resolves to web/src/overrides/x
 * when that file exists, otherwise to packages/app/src/x. tsconfig.json `paths` lists the same
 * order. Overrides only apply to `@/` imports, not to relative imports inside packages/app.
 */
function sharedAppSource(): Plugin {
  return {
    name: "byspace-shared-app-source",
    enforce: "pre",
    resolveId(source, importer) {
      if (source.startsWith("@/")) {
        const rel = source.slice(2);
        return (
          resolveModuleFile(path.join(overridesDir, rel)) ??
          resolveModuleFile(path.join(appSrc, rel))
        );
      }
      // A shared file's relative import of an overridden module gets the override too; otherwise
      // `./icon` from a packages/app file would load the Expo icon beside it.
      if (source.startsWith(".") && importer?.startsWith(appSrc)) {
        const rel = path.relative(appSrc, path.resolve(path.dirname(importer), source));
        return resolveModuleFile(path.join(overridesDir, rel));
      }
      return null;
    },
  };
}

/**
 * Transitional: shared modules load images Metro-style, `require("../x.png")`. Rewrite each to an
 * imported asset URL wrapped as `{ uri }`, the shape Expo's web runtime hands those calls back.
 */
function metroAssetRequires(): Plugin {
  return {
    name: "byspace-metro-asset-requires",
    enforce: "pre",
    transform(code, id) {
      if (!id.startsWith(appSrc) || !code.includes("require(")) return null;
      const imports: string[] = [];
      const transformed = code.replace(
        /require\("([^"]+\.(?:png|jpe?g|gif|webp|svg))"\)/g,
        (_match, assetPath: string) => {
          const name = `__metroAsset${imports.length}`;
          imports.push(`import ${name} from ${JSON.stringify(assetPath)};`);
          return `{ uri: ${name} }`;
        },
      );
      if (imports.length === 0) return null;
      return { code: `${imports.join("\n")}\n${transformed}`, map: null };
    },
  };
}

const appPublic = path.resolve(webRoot, "../packages/app/public");
const PUBLIC_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function listPublicFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listPublicFiles(full, base);
    return [path.relative(base, full)];
  });
}

/**
 * Transitional: packages/app/public — the push service worker (Settings → Notifications), the web
 * manifest, icons, robots.txt, install scripts — at the site root, as the Expo export serves it.
 * Its index.html is the Expo shell and is left out. Moves into web/public at the switch.
 */
function sharedPublicFiles(): Plugin {
  return {
    name: "byspace-shared-public",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0] ?? "").replace(/^\/+/, "");
        const file = path.join(appPublic, rel);
        if (
          !rel ||
          rel === "index.html" ||
          !file.startsWith(appPublic + path.sep) ||
          !fs.existsSync(file) ||
          !fs.statSync(file).isFile()
        ) {
          next();
          return;
        }
        res.setHeader("Content-Type", PUBLIC_TYPES[path.extname(file)] ?? "text/plain");
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const rel of listPublicFiles(appPublic)) {
        if (rel === "index.html") continue;
        this.emitFile({
          type: "asset",
          fileName: rel,
          source: fs.readFileSync(path.join(appPublic, rel)),
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [sharedAppSource(), metroAssetRequires(), sharedPublicFiles(), react(), tailwindcss()],
  resolve: {
    extensions: EXTENSIONS,
    alias: [{ find: /^~\//, replacement: `${webSrc}/` }, ...shimAliases],
    dedupe: ["react", "react-dom", "zustand", "@tanstack/react-query", "i18next", "react-i18next"],
  },
  define: {
    __DEV__: JSON.stringify(mode !== "production"),
    "process.env.EXPO_PUBLIC_LOCAL_DAEMON": JSON.stringify(
      process.env.EXPO_PUBLIC_LOCAL_DAEMON ?? "",
    ),
    "process.env.EXPO_PUBLIC_BYSPACE_DEV_BUILD_LABEL": JSON.stringify(
      process.env.EXPO_PUBLIC_BYSPACE_DEV_BUILD_LABEL ?? "",
    ),
  },
  server: {
    port: 8082,
    strictPort: true,
    // Shims are discovered when the config loads; restart the dev server after adding one.
  },
}));
