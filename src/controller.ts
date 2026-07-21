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
  onDiagnostic: (eventType: string) => void;
  onInputTranscript: (update: TranscriptUpdate) => void;
  onMicrophone: (settings: MediaTrackSettings) => void;
  onMilestone: (milestone: Milestone) => void;
  onOutputState: (playing: boolean) => void;
  onOutputTranscript: (update: TranscriptUpdate) => void;
  onState: (state: LifecycleState, detail?: string) => void;
}

const MAX_RECONNECT_DELAY_MS = 10_000;
const RECONNECT_BEFORE_EXPIRY_MS = 60_000;

export class InterpreterController {
  private apiKey = "";
  private readonly audioElement: HTMLAudioElement;
  private readonly callbacks: InterpreterControllerCallbacks;
  private expiryTimer: number | undefined;
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

  async start(apiKey: string): Promise<void> {
    if (this.state !== "idle" && this.state !== "error") {
      return;
    }

    this.releaseResources();
    this.apiKey = apiKey;
    const runId = ++this.runId;
    this.reconnectAttempts = 0;
    this.setState("connecting");

    try {
      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (runId !== this.runId) {
        this.stopTracks(microphone);
        return;
      }

      this.microphone = microphone;
      const [track] = microphone.getAudioTracks();
      if (!track) {
        throw new Error("No microphone audio track is available");
      }
      track.addEventListener("ended", () => this.handleMicrophoneEnded(runId, track), {
        once: true,
      });
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
    const [track] = this.microphone?.getAudioTracks() ?? [];
    if (!this.microphone || !track || track.readyState !== "live") {
      throw new Error("Microphone capture ended before the session connected");
    }

    this.closeSession();
    const sessionAbort = new AbortController();
    this.sessionAbort = sessionAbort;

    const callbacks: InterpreterSessionCallbacks = {
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
      onOutputState: this.callbacks.onOutputState,
      onOutputTranscript: this.callbacks.onOutputTranscript,
    };

    const session = await openInterpreterSession({
      apiKey: this.apiKey,
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

    const [track] = this.microphone?.getAudioTracks() ?? [];
    if (track?.readyState !== "live") {
      this.releaseResources();
      this.setState("error", "Microphone capture ended");
      return;
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(
      2 ** (this.reconnectAttempts - 1) * 1_000,
      MAX_RECONNECT_DELAY_MS,
    );
    this.setState("reconnecting", `${reason}. Retrying in ${delay / 1_000} seconds`);
    window.clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
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
    window.clearTimeout(this.expiryTimer);
    this.expiryTimer = window.setTimeout(() => {
      this.expiryTimer = undefined;
      this.requestReconnect(runId, "Refreshing the expiring interpreter session");
    }, delay);
  }

  private handleMicrophoneEnded(runId: number, track: MediaStreamTrack): void {
    if (runId !== this.runId || !this.microphone?.getAudioTracks().includes(track)) {
      return;
    }

    ++this.runId;
    this.releaseResources();
    this.setState("error", "Microphone disconnected");
  }

  private closeSession(): void {
    this.sessionAbort?.abort();
    this.sessionAbort = undefined;
    this.session?.close();
    this.session = undefined;
    this.expiresAt = undefined;
  }

  private releaseResources(): void {
    window.clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
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
