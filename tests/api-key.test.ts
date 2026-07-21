import { describe, expect, it } from "vitest";

import {
  clearOpenAiKey,
  type KeyStorage,
  loadOpenAiKey,
  saveOpenAiKey,
} from "../src/api-key";

function memoryStorage(): KeyStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("OpenAI API key storage", () => {
  it("saves and loads a trimmed key", () => {
    const storage = memoryStorage();

    saveOpenAiKey("  sk-personal  ", storage);

    expect(loadOpenAiKey(storage)).toBe("sk-personal");
  });

  it("clears the saved key", () => {
    const storage = memoryStorage();
    saveOpenAiKey("sk-personal", storage);

    clearOpenAiKey(storage);

    expect(loadOpenAiKey(storage)).toBe("");
  });
});
