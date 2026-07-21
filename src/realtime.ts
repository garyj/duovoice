import { SESSION_CONFIG } from "./session-config";
import { type TurnAction, TurnCoordinator } from "./turns";

export type SessionMilestone =
  | "peer-connected"
  | "remote-track"
  | "data-channel"
  | "session-created"
  | "input-speech-started"
  | "barge-in"
  | "response-started"
  | "remote-audio-started"
  | "input-transcript"
  | "output-transcript";

export interface Milestone {
  elapsedMs: number;
  name: SessionMilestone;
}

export interface TranscriptUpdate {
  final: boolean;
  id: string;
  text: string;
}

export interface InterpreterSessionCallbacks {
  onDiagnostic: (eventType: string) => void;
  onExpiry: (expiresAt: number) => void;
  onFailure: (error: Error) => void;
  onInputTranscript: (update: TranscriptUpdate) => void;
  onMilestone: (milestone: Milestone) => void;
  onOutputState: (playing: boolean) => void;
  onOutputTranscript: (update: TranscriptUpdate) => void;
}

export interface OpenInterpreterSessionOptions {
  apiKey: string;
  audioElement: HTMLAudioElement;
  callbacks: InterpreterSessionCallbacks;
  microphone: MediaStream;
  signal: AbortSignal;
}

export interface InterpreterSession {
  close: () => void;
  expiresAt: number | undefined;
}

interface RealtimeEvent {
  delta?: string;
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
  item_id?: string;
  response?: {
    id?: string;
    status?: string;
    status_details?: {
      error?: {
        message?: string;
      };
      reason?: string;
    };
  };
  response_id?: string;
  session?: {
    expires_at?: number;
  };
  transcript?: string;
  type?: string;
}

const CONNECTION_TIMEOUT_MS = 20_000;
const DISCONNECTED_GRACE_MS = 3_000;
const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const RESPONSE_TIMEOUT_MS = 30_000;

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function transcriptId(event: RealtimeEvent, fallback: string): string {
  return event.item_id ?? event.response_id ?? event.response?.id ?? fallback;
}

function requireAudioTrack(stream: MediaStream): MediaStreamTrack {
  const [track] = stream.getAudioTracks();
  if (!track) {
    throw new Error("The microphone stream has no audio track");
  }
  return track;
}

