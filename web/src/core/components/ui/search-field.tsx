// Port of packages/app/src/components/ui/search-field.tsx: the search box on a screen's filter row; DOM view.
// Converted from the Expo file by web/scripts/port/sessions-screen.py (tag archive/expo-app); edit it directly.
import { useCallback, useRef, type ReactElement } from "react";
import { Search, X } from "lucide-react";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";

export interface SearchFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  /** Falls back to `placeholder`, which already names the field. */
  accessibilityLabel?: string;
  clearAccessibilityLabel: string;
  testID?: string;
  clearTestID?: string;
}

/**
 * The standalone search box that leads a screen's filter rail. Its chrome is
 * the host filter pill's, so the two sit on the same rail and read as one row
 * of controls; only the border colour moves on focus, which keeps the leading
 * icon from shifting. It owns its own clear affordance — a caller rendering its
 * own X has been handed the wrong component.
 */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  clearAccessibilityLabel,
  testID,
  clearTestID,
}: SearchFieldProps): ReactElement {
  const inputRef = useRef<EditingTextInputHandle>(null);
  const handleClear = useCallback(() => {
    inputRef.current?.replaceText("");
    onChangeText("");
  }, [onChangeText]);

  return (
    <div className="flex max-w-[420px] min-w-0 flex-1 flex-row items-center gap-2 rounded-[10px] border border-input bg-background px-2.5 py-1.5 text-muted-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:py-[5px] dark:bg-input/30">
      <Search size={14} className="shrink-0" />
      <TextInput
        testID={testID}
        ref={inputRef}
        initialValue={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        enterKeyHint="search"
        className="h-5 min-w-0 flex-1 bg-transparent p-0 text-sm leading-[normal] text-foreground outline-none placeholder:text-muted-foreground"
      />
      {value.length > 0 ? (
        <button
          type="button"
          data-testid={clearTestID}
          onClick={handleClear}
          aria-label={clearAccessibilityLabel}
          // hitSlop 8, as packages/app's Pressable
          className="-m-2 flex shrink-0 p-2"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
