import { Construction } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

// shortcut: workspace panels that move over in a later batch of step 3 show this; each use is
// deleted when its panel lands.
export function PendingPanel({ title }: { title: string }) {
  return (
    <Empty className="flex-1" data-testid="pending-panel">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Construction />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>
          This panel moves to the new frontend later in step 3 of the rewrite.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function CenteredMessage({ children }: { children: string }) {
  return <div className="flex flex-1 items-center justify-center p-4 text-sm">{children}</div>;
}
