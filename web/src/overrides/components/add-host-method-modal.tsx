// shortcut: placeholder for packages/app/src/components/add-host-method-modal.tsx until step 4's
// host settings batch ports it.
import { PendingDialog } from "~/app/pending-dialogs";

export interface AddHostMethodModalProps {
  visible: boolean;
  onClose: () => void;
  onDirectConnection: () => void;
  onRemoteSsh: () => void;
  onPasteLink: () => void;
}

export function AddHostMethodModal({ visible, onClose }: AddHostMethodModalProps) {
  return <PendingDialog open={visible} title="Add host" step={4} onClose={onClose} />;
}
