const pkg = require("./package.json");
const withPasteInput = require("./plugins/with-paste-input");

// Native mobile builds are retired (issue 025 A2): this config now serves the
// Expo web export only. withPasteInput stays — it patches the paste-input
// native module used by the terminal paste path on native; on web it is inert
// but the plugin list must keep resolving for `expo export --platform web`.
const appVariant = process.env.APP_VARIANT ?? "production";

const variants = {
  production: {
    name: "BySpace",
  },
  development: {
    name: "BySpace Debug",
  },
};

const variant = variants[appVariant] ?? variants.production;

export default {
  expo: {
    name: variant.name,
    slug: "byspace",
    version: pkg.version,
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "byspace",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    web: {
      output: "single",
      favicon: "./assets/images/favicon.png",
    },
    autolinking: {
      searchPaths: ["../../node_modules", "./node_modules"],
    },
    plugins: ["expo-router", withPasteInput],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
      autolinkingModuleResolution: true,
    },
    extra: {
      router: {},
    },
  },
};
