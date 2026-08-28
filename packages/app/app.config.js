const pkg = require("./package.json");

module.exports = {
  expo: {
    name: "byspace",
    slug: "byspace",
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
