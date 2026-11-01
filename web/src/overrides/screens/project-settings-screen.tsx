// shortcut: placeholder for packages/app/src/screens/project-settings-screen.tsx until step 4's
// projects batch ports it.
import { PendingSettingsPage } from "~/settings/pending-settings";

export interface ProjectSettingsScreenProps {
  serverId: string;
  projectId: string;
  onBackToProjects: () => void;
  showBackToProjects: boolean;
}

export default function ProjectSettingsScreen(_props: ProjectSettingsScreenProps) {
  return <PendingSettingsPage title="Project settings" />;
}
