import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import {
  installCryptoPolyfills,
  type CryptoPolyfillSources,
} from "@/polyfills/install-crypto-polyfills";
import { router } from "~/app/router";
import { bindExpoRouter } from "~/shims/expo-router";
import "./index.css";

// crypto.randomUUID only exists in secure contexts; a daemon reached over plain http on the LAN
// is not one, and the client needs UUIDs.
installCryptoPolyfills(globalThis, {
  expoGetRandomValues: crypto.getRandomValues.bind(
    crypto,
  ) as CryptoPolyfillSources["expoGetRandomValues"],
});
bindExpoRouter(router);

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing");
createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
