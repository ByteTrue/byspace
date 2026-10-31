// A bottom drawer that rests at snap points, as fractions of the screen ([0.6, 0.9]). It opens at
// the first, can be dragged to the others, and sizes its content to the snap it rests at, so a
// footer or the end of a list stays on screen instead of below it. vaul measures snap points from a
// drawer whose top is the top of the screen, so the drawer itself is full height.
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "cn";
import { Drawer, DrawerContent } from "~/components/ui/drawer";

export function SnapDrawer({
  open,
  onOpenChange,
  snapPoints,
  onAnimationEnd,
  className,
  bodyClassName,
  children,
  ...contentProps
}: Omit<ComponentProps<typeof DrawerContent>, "children" | "onAnimationEnd"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapPoints: readonly number[];
  /** After the open or close animation, with the new open state. */
  onAnimationEnd?: (open: boolean) => void;
  /** Classes for the content area under the handle; `className` styles the drawer itself. */
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [snap, setSnap] = useState<number | string | null>(snapPoints[0] ?? null);
  useEffect(() => {
    if (open) setSnap(snapPoints[0] ?? null);
  }, [open, snapPoints]);
  const fraction = typeof snap === "number" ? snap : (snapPoints[0] ?? 1);
  const points = useMemo(() => [...snapPoints], [snapPoints]);
  const bodyStyle = useMemo(() => ({ height: `calc(${fraction * 100}dvh - 1.5rem)` }), [fraction]);
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={points}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      fadeFromIndex={0}
      onAnimationEnd={onAnimationEnd}
    >
      <DrawerContent
        {...contentProps}
        className={cn(
          "h-full data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-none",
          className,
        )}
      >
        <div
          className={cn("flex min-h-0 flex-col transition-[height] duration-200", bodyClassName)}
          style={bodyStyle}
        >
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
