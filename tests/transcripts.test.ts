import { describe, expect, it } from "vitest";

import { Transcripts } from "../src/transcripts";

describe("Transcripts", () => {
  it("keeps source and target text independent", () => {
    const transcripts = new Transcripts();

    transcripts.appendSource("Can you hear me?");
    transcripts.appendTranslation("pt", "Você consegue me ouvir?");
    const snapshot = transcripts.appendTranslation("en", "Good evening.");

    expect(snapshot).toEqual({
      source: "Can you hear me?",
      pt: "Você consegue me ouvir?",
      en: "Good evening.",
    });
  });

  it("returns copies and clears all text", () => {
    const transcripts = new Transcripts();
    const first = transcripts.appendSource("hello");

    first.source = "changed outside";

    expect(transcripts.snapshot().source).toBe("hello");
    expect(transcripts.clear()).toEqual({ source: "", en: "", pt: "" });
  });

  it("retains only the latest six thousand characters", () => {
    const transcripts = new Transcripts();

    const snapshot = transcripts.appendTranslation("pt", `old${"x".repeat(6_000)}`);

    expect(snapshot.pt).toHaveLength(6_000);
    expect(snapshot.pt).toBe("x".repeat(6_000));
  });
});
