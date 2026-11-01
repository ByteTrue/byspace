import { createBrowserRouter, Navigate } from "react-router";
// The Expo route modules that are pure redirects or resolvers run unchanged.
import HostAgentRoute from "@/app/h/[serverId]/agent/[agentId]";
import HostIndexRoute from "@/app/h/[serverId]/index";
import HostOpenProjectRoute from "@/app/h/[serverId]/open-project";
import HostSessionsRoute from "@/app/h/[serverId]/sessions";
import HostWorkspaceRoute from "@/app/h/[serverId]/workspace/[workspaceId]/index";
import NewWorkspaceRoute from "@/app/new";
import OpenProjectRoute from "@/app/open-project";
import PairScanRoute from "@/app/pair-scan";
import SessionsRoute from "@/app/sessions";
import WelcomeRoute from "@/app/welcome";
import LegacyHostSettingsRoute from "@/app/h/[serverId]/settings";
import StartupIndexRoute from "@/app/index";
import SettingsHostIndexRoute from "@/app/settings/hosts/[serverId]/index";
import SettingsSectionRoute from "@/app/settings/[section]";
import SettingsHostSectionRoute from "@/app/settings/hosts/[serverId]/[hostSection]";
import SettingsHostProjectsRoute from "@/app/settings/hosts/[serverId]/projects/index";
import SettingsHostProjectDetailRoute from "@/app/settings/hosts/[serverId]/projects/[projectId]";
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
      { path: "welcome", element: <WelcomeRoute /> },
      { path: "pair-scan", element: <PairScanRoute /> },
      { path: "new", element: <NewWorkspaceRoute /> },
      { path: "open-project", element: <OpenProjectRoute /> },
      { path: "sessions", element: <SessionsRoute /> },
      { path: "schedules", element: <PendingPage title="Schedules" step={4} /> },
      { path: "tunnels", element: <PendingPage title="Tunnels" step={4} /> },
      { path: "settings", element: <SettingsIndexRoute /> },
      { path: "settings/:section", element: <SettingsSectionRoute /> },
      { path: "settings/hosts/:serverId", element: <SettingsHostIndexRoute /> },
      {
        path: "settings/hosts/:serverId/:hostSection",
        element: <SettingsHostSectionRoute />,
      },
      {
        path: "settings/hosts/:serverId/projects",
        element: <SettingsHostProjectsRoute />,
      },
      {
        path: "settings/hosts/:serverId/projects/:projectId",
        element: <SettingsHostProjectDetailRoute />,
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
