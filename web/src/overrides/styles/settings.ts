// Override of packages/app/src/styles/settings.ts: the same keys as class strings, so a settings
// page port turns `style={settingsStyles.row}` into `className={settingsStyles.row}`. Values are
// the Expo file's: a 14px-radius hairline card, 56px rows split by the border colour.
export const settingsStyles = {
  section: "mb-6",
  sectionHeader: "mb-3 ml-1 flex flex-row items-center justify-between",
  sectionHeaderTitle: "text-xs text-muted-foreground",
  sectionHeaderLink: "flex flex-row items-center gap-1",
  sectionHeaderLinkText: "text-xs text-muted-foreground",
  card: "flex flex-col overflow-hidden rounded-[14px] border bg-card",
  row: "flex min-h-14 flex-row items-center justify-between px-4 py-3",
  rowBorder: "border-t",
  rowContent: "mr-3 flex min-w-0 flex-1 flex-col",
  rowTitle: "text-sm leading-[normal] text-foreground",
  rowHint: "mt-1 text-xs text-muted-foreground",
  rowError: "mt-1 text-xs text-destructive",
} as const;
