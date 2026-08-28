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

config.resolver.useWatchman = false;
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.join(appNodeModulesRoot, "react"),
  "react-dom": path.join(appNodeModulesRoot, "react-dom"),
  "react/jsx-runtime": path.join(appNodeModulesRoot, "react/jsx-runtime"),
  "react/jsx-dev-runtime": path.join(appNodeModulesRoot, "react/jsx-dev-runtime"),
};

const escapedAppSrcRoot = appSrcRoot
  .split(path.sep)
  .map((segment) => segment.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&"))
  .join("[\\\\/]");
config.resolver.blockList = new RegExp(
  `(^${escapedAppSrcRoot}[\\\\/].*\\.(test|spec)\\.(ts|tsx)$|[\\\\/]__tests__[\\\\/].*)$`,
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath;
  if (origin && origin.startsWith(relaySrcRoot) && moduleName.endsWith(".js")) {
    const tsModuleName = moduleName.replace(/\.js$/, ".ts");
    if (fs.existsSync(path.resolve(path.dirname(origin), tsModuleName))) {
      return defaultResolveRequest(context, tsModuleName, platform);
    }
  }
  return defaultResolveRequest(context, moduleName, platform);
};

module.exports = config;
