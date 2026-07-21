const STORAGE_KEY = "sther.openai-api-key";

export interface KeyStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export function loadOpenAiKey(storage: KeyStorage = localStorage): string {
  return storage.getItem(STORAGE_KEY)?.trim() ?? "";
}

export function saveOpenAiKey(
  apiKey: string,
  storage: KeyStorage = localStorage,
): void {
  storage.setItem(STORAGE_KEY, apiKey.trim());
}

export function clearOpenAiKey(storage: KeyStorage = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}
