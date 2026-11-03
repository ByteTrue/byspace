import { useCallback, useState } from "react";

interface Retained<P> {
  props: P | null;
  generation: number;
  visible: boolean;
}

/**
 * A sheet's props while it is open, kept through its exit animation after the parent closes it, so
 * the closing sheet still shows what it showed. `generation` counts the opens: key the sheet's body
 * on it, so a reopen (even one during the exit animation) starts a fresh form. Call `release` when
 * the exit animation is over.
 */
export function useRetainedOpenProps<P extends { visible: boolean }>(props: P) {
  const [last, setLast] = useState<Retained<P>>(() => ({
    props: props.visible ? props : null,
    generation: 0,
    visible: props.visible,
  }));
  // Adjusted during render, so a reopen never shows the closing form for a frame.
  let current = last;
  if (props.visible && (last.props !== props || !last.visible)) {
    current = {
      props,
      generation: last.visible ? last.generation : last.generation + 1,
      visible: true,
    };
    setLast(current);
  } else if (!props.visible && last.visible) {
    current = { ...last, visible: false };
    setLast(current);
  }
  const release = useCallback(
    () => setLast((state) => (state.visible ? state : { ...state, props: null })),
    [],
  );
  return { retained: current.props, generation: current.generation, release };
}
