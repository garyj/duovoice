export type TargetLanguage = "en" | "pt";

export type SessionMilestone =
  | "client-secret"
  | "peer-connected"
  | "remote-track"
  | "data-channel"
  | "session-created"
  | "remote-audio-started"
  | "source-transcript"
  | "translation-transcript";

export interface Milestone {
  elapsedMs: number;
  name: SessionMilestone;
  target: TargetLanguage;
}

export interface TranslationSessionCallbacks {
  onDiagnostic: (target: TargetLanguage, eventType: string) => void;
  onExpiry: (target: TargetLanguage, expiresAt: number) => void;
  onFailure: (target: TargetLanguage, error: Error) => void;
  onMilestone: (milestone: Milestone) => void;
  onSourceTranscript: (delta: string) => void;
  onTranslationTranscript: (target: TargetLanguage, delta: string) => void;
}

export interface OpenTranslationSessionOptions {
  audioElement: HTMLAudioElement;
  callbacks: TranslationSessionCallbacks;
  microphone: MediaStream;
  signal: AbortSignal;
  target: TargetLanguage;
  transcribe: boolean;
}

export interface TranslationSession {
  close: () => void;
  expiresAt: number | undefined;
  target: TargetLanguage;
}

interface ClientSecretResponse {
  expires_at: number;
  session?: {
    expires_at?: number;
  };
  value: string;
}

interface TranslationEvent {
  delta?: string;
  error?: {
    message?: string;
  };
  session?: {
    expires_at?: number;
  };
  type?: string;
}

const CONNECTION_TIMEOUT_MS = 20_000;
const DISCONNECTED_GRACE_MS = 3_000;

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isClientSecret(value: unknown): value is ClientSecretResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ClientSecretResponse>;
  return (
    typeof candidate.value === "string" && typeof candidate.expires_at === "number"
  );
}

async function requestClientSecret(
  target: TargetLanguage,
  transcribe: boolean,
  signal: AbortSignal,
): Promise<ClientSecretResponse> {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, transcribe }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Could not create the ${target} session (${response.status}): ${body}`,
    );
  }

  const payload: unknown = await response.json();
  if (!isClientSecret(payload)) {
    throw new Error(`The ${target} session returned an invalid client secret`);
  }
  return payload;
}

export async function openTranslationSession(
  options: OpenTranslationSessionOptions,
): Promise<TranslationSession> {
  const { audioElement, callbacks, microphone, signal, target, transcribe } = options;
  const startedAt = performance.now();
  const connectionAbort = new AbortController();
  const peerConnection = new RTCPeerConnection();
  const dataChannel = peerConnection.createDataChannel("oai-events");
  let closing = false;
  let connected = false;
  let sessionCreated = false;
  let ready = false;
  let expiresAt: number | undefined;
  let disconnectedTimer: number | undefined;
  let connectionTimer: number | undefined;
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
      target,
    });
  }

  function fail(value: unknown) {
    if (closing) {
      return;
    }

    const error = asError(value);
    if (ready) {
      callbacks.onFailure(target, error);
    } else {
      rejectReady?.(error);
    }
  }

  function checkReady() {
    if (!ready && connected && sessionCreated) {
      ready = true;
      window.clearTimeout(connectionTimer);
      resolveReady?.();
    }
  }

  function updateExpiry(candidate: unknown) {
    if (typeof candidate !== "number") {
      return;
    }
    expiresAt = candidate;
    callbacks.onExpiry(target, candidate);
  }

  function handleMessage(event: MessageEvent<string>) {
    let message: TranslationEvent;
    try {
      message = JSON.parse(event.data) as TranslationEvent;
    } catch {
      callbacks.onDiagnostic(target, "invalid-json");
      return;
    }

    const eventType = message.type ?? "unknown";
    callbacks.onDiagnostic(target, eventType);

    switch (eventType) {
      case "session.created":
        sessionCreated = true;
        mark("session-created");
        updateExpiry(message.session?.expires_at);
        checkReady();
        break;
      case "session.input_transcript.delta":
        if (typeof message.delta === "string") {
          mark("source-transcript");
          callbacks.onSourceTranscript(message.delta);
        }
        break;
      case "session.output_transcript.delta":
        if (typeof message.delta === "string") {
          mark("translation-transcript");
          callbacks.onTranslationTranscript(target, message.delta);
        }
        break;
      case "output_audio_buffer.started":
        mark("remote-audio-started");
        break;
      case "session.closed":
        fail(new Error(`The ${target} translation session closed`));
        break;
      case "error":
        fail(
          new Error(
            message.error?.message ??
              `The ${target} translation session returned an error`,
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
        : new Error(`The ${target} translation session was closed`);
      rejectReady?.(reason);
    }
    closing = true;
    window.clearTimeout(connectionTimer);
    window.clearTimeout(disconnectedTimer);
    signal.removeEventListener("abort", close);
    connectionAbort.abort();
    if (dataChannel.readyState === "open") {
      dataChannel.send(JSON.stringify({ type: "session.close" }));
    }
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
    const error = new Error(`The ${target} translation session timed out`);
    connectionAbort.abort(error);
    fail(error);
  }, CONNECTION_TIMEOUT_MS);

  peerConnection.addEventListener("connectionstatechange", () => {
    const state = peerConnection.connectionState;
    callbacks.onDiagnostic(target, `peer.${state}`);
    if (state === "connected") {
      window.clearTimeout(disconnectedTimer);
      connected = true;
      mark("peer-connected");
      checkReady();
      return;
    }
    if (state === "disconnected") {
      disconnectedTimer = window.setTimeout(() => {
        if (peerConnection.connectionState === "disconnected") {
          fail(new Error(`The ${target} peer connection was interrupted`));
        }
      }, DISCONNECTED_GRACE_MS);
      return;
    }
    if (state === "failed") {
      fail(new Error(`The ${target} peer connection failed`));
    }
  });

  peerConnection.addEventListener("track", (event) => {
    const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
    audioElement.srcObject = remoteStream;
    mark("remote-track");
    void audioElement.play().catch((error: unknown) => {
      fail(new Error(`Could not play ${target} audio: ${asError(error).message}`));
    });
  });

  dataChannel.addEventListener("open", () => mark("data-channel"));
  dataChannel.addEventListener("message", handleMessage);
  dataChannel.addEventListener("close", () => {
    if (!closing) {
      fail(new Error(`The ${target} event channel closed`));
    }
  });

  try {
    const secret = await requestClientSecret(
      target,
      transcribe,
      connectionAbort.signal,
    );
    mark("client-secret");
    updateExpiry(secret.session?.expires_at);

    const [microphoneTrack] = microphone.getAudioTracks();
    if (!microphoneTrack) {
      throw new Error("The microphone stream has no audio track");
    }
    peerConnection.addTrack(microphoneTrack, microphone);

    const offer = await peerConnection.createOffer();
    if (!offer.sdp) {
      throw new Error(`Chrome did not create SDP for the ${target} session`);
    }
    await peerConnection.setLocalDescription(offer);
    const response = await fetch(
      "https://api.openai.com/v1/realtime/translations/calls",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret.value}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
        signal: connectionAbort.signal,
      },
    );
    if (!response.ok) {
      throw new Error(
        `Could not negotiate the ${target} session (${response.status}): ${await response.text()}`,
      );
    }
    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await response.text(),
    });
    await readyPromise;
  } catch (error) {
    close();
    throw asError(error);
  }

  return {
    close,
    get expiresAt() {
      return expiresAt;
    },
    target,
  };
}
