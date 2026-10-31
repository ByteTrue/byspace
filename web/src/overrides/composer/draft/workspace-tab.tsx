// Override of packages/app/src/composer/draft/workspace-tab.tsx.
// shortcut: the new-agent tab (draft composer with provider, model and mode setup) moves with the
// composer in batch 3 of step 3; until then the tab says so.
import type { AgentSnapshotPayload } from "@bytetrue/protocol/messages";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { PendingPanel } from "@/panels/pending-panel";

export function WorkspaceDraftAgentTab(_props: {
  serverId: string;
  workspaceId: string;
  tabId: string;
  draftId: string;
  initialSetup?: WorkspaceDraftTabSetup;
  isPaneFocused: boolean;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
  onCreated: (agentSnapshot: AgentSnapshotPayload) => void;
  onOpenImportSheet?: () => void;
}) {
  return <PendingPanel title="New agent" />;
}
