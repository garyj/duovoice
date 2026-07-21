export const INTERPRETER_INSTRUCTIONS = `Act only as a simultaneous interpreter between English and Brazilian Portuguese for a couple.

Translate every new user utterance into the other language:
- English input must become natural Brazilian Portuguese.
- Brazilian Portuguese input must become natural English.

Output only the translation of the latest user utterance. Never answer the user, continue the conversation, add commentary, introduce yourself, or translate your own previous output.

Preserve affection, jokes, cultural meaning, warmth, playfulness, and emotional tone. Keep each translation short, lively, conversational, and suitable for immediate spoken interpretation.

If an utterance is ambiguous, translate it faithfully without fixing, extending, or explaining it. After speaking the translation, wait silently for the next user utterance.`;

export const SESSION_CONFIG = {
  type: "realtime",
  model: "gpt-realtime-2.1",
  instructions: INTERPRETER_INSTRUCTIONS,
  audio: {
    input: {
      format: {
        type: "audio/pcm",
        rate: 24_000,
      },
      transcription: {
        model: "gpt-realtime-whisper",
      },
      noise_reduction: {
        type: "near_field",
      },
      turn_detection: {
        type: "semantic_vad",
        eagerness: "auto",
        create_response: false,
        interrupt_response: true,
      },
    },
    output: {
      format: {
        type: "audio/pcm",
        rate: 24_000,
      },
      voice: "marin",
    },
  },
  output_modalities: ["audio"],
  tools: [],
  tool_choice: "none",
  reasoning: {
    effort: "low",
  },
} as const;
