/** Pair-device modal shim (Electron retired, issue 025 A3). Never visible on web. */
import type { ReactNode } from "react";

export function PairDeviceModal(_props: {
  serverId: string;
  visible: boolean;
  onClose: () => void;
  testID?: string;
}): ReactNode {
  return null;
}
