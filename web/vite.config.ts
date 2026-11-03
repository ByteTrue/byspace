import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.join(webRoot, "src");
const coreDir = path.join(webSrc, "core");

// A Node built-in name with no browser package installed (`buffer` without the `buffer` dependency)
// builds into an empty module and the app crashes at runtime. Vite only warns, and a throw from the
// log hook is swallowed, so the warnings are collected and the build fails once it has run.
const browserExternalized: string[] = [];
const failOnBrowserExternalized: Plugin = {
  name: "byspace:fail-on-browser-externalized",
  apply: "build",
  buildEnd() {
    if (browserExternalized.length > 0) {
      throw new Error(browserExternalized.join("\n"));
    }
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), failOnBrowserExternalized],
  resolve: {
    alias: [
      { find: /^~\//, replacement: `${webSrc}/` },
      { find: /^@\//, replacement: `${coreDir}/` },
    ],
    dedupe: ["react", "react-dom", "zustand", "@tanstack/react-query", "i18next", "react-i18next"],
  },
  define: {
    __DEV__: JSON.stringify(mode !== "production"),
    "process.env.BYSPACE_LOCAL_DAEMON": JSON.stringify(process.env.BYSPACE_LOCAL_DAEMON ?? ""),
    "process.env.BYSPACE_DEV_BUILD_LABEL": JSON.stringify(
      process.env.BYSPACE_DEV_BUILD_LABEL ?? "",
    ),
  },
  build: {
    rolldownOptions: {
      onLog(level, log, defaultHandler) {
        if (log.message.includes("externalized for browser compatibility")) {
          browserExternalized.push(log.message);
        }
        defaultHandler(level, log);
      },
    },
  },
  server: {
    port: 8082,
    strictPort: true,
    // Shims are discovered when the config loads; restart the dev server after adding one.
  },
}));
