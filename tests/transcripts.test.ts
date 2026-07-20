import { describe, expect, it } from "vitest";

import { Transcripts } from "../src/transcripts";

describe("Transcripts", () => {
  it("keeps heard speech and interpretation independent", () => {
    const transcripts = new Transcripts();

    transcripts.updateHeard({ id: "input-1", text: "Can you hear me?", final: true });
    const snapshot = transcripts.updateTranslation({
      id: "output-1",
      text: "Você consegue me ouvir?",
      final: true,
    });

    expect(snapshot).toEqual({
      heard: "Can you hear me?",
      translation: "Você consegue me ouvir?",
    });
  });

  it("assembles deltas and replaces them with the final transcript", () => {
    const transcripts = new Transcripts();

    transcripts.updateHeard({ id: "input-1", text: "Você ", final: false });
    transcripts.updateHeard({ id: "input-1", text: "vai", final: false });
    const snapshot = transcripts.updateHeard({
      id: "input-1",
      text: "Você vai dormir?",
      final: true,
    });

    expect(snapshot.heard).toBe("Você vai dormir?");
  });

  it("separates successive spoken turns", () => {
    const transcripts = new Transcripts();

    transcripts.updateTranslation({ id: "output-1", text: "Hello.", final: true });
    const snapshot = transcripts.updateTranslation({
      id: "output-2",
      text: "Good night.",
      final: true,
    });

    expect(snapshot.translation).toBe("Hello.\n\nGood night.");
  });

  it("retains only the latest six thousand characters", () => {
    const transcripts = new Transcripts();

    const snapshot = transcripts.updateTranslation({
      id: "output-1",
      text: `old${"x".repeat(6_000)}`,
      final: true,
    });

    expect(snapshot.translation).toHaveLength(6_000);
    expect(snapshot.translation).toBe("x".repeat(6_000));
  });

  it("clears both transcript columns", () => {
    const transcripts = new Transcripts();
    transcripts.updateHeard({ id: "input-1", text: "hello", final: true });

    expect(transcripts.clear()).toEqual({ heard: "", translation: "" });
  });
});
