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
// No StrictMode: the shared packages/app code assumes an effect runs once per mount. Its form
// models close in the cleanup of a hook that creates them once (useAgentProfileFormModel), so
// StrictMode's extra mount/unmount in development leaves the agent profile form dead.
createRoot(container).render(<RouterProvider router={router} />);
