import type { RefObject } from "react";

interface Args {
  value: string;
  textareaRef: RefObject<HTMLElement | null>;
  minHeight: number;
  maxHeight: number;
  onHeight: (height: number) => void;
}

/** Native TextInput reports its height through onContentSizeChange; no mirror is needed. */
export function useComposerHeightMirror(_args: Args): void {}
