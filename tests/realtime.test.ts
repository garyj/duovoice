import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type InterpreterSessionCallbacks,
  openInterpreterSession,
} from "../src/realtime";
import { SESSION_CONFIG } from "../src/session-config";
import { FakePeerConnection, fakeAudioElement, fakeMicrophone } from "./realtime-fakes";

function callbacks() {
  return {
    onDiagnostic: vi.fn<InterpreterSessionCallbacks["onDiagnostic"]>(),
    onExpiry: vi.fn<InterpreterSessionCallbacks["onExpiry"]>(),
    onFailure: vi.fn<InterpreterSessionCallbacks["onFailure"]>(),
    onInputTranscript: vi.fn<InterpreterSessionCallbacks["onInputTranscript"]>(),
    onMilestone: vi.fn<InterpreterSessionCallbacks["onMilestone"]>(),
    onOutputState: vi.fn<InterpreterSessionCallbacks["onOutputState"]>(),
    onOutputTranscript: vi.fn<InterpreterSessionCallbacks["onOutputTranscript"]>(),
  } satisfies InterpreterSessionCallbacks;
}

async function openSession(sessionCallbacks: InterpreterSessionCallbacks) {
  return openInterpreterSession({
    apiKey: "sk-personal",
    audioElement: fakeAudioElement(),
    callbacks: sessionCallbacks,
    microphone: fakeMicrophone(),
    signal: new AbortController().signal,
  });
}

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Realtime browser session", () => {
  it("negotiates directly with the browser-stored API key", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("answer-sdp"));
    vi.stubGlobal("fetch", fetchMock);

    const session = await openSession(callbacks());

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/realtime/calls");
    expect(init?.headers).toEqual({ Authorization: "Bearer sk-personal" });
    const body = init?.body as FormData;
    expect(body.get("sdp")).toBe("offer-sdp");
    expect(body.get("session")).toBe(JSON.stringify(SESSION_CONFIG));

    session.close();
  });

  it("reports server errors without killing a healthy session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("answer")),
    );
    const sessionCallbacks = callbacks();
    const session = await openSession(sessionCallbacks);

    FakePeerConnection.latest.dataChannel.emit({
      type: "error",
      error: { code: "item_already_deleted", message: "Already gone" },
    });

    expect(sessionCallbacks.onFailure).not.toHaveBeenCalled();
    expect(sessionCallbacks.onDiagnostic).toHaveBeenCalledWith(
      "server.error.item_already_deleted",
    );
    session.close();
  });

  it("fails the session when a response fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("answer")),
    );
    const sessionCallbacks = callbacks();
    const session = await openSession(sessionCallbacks);

    FakePeerConnection.latest.dataChannel.emit({
      type: "response.done",
      response: {
        status: "failed",
        status_details: { error: { message: "Response failed" } },
      },
    });

    expect(sessionCallbacks.onFailure).toHaveBeenCalledWith(
      new Error("Response failed"),
    );
    session.close();
  });

  it("fails the session when a requested response stalls", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("answer")),
    );
    const sessionCallbacks = callbacks();
    const sessionPromise = openSession(sessionCallbacks);
    await vi.runAllTicks();
    const session = await sessionPromise;

    FakePeerConnection.latest.dataChannel.emit({
      type: "input_audio_buffer.speech_started",
    });
    FakePeerConnection.latest.dataChannel.emit({
      type: "input_audio_buffer.committed",
      item_id: "turn-1",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(sessionCallbacks.onFailure).toHaveBeenCalledWith(
      new Error("The interpreter response timed out"),
    );
    session.close();
  });

  it("labels the final transcript when playback was interrupted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("answer")),
    );
    const sessionCallbacks = callbacks();
    const session = await openSession(sessionCallbacks);

    FakePeerConnection.latest.dataChannel.emit({
      type: "response.created",
      response: { id: "response-1" },
    });
    FakePeerConnection.latest.dataChannel.emit({
      type: "input_audio_buffer.speech_started",
    });
    FakePeerConnection.latest.dataChannel.emit({
      type: "response.output_audio_transcript.done",
      response_id: "response-1",
      transcript: "Olá, meu amor.",
    });

    expect(sessionCallbacks.onOutputTranscript).toHaveBeenCalledWith({
      final: true,
      id: "response-1",
      text: "Olá, meu amor.\n(interrupted)",
    });
    session.close();
  });

  it("ignores events after the session closes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("answer")),
    );
    const sessionCallbacks = callbacks();
    const session = await openSession(sessionCallbacks);
    session.close();

    FakePeerConnection.latest.dataChannel.emit({
      type: "response.output_audio_transcript.done",
      response_id: "response-1",
      transcript: "Late transcript",
    });

    expect(sessionCallbacks.onOutputTranscript).not.toHaveBeenCalled();
  });
});
