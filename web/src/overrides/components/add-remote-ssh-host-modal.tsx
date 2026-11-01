// shortcut: placeholder for packages/app/src/components/add-remote-ssh-host-modal.tsx until step 4's host settings
// batch ports it.
import type { HostProfile } from "@/types/host-connection";
import { PendingDialog } from "~/app/pending-dialogs";

export interface AddRemoteSshHostModalProps {
  visible: boolean;
  onClose: () => void;
  onCancel?: () => void;
  onSaved?: (result: {
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
    isNewHost: boolean;
  }) => void;
}

export function AddRemoteSshHostModal({ visible, onClose }: AddRemoteSshHostModalProps) {
  return <PendingDialog open={visible} title="Remote SSH" step={4} onClose={onClose} />;
}
