const pkg = require("./package.json");

export default {
  expo: {
    name: "Paseo",
    slug: "paseo-web",
    version: pkg.version,
    scheme: "paseo",
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
