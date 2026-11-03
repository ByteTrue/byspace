import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { installCryptoPolyfills } from "@/polyfills/install-crypto-polyfills";
import { noteHistoryEntry } from "@/navigation/workspace-route-navigation";
import { router } from "~/app/router";
import { bindRouter } from "~/app/navigation";
import "./index.css";

installCryptoPolyfills(globalThis.crypto);
bindRouter(router);
// Workspace navigation replaces the host entry and pops what sits above it, so it needs to know
// which history entries are host-level.
noteHistoryEntry(router.state.location.pathname);
router.subscribe((state) => noteHistoryEntry(state.location.pathname));

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing");
// No StrictMode: the code ported from the Expo app assumes an effect runs once per mount. Its form
// models close in the cleanup of a hook that creates them once (useAgentProfileFormModel), so
// StrictMode's extra mount/unmount in development leaves the agent profile form dead.
// No transitions: a navigation renders the new screen at once, as the Expo app's router did. In a transition
// the URL changed first and the screen a beat later, so a shortcut pressed in between (pin, close
// tab...) still acted on the previous screen.
createRoot(container).render(<RouterProvider router={router} useTransitions={false} />);
