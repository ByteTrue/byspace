import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { installCryptoPolyfills } from "@/polyfills/install-crypto-polyfills";
import { noteHistoryEntry } from "@/navigation/workspace-route-navigation";
import { installExternalLinkHandler } from "@/utils/external-links";
import { installImeAnchorGuard } from "@/utils/ime-anchor";
import { router } from "~/app/router";
import { bindRouter } from "~/app/navigation";
import "./index.css";

installCryptoPolyfills(globalThis.crypto);
// Windows/WebView2 loses the IME caret anchor after an interactive resize (WebView2Feedback#5675);
// the guard re-anchors the focused editable and no-ops everywhere else.
installImeAnchorGuard();
// The desktop webview has no address bar: an external link must leave through the system browser
// instead of replacing the app with the page.
installExternalLinkHandler();
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
