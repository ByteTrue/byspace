process.on("message", (message) => {
  if (message?.type !== "byspace_frame") return;
  process.send?.(message);
});
