export default {
  server: {
    host: "0.0.0.0",
  },
  define: {
    __API_URL__: JSON.stringify(process.env.API_URL ?? "http://localhost:4100"),
  },
};
