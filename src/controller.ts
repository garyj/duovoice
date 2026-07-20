import {
  type Milestone,
  openTranslationSession,
  type TargetLanguage,
  type TranslationSession,
  type TranslationSessionCallbacks,
} from "./realtime";

export type LifecycleState =
  | "idle"
  | "connecting"
  | "listening"
  | "reconnecting"
  | "stopping"
  | "error";

export interface TranslationControllerCallbacks {
  onDiagnostic: (target: TargetLanguage, eventType: string) => void;
  onMicrophone: (settings: MediaTrackSettings) => void;
  onMilestone: (milestone: Milestone) => void;
  onSourceTranscript: (delta: string) => void;
  onState: (state: LifecycleState, detail?: string) => void;
  onTranslationTranscript: (target: TargetLanguage, delta: string) => void;
}

interface TranslationAudioElements {
  en: HTMLAudioElement;
  pt: HTMLAudioElement;
}

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BEFORE_EXPIRY_MS = 60_000;

export class TranslationController {
  private readonly audioElements: TranslationAudioElements;
  private readonly callbacks: TranslationControllerCallbacks;
  private expiresAt = new Map<TargetLanguage, number>();
  private microphone: MediaStream | undefined;
  private pairAbort: AbortController | undefined;
  private reconnectAttempts = 0;
  private reconnectTimer: number | undefined;
  private runId = 0;
  private sessions: TranslationSession[] = [];
  private state: LifecycleState = "idle";

  constructor(
    audioElements: TranslationAudioElements,
    callbacks: TranslationControllerCallbacks,
  ) {
    this.audioElements = audioElements;
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
        this.microphone.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }

      const [track] = this.microphone.getAudioTracks();
      if (!track) {
        throw new Error("No microphone audio track is available");
      }
      this.callbacks.onMicrophone(track.getSettings());
      await this.connectPair(runId);
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

  private async connectPair(runId: number): Promise<void> {
    if (!this.microphone) {
      throw new Error("Microphone capture ended before sessions connected");
    }

    this.closePair();
    const pairAbort = new AbortController();
    this.pairAbort = pairAbort;
    this.expiresAt.clear();
    const pairGeneration = pairAbort;

    const callbacks: TranslationSessionCallbacks = {
      onDiagnostic: this.callbacks.onDiagnostic,
      onExpiry: (target, expiry) => {
        if (this.pairAbort !== pairGeneration) {
          return;
        }
        this.expiresAt.set(target, expiry);
        this.scheduleExpiryReconnect(runId);
      },
      onFailure: (target, error) => {
        if (this.pairAbort !== pairGeneration) {
          return;
        }
        this.requestReconnect(runId, `${target}: ${error.message}`);
      },
      onMilestone: this.callbacks.onMilestone,
      onSourceTranscript: this.callbacks.onSourceTranscript,
      onTranslationTranscript: this.callbacks.onTranslationTranscript,
    };

    const results = await Promise.allSettled([
      openTranslationSession({
        audioElement: this.audioElements.pt,
        callbacks,
        microphone: this.microphone,
        signal: pairAbort.signal,
        target: "pt",
        transcribe: true,
      }),
      openTranslationSession({
        audioElement: this.audioElements.en,
        callbacks,
        microphone: this.microphone,
        signal: pairAbort.signal,
        target: "en",
        transcribe: false,
      }),
    ]);

    const connected = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (runId !== this.runId || this.pairAbort !== pairGeneration) {
      connected.forEach((session) => {
        session.close();
      });
      return;
    }

    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) {
      connected.forEach((session) => {
        session.close();
      });
      throw this.errorValue(failure.reason);
    }

    this.sessions = connected;
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
      this.setState("error", `Translation stopped after repeated failures: ${reason}`);
      return;
    }

    this.reconnectAttempts += 1;
    const delay = 2 ** (this.reconnectAttempts - 1) * 1_000;
    this.setState("reconnecting", `${reason}. Retrying in ${delay / 1_000} seconds`);
    this.closePair();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectPair(runId).catch((error: unknown) => {
        if (runId === this.runId) {
          this.requestReconnect(runId, this.errorMessage(error));
        }
      });
    }, delay);
  }

  private scheduleExpiryReconnect(runId: number): void {
    if (this.expiresAt.size !== 2 || this.state !== "listening") {
      return;
    }

    const earliestExpiry = Math.min(...this.expiresAt.values()) * 1_000;
    const delay = Math.max(
      1_000,
      earliestExpiry - Date.now() - RECONNECT_BEFORE_EXPIRY_MS,
    );
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.requestReconnect(runId, "Refreshing expiring translation sessions");
    }, delay);
  }

  private closePair(): void {
    this.pairAbort?.abort();
    this.pairAbort = undefined;
    this.sessions.forEach((session) => {
      session.close();
    });
    this.sessions = [];
    this.expiresAt.clear();
  }

  private releaseResources(): void {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.closePair();
    this.microphone?.getTracks().forEach((track) => {
      track.stop();
    });
    this.microphone = undefined;
  }

  private setState(state: LifecycleState, detail?: string): void {
    this.state = state;
    this.callbacks.onState(state, detail);
  }

  private errorMessage(value: unknown): string {
    return this.errorValue(value).message;
  }

  private errorValue(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
  }
}
