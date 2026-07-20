export type SessionMilestone =
  | "peer-connected"
  | "remote-track"
  | "data-channel"
  | "session-created"
  | "input-speech-started"
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
  onCaptureState: (enabled: boolean) => void;
  onDiagnostic: (eventType: string) => void;
  onExpiry: (expiresAt: number) => void;
  onFailure: (error: Error) => void;
  onInputTranscript: (update: TranscriptUpdate) => void;
  onMilestone: (milestone: Milestone) => void;
  onOutputTranscript: (update: TranscriptUpdate) => void;
}

export interface OpenInterpreterSessionOptions {
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
    message?: string;
  };
  item_id?: string;
  response?: {
    id?: string;
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
const ECHO_TAIL_MS = 2_000;

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
  const { audioElement, callbacks, microphone, signal } = options;
  const microphoneTrack = requireAudioTrack(microphone);

  const startedAt = performance.now();
  const connectionAbort = new AbortController();
  const peerConnection = new RTCPeerConnection();
  const dataChannel = peerConnection.createDataChannel("oai-events");
  let captureTimer: number | undefined;
  let closing = false;
  let dataChannelOpen = false;
  let disconnectedTimer: number | undefined;
  let connectionTimer: number | undefined;
  let expiresAt: number | undefined;
  const ignoredInputItemIds = new Set<string>();
  let outputPlaying = false;
  let ready = false;
  let responseActive = false;
  let sessionCreated = false;
  let shouldRespondToTurn = false;
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

  function setCaptureEnabled(enabled: boolean) {
    if (closing || microphoneTrack.enabled === enabled) {
      return;
    }
    microphoneTrack.enabled = enabled;
    callbacks.onDiagnostic(enabled ? "capture.resumed" : "capture.paused");
    callbacks.onCaptureState(enabled);
  }

  function pauseCapture() {
    window.clearTimeout(captureTimer);
    setCaptureEnabled(false);
  }

  function sendClientEvent(eventType: string, fields: Record<string, unknown> = {}) {
    if (dataChannel.readyState !== "open") {
      fail(new Error(`Could not send ${eventType} before the event channel opened`));
      return;
    }
    dataChannel.send(JSON.stringify({ type: eventType, ...fields }));
    callbacks.onDiagnostic(`client.${eventType}`);
  }

  function resumeCaptureWhenIdle() {
    window.clearTimeout(captureTimer);
    if (responseActive || outputPlaying) {
      return;
    }
    // Keep captured audio quiet while the output device and echo canceller settle.
    captureTimer = window.setTimeout(() => {
      setCaptureEnabled(true);
    }, ECHO_TAIL_MS);
  }

  function updateExpiry(candidate: unknown) {
    if (typeof candidate !== "number") {
      return;
    }
    expiresAt = candidate;
    callbacks.onExpiry(candidate);
  }

  function handleMessage(event: MessageEvent<string>) {
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
        shouldRespondToTurn = microphoneTrack.enabled && !responseActive;
        mark("input-speech-started");
        break;
      case "input_audio_buffer.committed":
        if (!message.item_id) {
          fail(new Error("The committed audio turn did not include an item ID"));
          break;
        }
        if (shouldRespondToTurn) {
          pauseCapture();
          responseActive = true;
          sendClientEvent("response.create");
        } else {
          ignoredInputItemIds.add(message.item_id);
          sendClientEvent("conversation.item.delete", {
            item_id: message.item_id,
          });
        }
        shouldRespondToTurn = false;
        break;
      case "response.created":
        responseActive = true;
        pauseCapture();
        mark("response-started");
        break;
      case "output_audio_buffer.started":
        outputPlaying = true;
        pauseCapture();
        mark("remote-audio-started");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        outputPlaying = false;
        resumeCaptureWhenIdle();
        break;
      case "response.done":
        responseActive = false;
        resumeCaptureWhenIdle();
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
          callbacks.onOutputTranscript({
            final: true,
            id: transcriptId(message, "output"),
            text: message.transcript,
          });
        }
        break;
      case "error":
        fail(
          new Error(
            message.error?.message ?? "The interpreter session returned an error",
          ),
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
    window.clearTimeout(captureTimer);
    window.clearTimeout(connectionTimer);
    window.clearTimeout(disconnectedTimer);
    signal.removeEventListener("abort", close);
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

    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp,
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
    callbacks.onCaptureState(true);
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
