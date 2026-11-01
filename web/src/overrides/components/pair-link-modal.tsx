// shortcut: placeholder for packages/app/src/components/pair-link-modal.tsx until step 4's host settings
// batch ports it.
import type { HostProfile } from "@/types/host-connection";
import { PendingDialog } from "~/app/pending-dialogs";

export interface PairLinkModalProps {
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

export function PairLinkModal({ visible, onClose }: PairLinkModalProps) {
  return <PendingDialog open={visible} title="Paste pairing link" step={4} onClose={onClose} />;
}
