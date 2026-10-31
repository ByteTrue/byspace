import { Construction } from "lucide-react";
import { SidebarToggle } from "~/app/sidebar-toggle";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

// shortcut: pages that move over in later steps of the rewrite epic show this instead of a blank
// screen; every use is deleted when its page lands.
export function PlaceholderPage({ title, step }: { title: string; step: 3 | 4 }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarToggle host="content" />
      </header>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Construction />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>
            This page moves to the new frontend in step {step} of the rewrite.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
