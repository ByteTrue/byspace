const { getDefaultConfig } = require("expo/metro-config");
const { resolve } = require("metro-resolver");
const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const appNodeModulesRoot = path.resolve(projectRoot, "node_modules");
const appSrcRoot = path.resolve(projectRoot, "src");
const relaySrcRoot = path.resolve(projectRoot, "../relay/src");

const config = getDefaultConfig(projectRoot);
const defaultResolveRequest = config.resolver.resolveRequest ?? resolve;

// Keep app exports deterministic across dev machines and CI. Metro's Watchman
// crawler behavior depends on the host Watchman build/capabilities, while the
// node crawler is the path used when Watchman is absent.
config.resolver.useWatchman = false;

const escapedAppSrcRoot = appSrcRoot
  .split(path.sep)
  .map((segment) => segment.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&"))
  .join("[\\\\/]");
const pathSeparatorPattern = "[\\\\/]";

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.join(appNodeModulesRoot, "react"),
  "react-dom": path.join(appNodeModulesRoot, "react-dom"),
  "react/jsx-runtime": path.join(appNodeModulesRoot, "react/jsx-runtime"),
  "react/jsx-dev-runtime": path.join(appNodeModulesRoot, "react/jsx-dev-runtime"),
};
config.resolver.blockList = new RegExp(
  `(^${escapedAppSrcRoot}${pathSeparatorPattern}.*\\.(test|spec)\\.(ts|tsx)$|${pathSeparatorPattern}__tests__${pathSeparatorPattern}.*)$`,
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath;
  if (origin && origin.startsWith(relaySrcRoot) && moduleName.endsWith(".js")) {
    const tsModuleName = moduleName.replace(/\.js$/, ".ts");
    const candidatePath = path.resolve(path.dirname(origin), tsModuleName);
    if (fs.existsSync(candidatePath)) {
      return defaultResolveRequest(context, tsModuleName, platform);
    }
  }

  return defaultResolveRequest(context, moduleName, platform);
};

module.exports = config;