export async function openInterpreterSession(
  options: OpenInterpreterSessionOptions,
): Promise<InterpreterSession> {
  const { apiKey, audioElement, callbacks, microphone, signal } = options;
  const microphoneTrack = requireAudioTrack(microphone);

  const startedAt = performance.now();
  const connectionAbort = new AbortController();
  const peerConnection = new RTCPeerConnection();
  const dataChannel = peerConnection.createDataChannel("oai-events");
  let closing = false;
  let dataChannelOpen = false;
  let disconnectedTimer: number | undefined;
  let connectionTimer: number | undefined;
  let responseTimer: number | undefined;
  let expiresAt: number | undefined;
  const ignoredInputItemIds = new Set<string>();
  const interruptedResponseIds = new Set<string>();
  let currentResponseId: string | undefined;
  let outputPlaying = false;
  let ready = false;
  let sessionCreated = false;
  const turns = new TurnCoordinator();
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;

  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void readyPromise.catch(() => undefined);

  function mark(name: SessionMilestone) {
    callbacks.onMilestone({
      elapsedMs: Math.round(performance.now() - startedAt),
      name,
    });
  }

  function fail(value: unknown) {
    if (closing) {
      return;
    }

    const error = asError(value);
    if (ready) {
      callbacks.onFailure(error);
    } else {
      rejectReady?.(error);
    }
  }

  function checkReady() {
    if (!ready && dataChannelOpen && sessionCreated) {
      ready = true;
      window.clearTimeout(connectionTimer);
      resolveReady?.();
    }
  }

  function sendClientEvent(
    eventType: string,
    fields: Record<string, unknown> = {},
  ): boolean {
    if (dataChannel.readyState !== "open") {
      fail(new Error(`Could not send ${eventType} before the event channel opened`));
      return false;
    }
    dataChannel.send(JSON.stringify({ type: eventType, ...fields }));
    callbacks.onDiagnostic(`client.${eventType}`);
    return true;
  }

  function applyTurnAction(action: TurnAction, itemId?: string) {
    if (action === "respond") {
      if (sendClientEvent("response.create")) {
        window.clearTimeout(responseTimer);
        responseTimer = window.setTimeout(() => {
          fail(new Error("The interpreter response timed out"));
        }, RESPONSE_TIMEOUT_MS);
      }
    } else if (action === "delete" && itemId) {
      ignoredInputItemIds.add(itemId);
      sendClientEvent("conversation.item.delete", { item_id: itemId });
    }
  }

  function updateExpiry(candidate: unknown) {
    if (typeof candidate !== "number") {
      return;
    }
    expiresAt = candidate;
    callbacks.onExpiry(candidate);
  }

  function handleMessage(event: MessageEvent<string>) {
    if (closing) {
      return;
    }

    let message: RealtimeEvent;
    try {
      message = JSON.parse(event.data) as RealtimeEvent;
    } catch {
      callbacks.onDiagnostic("invalid-json");
      return;
    }

    const eventType = message.type ?? "unknown";
    callbacks.onDiagnostic(eventType);

    switch (eventType) {
      case "session.created":
        sessionCreated = true;
        mark("session-created");
        updateExpiry(message.session?.expires_at);
        checkReady();
        break;
      case "input_audio_buffer.speech_started":
        if (turns.speechStarted() || outputPlaying) {
          if (currentResponseId) {
            interruptedResponseIds.add(currentResponseId);
          }
          callbacks.onDiagnostic("barge-in");
          mark("barge-in");
        }
        mark("input-speech-started");
        break;
      case "input_audio_buffer.committed":
        if (!message.item_id) {
          fail(new Error("The committed audio turn did not include an item ID"));
          break;
        }
        applyTurnAction(turns.turnCommitted(), message.item_id);
        break;
      case "response.created":
        currentResponseId = message.response?.id;
        turns.responseCreated();
        mark("response-started");
        break;
      case "output_audio_buffer.started":
        outputPlaying = true;
        callbacks.onOutputState(true);
        mark("remote-audio-started");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        outputPlaying = false;
        callbacks.onOutputState(false);
        break;
      case "response.done":
        window.clearTimeout(responseTimer);
        responseTimer = undefined;
        if (!outputPlaying) {
          callbacks.onOutputState(false);
        }
        if (
          message.response?.status === "failed" ||
          message.response?.status === "incomplete"
        ) {
          turns.responseDone();
          fail(
            new Error(
              message.response.status_details?.error?.message ??
                message.response.status_details?.reason ??
                `The interpreter response ${message.response.status}`,
            ),
          );
        } else {
          applyTurnAction(turns.responseDone());
        }
        currentResponseId = undefined;
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (
          typeof message.delta === "string" &&
          !ignoredInputItemIds.has(transcriptId(message, "input"))
        ) {
          mark("input-transcript");
          callbacks.onInputTranscript({
            final: false,
            id: transcriptId(message, "input"),
            text: message.delta,
          });
        }
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (
          typeof message.transcript === "string" &&
          !ignoredInputItemIds.has(transcriptId(message, "input"))
        ) {
          callbacks.onInputTranscript({
            final: true,
            id: transcriptId(message, "input"),
            text: message.transcript,
          });
        }
        break;
      case "response.output_audio_transcript.delta":
        if (typeof message.delta === "string") {
          mark("output-transcript");
          callbacks.onOutputTranscript({
            final: false,
            id: transcriptId(message, "output"),
            text: message.delta,
          });
        }
        break;
      case "response.output_audio_transcript.done":
        if (typeof message.transcript === "string") {
          const responseId = message.response_id ?? message.response?.id;
          const interrupted = Boolean(
            responseId && interruptedResponseIds.delete(responseId),
          );
          callbacks.onOutputTranscript({
            final: true,
            id: transcriptId(message, "output"),
            text: interrupted
              ? `${message.transcript}\n(interrupted)`
              : message.transcript,
          });
        }
        break;
      case "error":
        callbacks.onDiagnostic(
          `server.error.${message.error?.code ?? message.error?.type ?? "unknown"}`,
        );
        break;
    }
  }

  function close() {
    if (closing) {
      return;
    }
    if (!ready) {
      const reason = signal.aborted
        ? asError(signal.reason ?? "The connection was cancelled")
        : new Error("The interpreter session was closed");
      rejectReady?.(reason);
    }
    closing = true;
    window.clearTimeout(connectionTimer);
    window.clearTimeout(disconnectedTimer);
    window.clearTimeout(responseTimer);
    signal.removeEventListener("abort", close);
    dataChannel.removeEventListener("message", handleMessage);
    connectionAbort.abort();
    dataChannel.close();
    peerConnection.close();
    audioElement.pause();
    audioElement.srcObject = null;
  }

  signal.addEventListener("abort", close, { once: true });
  if (signal.aborted) {
    close();
    throw asError(signal.reason ?? "The connection was cancelled");
  }

  connectionTimer = window.setTimeout(() => {
    const error = new Error("The interpreter session timed out");
    connectionAbort.abort(error);
    fail(error);
  }, CONNECTION_TIMEOUT_MS);

  peerConnection.addEventListener("connectionstatechange", () => {
    const state = peerConnection.connectionState;
    callbacks.onDiagnostic(`peer.${state}`);
    if (state === "connected") {
      window.clearTimeout(disconnectedTimer);
      mark("peer-connected");
      return;
    }
    if (state === "disconnected") {
      disconnectedTimer = window.setTimeout(() => {
        if (peerConnection.connectionState === "disconnected") {
          fail(new Error("The interpreter peer connection was interrupted"));
        }
      }, DISCONNECTED_GRACE_MS);
      return;
    }
    if (state === "failed") {
      fail(new Error("The interpreter peer connection failed"));
    }
  });

  peerConnection.addEventListener("track", (event) => {
    const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
    audioElement.srcObject = remoteStream;
    mark("remote-track");
    void audioElement.play().catch((error: unknown) => {
      fail(new Error(`Could not play interpreter audio: ${asError(error).message}`));
    });
  });

  dataChannel.addEventListener("open", () => {
    dataChannelOpen = true;
    mark("data-channel");
    checkReady();
  });
  dataChannel.addEventListener("message", handleMessage);
  dataChannel.addEventListener("close", () => {
    if (!closing) {
      fail(new Error("The interpreter event channel closed"));
    }
  });

  try {
    peerConnection.addTrack(microphoneTrack, microphone);

    const offer = await peerConnection.createOffer();
    if (!offer.sdp) {
      throw new Error("Chrome did not create an SDP offer");
    }
    await peerConnection.setLocalDescription(offer);

    const body = new FormData();
    body.set("sdp", offer.sdp);
    body.set("session", JSON.stringify(SESSION_CONFIG));

    const response = await fetch(OPENAI_REALTIME_CALLS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal: connectionAbort.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Could not negotiate the interpreter session (${response.status}): ${await response.text()}`,
      );
    }
    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await response.text(),
    });
    await readyPromise;
    callbacks.onOutputState(false);
  } catch (error) {
    close();
    throw asError(error);
  }

  return {
    close,
    get expiresAt() {
      return expiresAt;
    },
  };
}
