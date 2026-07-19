"""Generate TTS fixtures for the translation probe (issue #1, plan Phase 2).

These are *interim* fixtures: clean TTS speech, not the real
phone-speaker -> room -> laptop-mic path a live call produces (that recording
replaces these later, per the plan). They exist so the probe has something to
stream today.

Calls the OpenAI TTS API (a few cents) and writes 24 kHz / mono / 16-bit PCM
WAVs - exactly the format the realtime translations endpoint expects, so the
probe streams the raw frames through untouched.

    uv run python fixtures/generate.py
"""

import os
import sys
import wave
from pathlib import Path

import httpx
from dotenv import load_dotenv

SAMPLE_RATE = 24_000
TTS_MODEL = "gpt-4o-mini-tts"
SPEECH_URL = "https://api.openai.com/v1/audio/speech"

# One English speaker and one Portuguese speaker, different voices so a mixed
# recording sounds like two people. Numbers + an address are deliberate: they
# are on the live-call acceptance checklist, so the probe exercises them early.
FIXTURES = {
    "en_greeting": {
        "voice": "ash",
        "text": (
            "Hey, can you hear me okay? I'll be there around seven thirty, "
            "at forty-two Bourke Street."
        ),
    },
    "pt_greeting": {
        "voice": "coral",
        "text": (
            "Oi, tudo bem? Cheguei em casa agora. Me liga quando você puder, tá bom?"
        ),
    },
}


def synth(text: str, voice: str, key: str) -> bytes:
    """Return raw PCM16 mono 24 kHz little-endian bytes for one utterance."""
    resp = httpx.post(
        SPEECH_URL,
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": TTS_MODEL,
            "voice": voice,
            "input": text,
            "response_format": "pcm",
        },
        timeout=60.0,
    )
    resp.raise_for_status()
    return resp.content


def write_wav(path: Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    load_dotenv(root / ".env.local")
    load_dotenv(root / ".env")
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        sys.exit("OPENAI_API_KEY not set (see .env.example)")

    out_dir = Path(__file__).resolve().parent
    for name, spec in FIXTURES.items():
        pcm = synth(spec["text"], spec["voice"], key)
        path = out_dir / f"{name}.wav"
        write_wav(path, pcm)
        seconds = len(pcm) / (SAMPLE_RATE * 2)
        print(
            f"wrote {path.name}  ({seconds:.1f}s, {len(pcm):,} B)  voice={spec['voice']}"
        )


if __name__ == "__main__":
    main()
