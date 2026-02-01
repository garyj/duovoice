const STORAGE_KEYS = {
  gemini: 'duovoice.gemini_api_key',
  openai: 'duovoice.openai_api_key',
};

let storageAvailable: boolean | null = null;

export function isStorageAvailable(): boolean {
  if (storageAvailable !== null) return storageAvailable;
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      storageAvailable = false;
      return false;
    }
    const testKey = '__duovoice_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    storageAvailable = true;
    return true;
  } catch (err) {
    storageAvailable = false;
    return false;
  }
}

function getKey(key: string): string | null {
  if (!isStorageAvailable()) return null;
  const value = window.localStorage.getItem(key);
  return value && value.trim() ? value : null;
}

function setKey(key: string, value: string): void {
  if (!isStorageAvailable()) return;
  const trimmed = value.trim();
  if (!trimmed) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, trimmed);
}

function clearKey(key: string): void {
  if (!isStorageAvailable()) return;
  window.localStorage.removeItem(key);
}

export function getGeminiKey(): string | null {
  return getKey(STORAGE_KEYS.gemini);
}

export function setGeminiKey(value: string): void {
  setKey(STORAGE_KEYS.gemini, value);
}

export function clearGeminiKey(): void {
  clearKey(STORAGE_KEYS.gemini);
}

export function getOpenAiKey(): string | null {
  return getKey(STORAGE_KEYS.openai);
}

export function setOpenAiKey(value: string): void {
  setKey(STORAGE_KEYS.openai, value);
}

export function clearOpenAiKey(): void {
  clearKey(STORAGE_KEYS.openai);
}
