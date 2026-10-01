import AsyncStorage from "@react-native-async-storage/async-storage";

const RELAY_ENDPOINT_STORAGE_KEY = "@byspace:setup-guide-relay-endpoint-v1";

/**
 * Persists the self-hosted relay endpoint typed into the setup guide, so
 * revisits (new daemon, migration) start from the user's last value.
 */
export async function readStoredRelayEndpoint(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(RELAY_ENDPOINT_STORAGE_KEY)) ?? "";
  } catch {
    return "";
  }
}

export async function storeRelayEndpoint(value: string): Promise<void> {
  try {
    if (value.trim()) {
      await AsyncStorage.setItem(RELAY_ENDPOINT_STORAGE_KEY, value.trim());
    } else {
      await AsyncStorage.removeItem(RELAY_ENDPOINT_STORAGE_KEY);
    }
  } catch {
    // Best-effort persistence: the commands work without it.
  }
}
