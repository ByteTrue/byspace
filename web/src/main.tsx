import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import {
  installCryptoPolyfills,
  type CryptoPolyfillSources,
} from "@/polyfills/install-crypto-polyfills";
import { noteHistoryEntry } from "@/navigation/workspace-route-navigation";
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
// Workspace navigation replaces the host entry and pops what sits above it, so it needs to know
// which history entries are host-level.
noteHistoryEntry(router.state.location.pathname);
router.subscribe((state) => noteHistoryEntry(state.location.pathname));

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing");
// No StrictMode: the shared packages/app code assumes an effect runs once per mount. Its form
// models close in the cleanup of a hook that creates them once (useAgentProfileFormModel), so
// StrictMode's extra mount/unmount in development leaves the agent profile form dead.
// No transitions: a navigation renders the new screen at once, as expo-router did. In a transition
// the URL changed first and the screen a beat later, so a shortcut pressed in between (pin, close
// tab...) still acted on the previous screen.
createRoot(container).render(<RouterProvider router={router} useTransitions={false} />);
