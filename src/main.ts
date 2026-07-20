import { type LifecycleState, TranslationController } from "./controller";
import type { Milestone, SessionMilestone, TargetLanguage } from "./realtime";
import { type TranscriptSnapshot, Transcripts } from "./transcripts";
import "./styles.css";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const startButton = requiredElement<HTMLButtonElement>("#start");
const stopButton = requiredElement<HTMLButtonElement>("#stop");
const status = requiredElement<HTMLOutputElement>("#status");
const statusDetail = requiredElement<HTMLElement>("#status-detail");
const sourceText = requiredElement<HTMLElement>("#source-text");
const englishText = requiredElement<HTMLElement>("#english-text");
const portugueseText = requiredElement<HTMLElement>("#portuguese-text");
const diagnostics = requiredElement<HTMLElement>("#diagnostics");
const microphoneDetails = requiredElement<HTMLElement>("#microphone-details");
const englishAudio = requiredElement<HTMLAudioElement>("#english-audio");
const portugueseAudio = requiredElement<HTMLAudioElement>("#portuguese-audio");

const transcripts = new Transcripts();
const milestones = new Map<string, Milestone>();
const recentEvents: string[] = [];

const stateLabels: Record<LifecycleState, string> = {
  connecting: "Connecting",
  error: "Needs attention",
  idle: "Ready",
  listening: "Listening",
  reconnecting: "Reconnecting",
  stopping: "Stopping",
};

function renderTranscripts(snapshot: TranscriptSnapshot) {
  sourceText.textContent = snapshot.source || "English speech will appear here.";
  englishText.textContent =
    snapshot.en || "Portuguese speech will appear here in English.";
  portugueseText.textContent =
    snapshot.pt || "English speech will appear here in Brazilian Portuguese.";

  for (const element of [sourceText, englishText, portugueseText]) {
    element.scrollTop = element.scrollHeight;
  }
}

function renderDiagnostics() {
  const milestoneLines = [...milestones.values()]
    .sort((left, right) => left.elapsedMs - right.elapsedMs)
    .map(
      ({ elapsedMs, name, target }) =>
        `${target.toUpperCase()} ${name}: ${elapsedMs} ms`,
    );
  diagnostics.textContent = [...milestoneLines, ...recentEvents].join("\n");
}

function milestoneKey(target: TargetLanguage, name: SessionMilestone): string {
  return `${target}:${name}`;
}

function handleState(state: LifecycleState, detail?: string) {
  document.body.dataset.state = state;
  status.textContent = stateLabels[state];
  statusDetail.textContent = detail ?? "";

  const active =
    state === "connecting" || state === "listening" || state === "reconnecting";
  startButton.disabled = active || state === "stopping";
  stopButton.disabled = !active;
}

const controller = new TranslationController(
  {
    en: englishAudio,
    pt: portugueseAudio,
  },
  {
    onDiagnostic: (target, eventType) => {
      recentEvents.push(`${target.toUpperCase()} ${eventType}`);
      recentEvents.splice(0, Math.max(0, recentEvents.length - 20));
      renderDiagnostics();
    },
    onMicrophone: (settings) => {
      microphoneDetails.textContent = [
        `${settings.sampleRate ?? "unknown"} Hz`,
        `${settings.channelCount ?? "unknown"} channel`,
        `echo cancellation ${settings.echoCancellation ? "on" : "off"}`,
        `noise suppression ${settings.noiseSuppression ? "on" : "off"}`,
      ].join(", ");
    },
    onMilestone: (milestone) => {
      const key = milestoneKey(milestone.target, milestone.name);
      if (!milestones.has(key)) {
        milestones.set(key, milestone);
        renderDiagnostics();
      }
    },
    onSourceTranscript: (delta) => {
      renderTranscripts(transcripts.appendSource(delta));
    },
    onState: handleState,
    onTranslationTranscript: (target, delta) => {
      renderTranscripts(transcripts.appendTranslation(target, delta));
    },
  },
);

startButton.addEventListener("click", () => {
  milestones.clear();
  recentEvents.length = 0;
  microphoneDetails.textContent = "Waiting for microphone";
  renderTranscripts(transcripts.clear());
  renderDiagnostics();
  void controller.start();
});

stopButton.addEventListener("click", () => controller.stop());
window.addEventListener("pagehide", () => controller.stop());

renderTranscripts(transcripts.snapshot());
handleState("idle");
