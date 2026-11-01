// shortcut: placeholder for packages/app/src/components/add-host-modal.tsx until step 4's host settings
// batch ports it.
import type { HostProfile } from "@/types/host-connection";
import { PendingDialog } from "~/app/pending-dialogs";

export interface AddHostModalProps {
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

export function AddHostModal({ visible, onClose }: AddHostModalProps) {
  return <PendingDialog open={visible} title="Direct connection" step={4} onClose={onClose} />;
}
