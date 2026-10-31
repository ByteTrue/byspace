import { createBrowserRouter } from "react-router";
import { AppShell } from "~/app/app-shell";
import { HomePage } from "~/app/home-page";
import { WorkspacePage } from "~/workspace/workspace-page";

// Paths match packages/app/src/app (Expo Router) so links, bookmarks and pairing URLs keep working.
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "h/:serverId/workspace/:workspaceId", element: <WorkspacePage /> },
    ],
  },
]);
