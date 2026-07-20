import {
  type InterpreterSession,
  type InterpreterSessionCallbacks,
  type Milestone,
  openInterpreterSession,
  type TranscriptUpdate,
} from "./realtime";

export type LifecycleState =
  | "idle"
  | "connecting"
  | "listening"
  | "reconnecting"
  | "stopping"
  | "error";

export interface InterpreterControllerCallbacks {
  onCaptureState: (enabled: boolean) => void;
  onDiagnostic: (eventType: string) => void;
  onInputTranscript: (update: TranscriptUpdate) => void;
  onMicrophone: (settings: MediaTrackSettings) => void;
  onMilestone: (milestone: Milestone) => void;
  onOutputTranscript: (update: TranscriptUpdate) => void;
  onState: (state: LifecycleState, detail?: string) => void;
}

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BEFORE_EXPIRY_MS = 60_000;

export class InterpreterController {
  private readonly audioElement: HTMLAudioElement;
  private readonly callbacks: InterpreterControllerCallbacks;
  private expiresAt: number | undefined;
  private microphone: MediaStream | undefined;
  private reconnectAttempts = 0;
  private reconnectTimer: number | undefined;
  private runId = 0;
  private session: InterpreterSession | undefined;
  private sessionAbort: AbortController | undefined;
  private state: LifecycleState = "idle";

  constructor(
    audioElement: HTMLAudioElement,
    callbacks: InterpreterControllerCallbacks,
  ) {
    this.audioElement = audioElement;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (this.state !== "idle" && this.state !== "error") {
      return;
    }

    this.releaseResources();
    const runId = ++this.runId;
    this.reconnectAttempts = 0;
    this.setState("connecting");

    try {
      this.microphone = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (runId !== this.runId) {
        this.stopTracks(this.microphone);
        return;
      }

      const [track] = this.microphone.getAudioTracks();
      if (!track) {
        throw new Error("No microphone audio track is available");
      }
      this.callbacks.onMicrophone(track.getSettings());
      await this.connect(runId);
    } catch (error) {
      if (runId !== this.runId) {
        return;
      }
      this.releaseResources();
      this.setState("error", this.errorMessage(error));
    }
  }

  stop(): void {
    if (this.state === "idle") {
      return;
    }

    ++this.runId;
    this.setState("stopping");
    this.releaseResources();
    this.setState("idle");
  }

  private async connect(runId: number): Promise<void> {
    if (!this.microphone) {
      throw new Error("Microphone capture ended before the session connected");
    }

    this.closeSession();
    const sessionAbort = new AbortController();
    this.sessionAbort = sessionAbort;

    const callbacks: InterpreterSessionCallbacks = {
      onCaptureState: this.callbacks.onCaptureState,
      onDiagnostic: this.callbacks.onDiagnostic,
      onExpiry: (expiry) => {
        if (this.sessionAbort !== sessionAbort) {
          return;
        }
        this.expiresAt = expiry;
        this.scheduleExpiryReconnect(runId);
      },
      onFailure: (error) => {
        if (this.sessionAbort === sessionAbort) {
          this.requestReconnect(runId, error.message);
        }
      },
      onInputTranscript: this.callbacks.onInputTranscript,
      onMilestone: this.callbacks.onMilestone,
      onOutputTranscript: this.callbacks.onOutputTranscript,
    };

    const session = await openInterpreterSession({
      audioElement: this.audioElement,
      callbacks,
      microphone: this.microphone,
      signal: sessionAbort.signal,
    });

    if (runId !== this.runId || this.sessionAbort !== sessionAbort) {
      session.close();
      return;
    }

    this.session = session;
    this.expiresAt = session.expiresAt;
    this.reconnectAttempts = 0;
    this.setState("listening");
    this.scheduleExpiryReconnect(runId);
  }

  private requestReconnect(runId: number, reason: string): void {
    if (
      runId !== this.runId ||
      this.state === "stopping" ||
      this.state === "idle" ||
      this.state === "error" ||
      this.reconnectTimer !== undefined
    ) {
      return;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.releaseResources();
      this.setState("error", `Interpreter stopped after repeated failures: ${reason}`);
      return;
    }

    this.reconnectAttempts += 1;
    const delay = 2 ** (this.reconnectAttempts - 1) * 1_000;
    this.setState("reconnecting", `${reason}. Retrying in ${delay / 1_000} seconds`);
    this.closeSession();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect(runId).catch((error: unknown) => {
        if (runId === this.runId) {
          this.requestReconnect(runId, this.errorMessage(error));
        }
      });
    }, delay);
  }

  private scheduleExpiryReconnect(runId: number): void {
    if (!this.expiresAt || this.state !== "listening") {
      return;
    }

    const delay = Math.max(
      1_000,
      this.expiresAt * 1_000 - Date.now() - RECONNECT_BEFORE_EXPIRY_MS,
    );
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.requestReconnect(runId, "Refreshing the expiring interpreter session");
    }, delay);
  }

  private closeSession(): void {
    this.sessionAbort?.abort();
    this.sessionAbort = undefined;
    this.session?.close();
    this.session = undefined;
    this.expiresAt = undefined;
  }

  private releaseResources(): void {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.closeSession();
    this.stopTracks(this.microphone);
    this.microphone = undefined;
  }

  private stopTracks(stream: MediaStream | undefined): void {
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
  }

  private setState(state: LifecycleState, detail?: string): void {
    this.state = state;
    this.callbacks.onState(state, detail);
  }

  private errorMessage(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
  }
}
