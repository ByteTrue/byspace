import localStorageAsync from "~/lib/local-storage-async";

const RELAY_ENDPOINT_STORAGE_KEY = "@byspace:setup-guide-relay-endpoint-v1";

/**
 * Persists the self-hosted relay endpoint typed into the setup guide, so
 * revisits (new daemon, migration) start from the user's last value.
 */
export async function readStoredRelayEndpoint(): Promise<string> {
  try {
    return (await localStorageAsync.getItem(RELAY_ENDPOINT_STORAGE_KEY)) ?? "";
  } catch {
    return "";
  }
}

export async function storeRelayEndpoint(value: string): Promise<void> {
  try {
    if (value.trim()) {
      await localStorageAsync.setItem(RELAY_ENDPOINT_STORAGE_KEY, value.trim());
    } else {
      await localStorageAsync.removeItem(RELAY_ENDPOINT_STORAGE_KEY);
    }
  } catch {
    // Best-effort persistence: the commands work without it.
  }
}
