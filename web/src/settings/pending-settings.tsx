import { Construction } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

// shortcut: settings pages and dialogs that land in a later batch of step 4 show this; each use
// is deleted when its page lands.
export function PendingSettingsPage({ title }: { title: string }) {
  return (
    <Empty className="min-h-60 rounded-[14px] border" data-testid="pending-settings-page">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Construction />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>This page moves to the new frontend later in step 4.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
