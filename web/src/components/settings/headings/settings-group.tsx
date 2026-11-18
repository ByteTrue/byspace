// Port of archive/expo-app:packages/app/src/components/settings/headings/settings-group.tsx: a titled group
// above one or more SettingsSection blocks.
import type { CSSProperties, ReactNode } from "react";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";

interface SettingsGroupProps {
  title: string;
  info?: ReactNode;
  trailing?: ReactNode;
  testID?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function SettingsGroup({
  title,
  info,
  trailing,
  testID,
  style,
  children,
}: SettingsGroupProps) {
  return (
    <div className="mb-8 flex flex-col" style={style} data-testid={testID}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm leading-[normal] text-foreground">{title}</span>
          {info ? (
            <SettingsInfoTip
              title={title}
              info={info}
              testID={testID ? `${testID}-info` : undefined}
            />
          ) : null}
        </div>
        {trailing}
      </div>
      {children}
    </div>
  );
}
