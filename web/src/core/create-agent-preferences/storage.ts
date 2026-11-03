import localStorageAsync from "~/lib/local-storage-async";
import { readValidatedJson } from "@/storage/validated-storage";
import {
  FormPreferencesSchema,
  StoredFormPreferencesSchema,
  type FormPreferences,
} from "./preferences";

export const CREATE_AGENT_PREFERENCES_STORAGE_KEY = "@byspace:create-agent-preferences";

export interface CreateAgentPreferenceStorage {
  read(): Promise<unknown>;
  write(preferences: FormPreferences): Promise<void>;
}

export class LocalStorageCreateAgentPreferenceStorage implements CreateAgentPreferenceStorage {
  async read(): Promise<unknown> {
    return readValidatedJson(
      localStorageAsync,
      CREATE_AGENT_PREFERENCES_STORAGE_KEY,
      StoredFormPreferencesSchema,
    );
  }

  async write(preferences: FormPreferences): Promise<void> {
    const result = FormPreferencesSchema.safeParse(preferences);
    if (!result.success) {
      await localStorageAsync.removeItem(CREATE_AGENT_PREFERENCES_STORAGE_KEY);
      return;
    }
    await localStorageAsync.setItem(
      CREATE_AGENT_PREFERENCES_STORAGE_KEY,
      JSON.stringify(result.data),
    );
  }
}
