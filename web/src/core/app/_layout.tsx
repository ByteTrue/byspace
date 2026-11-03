// Port of archive/expo-app:packages/app/src/app/_layout.tsx. Shared routes and boundaries import the startup
// hooks from the Expo root layout; on the web the layout itself is web/src/app/root.tsx, and these
// are the same hooks with the same give-up timing.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  bindHostRuntimeAppState,
  shouldRunStartupGiveUpTimer,
  startHostRuntimeBootstrap,
} from "@/navigation/host-runtime-bootstrap";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { AppState } from "~/lib/app-state";

export interface HostRuntimeBootstrapState {
  splashError: string | null;
  retry: () => void;
  hasGivenUpWaitingForHost: boolean;
  storeReady: boolean;
}

const HostRuntimeBootstrapContext = createContext<HostRuntimeBootstrapState>({
  splashError: null,
  retry: () => {},
  hasGivenUpWaitingForHost: false,
  storeReady: false,
});

export function useEarliestOnlineHostServerId(): string | null {
  const store = getHostRuntimeStore();
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribeAll = store.subscribeAll(listener);
      const unsubscribeHostList = store.subscribeHostList(listener);
      return () => {
        unsubscribeAll();
        unsubscribeHostList();
      };
    },
    [store],
  );
  return useSyncExternalStore(
    subscribe,
    () => store.getEarliestOnlineHostServerId(),
    () => store.getEarliestOnlineHostServerId(),
  );
}

const STARTUP_GIVE_UP_TIMEOUT_MS = 5_000;

export function HostRuntimeBootstrapProvider({ children }: { children: ReactNode }) {
  useEffect(() => bindHostRuntimeAppState(getHostRuntimeStore(), AppState), []);
  useEffect(() => {
    startHostRuntimeBootstrap({ store: getHostRuntimeStore() });
  }, []);

  const anyOnlineHostServerId = useEarliestOnlineHostServerId();
  const [hasGivenUpWaitingForHost, setHasGivenUpWaitingForHost] = useState(false);
  const shouldRunGiveUpTimer = shouldRunStartupGiveUpTimer({
    anyOnlineHostServerId,
    hasGivenUpWaitingForHost,
  });

  useEffect(() => {
    if (!shouldRunGiveUpTimer) return;
    const handle = setTimeout(() => setHasGivenUpWaitingForHost(true), STARTUP_GIVE_UP_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, [shouldRunGiveUpTimer]);

  // boot() caches its promise; retry only resets the give-up gate so the startup route
  // re-evaluates once hosts change.
  const retry = useCallback(() => setHasGivenUpWaitingForHost(false), []);

  const state = useMemo<HostRuntimeBootstrapState>(
    () => ({ splashError: null, retry, hasGivenUpWaitingForHost, storeReady: true }),
    [retry, hasGivenUpWaitingForHost],
  );

  return (
    <HostRuntimeBootstrapContext.Provider value={state}>
      {children}
    </HostRuntimeBootstrapContext.Provider>
  );
}

export function useStoreReady(): boolean {
  return useContext(HostRuntimeBootstrapContext).storeReady;
}

export function useHostRuntimeBootstrapState(): HostRuntimeBootstrapState {
  return useContext(HostRuntimeBootstrapContext);
}
