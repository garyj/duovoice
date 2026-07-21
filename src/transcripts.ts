import type { TranscriptUpdate } from "./realtime";

export interface TranscriptSnapshot {
  heard: string;
  translation: string;
}

interface TranscriptEntry {
  id: string;
  text: string;
}

const MAX_TRANSCRIPT_CHARACTERS = 6_000;

function render(entries: TranscriptEntry[]): string {
  return entries
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function trim(entries: TranscriptEntry[]): void {
  while (entries.length > 1 && render(entries).length > MAX_TRANSCRIPT_CHARACTERS) {
    entries.shift();
  }

  const [entry] = entries;
  if (entry && entry.text.length > MAX_TRANSCRIPT_CHARACTERS) {
    entry.text = entry.text.slice(-MAX_TRANSCRIPT_CHARACTERS);
  }
}

function applyUpdate(entries: TranscriptEntry[], update: TranscriptUpdate): void {
  const existing = entries.find((entry) => entry.id === update.id);
  if (existing) {
    existing.text = update.final ? update.text : existing.text + update.text;
  } else {
    entries.push({ id: update.id, text: update.text });
  }
  trim(entries);
}

export class Transcripts {
  private heard: TranscriptEntry[] = [];
  private translation: TranscriptEntry[] = [];

  updateHeard(update: TranscriptUpdate): TranscriptSnapshot {
    applyUpdate(this.heard, update);
    return this.snapshot();
  }

  updateTranslation(update: TranscriptUpdate): TranscriptSnapshot {
    applyUpdate(this.translation, update);
    return this.snapshot();
  }

  clear(): TranscriptSnapshot {
    this.heard = [];
    this.translation = [];
    return this.snapshot();
  }

  snapshot(): TranscriptSnapshot {
    return {
      heard: render(this.heard),
      translation: render(this.translation),
    };
  }
}
