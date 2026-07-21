import { clearOpenAiKey, loadOpenAiKey, saveOpenAiKey } from "./api-key";
import { InterpreterController, type LifecycleState } from "./controller";
import type { Milestone, SessionMilestone } from "./realtime";
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
const credentials = requiredElement<HTMLDetailsElement>("#credentials");
const apiKeyForm = requiredElement<HTMLFormElement>("#api-key-form");
const apiKeyInput = requiredElement<HTMLInputElement>("#api-key");
const apiKeyStatus = requiredElement<HTMLElement>("#api-key-status");
const clearApiKeyButton = requiredElement<HTMLButtonElement>("#clear-api-key");
const saveApiKeyButton = requiredElement<HTMLButtonElement>("#save-api-key");
const status = requiredElement<HTMLOutputElement>("#status");
const statusDetail = requiredElement<HTMLElement>("#status-detail");
const heardText = requiredElement<HTMLElement>("#heard-text");
const translationText = requiredElement<HTMLElement>("#translation-text");
const diagnostics = requiredElement<HTMLElement>("#diagnostics");
const microphoneDetails = requiredElement<HTMLElement>("#microphone-details");
const interpreterAudio = requiredElement<HTMLAudioElement>("#interpreter-audio");

const transcripts = new Transcripts();
const milestones = new Map<SessionMilestone, Milestone>();
const recentEvents: string[] = [];
let lifecycleState: LifecycleState = "idle";
let lifecycleDetail = "";
let outputPlaying = false;

const stateLabels: Record<LifecycleState, string> = {
  connecting: "Connecting",
  error: "Needs attention",
  idle: "Ready",
  listening: "Listening",
  reconnecting: "Reconnecting",
  stopping: "Stopping",
};

function renderTranscripts(snapshot: TranscriptSnapshot) {
  heardText.textContent = snapshot.heard || "Speech will appear here.";
  translationText.textContent =
    snapshot.translation || "The interpretation will appear here.";

  for (const element of [heardText, translationText]) {
    element.scrollTop = element.scrollHeight;
  }
}

function renderDiagnostics() {
  const milestoneLines = [...milestones.values()]
    .sort((left, right) => left.elapsedMs - right.elapsedMs)
    .map(({ elapsedMs, name }) => `${name}: ${elapsedMs} ms`);
  diagnostics.textContent = [...milestoneLines, ...recentEvents].join("\n");
}

function renderState() {
  document.body.dataset.state = lifecycleState;
  const interpreting = lifecycleState === "listening" && outputPlaying;
  status.textContent = interpreting ? "Interpreting" : stateLabels[lifecycleState];
  statusDetail.textContent = interpreting
    ? "Keep speaking to interrupt"
    : lifecycleDetail;

  const active =
    lifecycleState === "connecting" ||
    lifecycleState === "listening" ||
    lifecycleState === "reconnecting";
  startButton.disabled = active || lifecycleState === "stopping";
  stopButton.disabled = !active;
  apiKeyInput.disabled = active;
  clearApiKeyButton.disabled = active;
  saveApiKeyButton.disabled = active;
}

function renderApiKey() {
  const saved = Boolean(loadOpenAiKey());
  apiKeyStatus.textContent = saved ? "Saved in this browser" : "Not saved";
}

const controller = new InterpreterController(interpreterAudio, {
  onDiagnostic: (eventType) => {
    recentEvents.push(eventType);
    recentEvents.splice(0, Math.max(0, recentEvents.length - 24));
    renderDiagnostics();
  },
  onInputTranscript: (update) => {
    renderTranscripts(transcripts.updateHeard(update));
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
    if (!milestones.has(milestone.name)) {
      milestones.set(milestone.name, milestone);
      renderDiagnostics();
    }
  },
  onOutputState: (playing) => {
    outputPlaying = playing;
    renderState();
  },
  onOutputTranscript: (update) => {
    renderTranscripts(transcripts.updateTranslation(update));
  },
  onState: (state, detail) => {
    lifecycleState = state;
    lifecycleDetail = detail ?? "";
    renderState();
  },
});

startButton.addEventListener("click", () => {
  const apiKey = loadOpenAiKey();
  if (!apiKey) {
    credentials.open = true;
    apiKeyInput.focus();
    lifecycleDetail = "Add an OpenAI API key first";
    renderState();
    return;
  }

  milestones.clear();
  recentEvents.length = 0;
  outputPlaying = false;
  microphoneDetails.textContent = "Waiting for microphone";
  renderTranscripts(transcripts.clear());
  renderDiagnostics();
  void controller.start(apiKey);
});

stopButton.addEventListener("click", () => controller.stop());
apiKeyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    apiKeyStatus.textContent = "Enter an API key";
    return;
  }
  saveOpenAiKey(apiKey);
  lifecycleDetail = "";
  renderApiKey();
  renderState();
  credentials.open = false;
});
clearApiKeyButton.addEventListener("click", () => {
  clearOpenAiKey();
  apiKeyInput.value = "";
  renderApiKey();
});
window.addEventListener("pagehide", () => controller.stop());

apiKeyInput.value = loadOpenAiKey();
renderApiKey();
renderTranscripts(transcripts.snapshot());
renderState();
