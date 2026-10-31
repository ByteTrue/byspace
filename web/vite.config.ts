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
// expo-router.tsx, ...). The react-native shim has no components, so a shared module that
// renders React Native UI fails to build and has to be overridden in src/overrides/.
const shimAliases = fs.readdirSync(shimsDir).map((file) => ({
  find: new RegExp(`^${file.replace(/\.tsx?$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
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
    resolveId(source) {
      if (!source.startsWith("@/")) return null;
      const rel = source.slice(2);
      return (
        resolveModuleFile(path.join(overridesDir, rel)) ?? resolveModuleFile(path.join(appSrc, rel))
      );
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [sharedAppSource(), react(), tailwindcss()],
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
  },
}));
