import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InterpreterController,
  type InterpreterControllerCallbacks,
} from "../src/controller";
import {
  FakeMediaTrack,
  FakePeerConnection,
  fakeAudioElement,
  fakeMicrophone,
} from "./realtime-fakes";

function callbacks() {
  return {
    onDiagnostic: vi.fn<InterpreterControllerCallbacks["onDiagnostic"]>(),
    onInputTranscript: vi.fn<InterpreterControllerCallbacks["onInputTranscript"]>(),
    onMicrophone: vi.fn<InterpreterControllerCallbacks["onMicrophone"]>(),
    onMilestone: vi.fn<InterpreterControllerCallbacks["onMilestone"]>(),
    onOutputState: vi.fn<InterpreterControllerCallbacks["onOutputState"]>(),
    onOutputTranscript: vi.fn<InterpreterControllerCallbacks["onOutputTranscript"]>(),
    onState: vi.fn<InterpreterControllerCallbacks["onState"]>(),
  } satisfies InterpreterControllerCallbacks;
}

function installBrowser(getUserMedia: () => Promise<MediaStream>): void {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(new Response("answer-sdp")),
  );
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InterpreterController", () => {
  it("reconnects after a session failure while the expiry timer is armed", async () => {
    const microphone = fakeMicrophone();
    installBrowser(() => Promise.resolve(microphone));
    const sessionCallbacks = callbacks();
    const controller = new InterpreterController(fakeAudioElement(), sessionCallbacks);
    await controller.start("sk-personal");

    FakePeerConnection.latest.dataChannel.closeFromServer();

    expect(sessionCallbacks.onState).toHaveBeenCalledWith(
      "reconnecting",
      expect.stringContaining("Retrying in 1 seconds"),
    );
    controller.stop();
  });

  it("stops a stale microphone stream without replacing the active one", async () => {
    const staleTrack = new FakeMediaTrack();
    const activeTrack = new FakeMediaTrack();
    const staleMicrophone = fakeMicrophone(staleTrack);
    const activeMicrophone = fakeMicrophone(activeTrack);
    let resolveStale: ((stream: MediaStream) => void) | undefined;
    const getUserMedia = vi
      .fn<() => Promise<MediaStream>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValueOnce(activeMicrophone);
    installBrowser(getUserMedia);
    const sessionCallbacks = callbacks();
    const controller = new InterpreterController(fakeAudioElement(), sessionCallbacks);

    const staleStart = controller.start("sk-personal");
    controller.stop();
    const activeStart = controller.start("sk-personal");
    resolveStale?.(staleMicrophone);
    await Promise.all([staleStart, activeStart]);

    expect(staleTrack.stopCount).toBe(1);
    expect(activeTrack.readyState).toBe("live");
    expect(sessionCallbacks.onState).toHaveBeenLastCalledWith("listening", undefined);
    controller.stop();
  });

  it("reports a disconnected microphone instead of staying listening", async () => {
    const track = new FakeMediaTrack();
    installBrowser(() => Promise.resolve(fakeMicrophone(track)));
    const sessionCallbacks = callbacks();
    const controller = new InterpreterController(fakeAudioElement(), sessionCallbacks);
    await controller.start("sk-personal");

    track.end();

    expect(sessionCallbacks.onState).toHaveBeenLastCalledWith(
      "error",
      "Microphone disconnected",
    );
    controller.stop();
  });
});
