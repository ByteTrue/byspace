import { LayoutPanelLeft } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

export function HomePage() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayoutPanelLeft />
        </EmptyMedia>
        <EmptyTitle>Pick a workspace</EmptyTitle>
        <EmptyDescription>Open a workspace from the sidebar to see its agents.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
