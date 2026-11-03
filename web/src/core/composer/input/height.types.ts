import type { CSSProperties } from "react";

export type ComposerHeightResult =
  | {
      mode: "intrinsic";
      style: CSSProperties;
      scrollEnabled: true;
    }
  | {
      mode: "measured";
      style: CSSProperties;
      scrollEnabled: boolean;
      onTextChange: (previousText: string, nextText: string) => void;
      reset: () => void;
    };
