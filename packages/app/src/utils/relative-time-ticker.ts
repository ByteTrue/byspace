import type { RelativeTimeResolution } from "./time";

export type TickResolution = Exclude<RelativeTimeResolution, "static">;

const INTERVAL_MS: Record<TickResolution, number> = {
  minute: 60_000,
  hour: 30 * 60_000,
  day: 60 * 60_000,
};

interface Tier {
  listeners: Set<() => void>;
  timeout: ReturnType<typeof setTimeout> | null;
  interval: ReturnType<typeof setInterval> | null;
}

function createTier(): Tier {
  return { listeners: new Set(), timeout: null, interval: null };
}

const tiers: Record<TickResolution, Tier> = {
  minute: createTier(),
  hour: createTier(),
  day: createTier(),
};

function notify(tier: Tier): void {
  for (const listener of tier.listeners) listener();
}

function start(resolution: TickResolution): void {
  const tier = tiers[resolution];
  if (tier.timeout !== null || tier.interval !== null) return;
  const period = INTERVAL_MS[resolution];
  tier.timeout = setTimeout(
    () => {
      tier.timeout = null;
      notify(tier);
      tier.interval = setInterval(() => notify(tier), period);
    },
    period - (Date.now() % period),
  );
}

function stop(resolution: TickResolution): void {
  const tier = tiers[resolution];
  if (tier.timeout !== null) clearTimeout(tier.timeout);
  if (tier.interval !== null) clearInterval(tier.interval);
  tier.timeout = null;
  tier.interval = null;
}

export function subscribeToRelativeTimeTick(
  resolution: TickResolution,
  listener: () => void,
): () => void {
  const tier = tiers[resolution];
  tier.listeners.add(listener);
  if (tier.listeners.size === 1) start(resolution);
  return () => {
    tier.listeners.delete(listener);
    if (tier.listeners.size === 0) stop(resolution);
  };
}
