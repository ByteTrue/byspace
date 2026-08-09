import { useEffect, useState } from "react";
import { subscribeToRelativeTimeTick } from "@/utils/relative-time-ticker";
import { describeCompactTimeAgo } from "@/utils/time";

export function useCompactTimeAgo(date: Date | null): string {
  const [label, setLabel] = useState(() => (date ? describeCompactTimeAgo(date).label : ""));
  const time = date?.getTime() ?? null;

  useEffect(() => {
    if (time === null) {
      setLabel("");
      return;
    }
    const source = new Date(time);
    let current = describeCompactTimeAgo(source);
    setLabel(current.label);
    let unsubscribe: (() => void) | null = null;

    const attach = () => {
      if (current.resolution === "static") return;
      unsubscribe = subscribeToRelativeTimeTick(current.resolution, handleTick);
    };
    const handleTick = () => {
      const next = describeCompactTimeAgo(source);
      if (next.label !== current.label) setLabel(next.label);
      if (next.resolution !== current.resolution) {
        unsubscribe?.();
        unsubscribe = null;
        current = next;
        attach();
      } else {
        current = next;
      }
    };

    attach();
    return () => unsubscribe?.();
  }, [time]);

  return label;
}
