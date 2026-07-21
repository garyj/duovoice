import { describe, expect, it } from "vitest";

import { SESSION_CONFIG } from "../src/session-config";

describe("interpreter session configuration", () => {
  it("uses the Playground-style interpreter behavior", () => {
    expect(SESSION_CONFIG).toMatchObject({
      type: "realtime",
      model: "gpt-realtime-2.1",
      output_modalities: ["audio"],
      audio: {
        input: {
          transcription: { model: "gpt-realtime-whisper" },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "auto",
            create_response: false,
            interrupt_response: true,
          },
        },
        output: { voice: "marin" },
      },
      reasoning: { effort: "low" },
    });
    expect(SESSION_CONFIG.instructions).toContain(
      "English input must become natural Brazilian Portuguese",
    );
    expect(SESSION_CONFIG.instructions).toContain(
      "Brazilian Portuguese input must become natural English",
    );
  });
});
