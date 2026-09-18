import type { ResolveStreamRenderStrategyInput, StreamStrategy } from "./strategy";
import { createWebStreamStrategy } from "./strategy-web";

/** Web is the only JS runtime with a DOM, so the web strategy is always the one. */
export function resolveStreamRenderStrategy(
  input: ResolveStreamRenderStrategyInput,
): StreamStrategy {
  return createWebStreamStrategy({
    isMobileBreakpoint: input.isMobileBreakpoint,
  });
}
