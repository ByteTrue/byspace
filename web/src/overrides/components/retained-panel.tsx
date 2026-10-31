// Override of packages/app/src/components/retained-panel.tsx: same API, rendered as a div. An
// inactive panel stays mounted but is hidden and inert.
import { createContext, memo, useContext, type CSSProperties, type ReactNode } from "react";

const RetainedPanelActiveContext = createContext(true);

export function useRetainedPanelActive(): boolean {
  return useContext(RetainedPanelActiveContext);
}

interface RetainedPanelActivityProps {
  active: boolean;
  children: ReactNode;
}

export function RetainedPanelActivity({ active, children }: RetainedPanelActivityProps) {
  const parentActive = useRetainedPanelActive();
  return (
    <RetainedPanelActiveContext value={parentActive && active}>
      {children}
    </RetainedPanelActiveContext>
  );
}

interface RetainedPanelProps {
  active: boolean;
  children: ReactNode;
  style?: CSSProperties;
  testID?: string;
}

export const RetainedPanel = memo(function RetainedPanel({
  active,
  children,
  style,
  testID,
}: RetainedPanelProps) {
  return (
    <RetainedPanelActivity active={active}>
      <div
        className={active ? "flex min-h-0 flex-1 flex-col" : "hidden"}
        style={style}
        data-testid={testID}
        inert={!active}
      >
        {children}
      </div>
    </RetainedPanelActivity>
  );
});
