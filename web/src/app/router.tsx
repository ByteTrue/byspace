import { createBrowserRouter, Navigate } from "react-router";
// The Expo route modules that are pure redirects or resolvers run unchanged.
import HostAgentRoute from "@/app/h/[serverId]/agent/[agentId]";
import HostIndexRoute from "@/app/h/[serverId]/index";
import HostOpenProjectRoute from "@/app/h/[serverId]/open-project";
import HostSessionsRoute from "@/app/h/[serverId]/sessions";
import HostWorkspaceRoute from "@/app/h/[serverId]/workspace/[workspaceId]/index";
import LegacyHostSettingsRoute from "@/app/h/[serverId]/settings";
import StartupIndexRoute from "@/app/index";
import SettingsHostIndexRoute from "@/app/settings/hosts/[serverId]/index";
import { Root } from "~/app/root";
import { HostLayout, PendingPage, SettingsIndexRoute } from "~/app/routes";

// One entry per file in packages/app/src/app, same paths, so links, bookmarks and pairing URLs
// keep working. Pages that move in later steps of the rewrite render PendingPage until then.
export const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    children: [
      { index: true, element: <StartupIndexRoute /> },
      { path: "welcome", element: <PendingPage title="Welcome" step={4} /> },
      { path: "pair-scan", element: <PendingPage title="Pair a device" step={4} /> },
      { path: "new", element: <PendingPage title="New workspace" step={3} /> },
      { path: "open-project", element: <PendingPage title="Open a project" step={4} /> },
      { path: "sessions", element: <PendingPage title="History" step={4} /> },
      { path: "schedules", element: <PendingPage title="Schedules" step={4} /> },
      { path: "tunnels", element: <PendingPage title="Tunnels" step={4} /> },
      { path: "settings", element: <SettingsIndexRoute /> },
      { path: "settings/:section", element: <PendingPage title="Settings" step={4} /> },
      { path: "settings/hosts/:serverId", element: <SettingsHostIndexRoute /> },
      {
        path: "settings/hosts/:serverId/:hostSection",
        element: <PendingPage title="Host settings" step={4} />,
      },
      {
        path: "settings/hosts/:serverId/projects",
        element: <PendingPage title="Projects" step={4} />,
      },
      {
        path: "settings/hosts/:serverId/projects/:projectId",
        element: <PendingPage title="Project settings" step={4} />,
      },
      {
        path: "h/:serverId",
        element: <HostLayout />,
        children: [
          { index: true, element: <HostIndexRoute /> },
          { path: "workspace/:workspaceId", element: <HostWorkspaceRoute /> },
          { path: "agent/:agentId", element: <HostAgentRoute /> },
          { path: "sessions", element: <HostSessionsRoute /> },
          { path: "open-project", element: <HostOpenProjectRoute /> },
          { path: "settings", element: <LegacyHostSettingsRoute /> },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
