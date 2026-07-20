import type { TargetLanguage } from "./realtime";

export interface TranscriptSnapshot {
  en: string;
  pt: string;
  source: string;
}

const MAX_TRANSCRIPT_CHARACTERS = 6_000;

function appendRolling(current: string, delta: string): string {
  const next = current + delta;
  if (next.length <= MAX_TRANSCRIPT_CHARACTERS) {
    return next;
  }
  return next.slice(next.length - MAX_TRANSCRIPT_CHARACTERS);
}

export class Transcripts {
  private value: TranscriptSnapshot = {
    en: "",
    pt: "",
    source: "",
  };

  appendSource(delta: string): TranscriptSnapshot {
    this.value.source = appendRolling(this.value.source, delta);
    return this.snapshot();
  }

  appendTranslation(target: TargetLanguage, delta: string): TranscriptSnapshot {
    this.value[target] = appendRolling(this.value[target], delta);
    return this.snapshot();
  }

  clear(): TranscriptSnapshot {
    this.value = { en: "", pt: "", source: "" };
    return this.snapshot();
  }

  snapshot(): TranscriptSnapshot {
    return { ...this.value };
  }
}
