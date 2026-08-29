const pkg = require("./package.json");

export default {
  expo: {
    name: "BySpace",
    slug: "byspace-web",
    version: pkg.version,
    scheme: "byspace",
    userInterfaceStyle: "automatic",
    web: {
      output: "single",
      favicon: "./assets/images/favicon.png",
    },
    plugins: ["expo-router"],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};
