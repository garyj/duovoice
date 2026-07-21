export class FakeDataChannel extends EventTarget {
  readonly sent: string[] = [];
  readyState: RTCDataChannelState = "connecting";

  close(): void {
    this.readyState = "closed";
  }

  closeFromServer(): void {
    this.close();
    this.dispatchEvent(new Event("close"));
  }

  emit(message: object): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  open(): void {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }

  send(message: string): void {
    this.sent.push(message);
  }
}

export class FakeMediaTrack extends EventTarget {
  readyState: MediaStreamTrackState = "live";
  stopCount = 0;

  end(): void {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }

  getSettings(): MediaTrackSettings {
    return { echoCancellation: true };
  }

  stop(): void {
    this.readyState = "ended";
    this.stopCount += 1;
  }
}

export class FakePeerConnection extends EventTarget {
  static latest: FakePeerConnection;

  readonly dataChannel = new FakeDataChannel();
  connectionState: RTCPeerConnectionState = "new";

  constructor() {
    super();
    FakePeerConnection.latest = this;
  }

  addTrack(): void {}

  close(): void {
    this.connectionState = "closed";
  }

  createDataChannel(): RTCDataChannel {
    return this.dataChannel as unknown as RTCDataChannel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: "offer-sdp" };
  }

  async setLocalDescription(): Promise<void> {}

  async setRemoteDescription(): Promise<void> {
    this.dataChannel.open();
    this.dataChannel.emit({
      type: "session.created",
      session: { expires_at: Math.floor(Date.now() / 1_000) + 3_600 },
    });
  }
}

export function fakeAudioElement(): HTMLAudioElement {
  return {
    pause: () => undefined,
    play: () => Promise.resolve(),
    srcObject: null,
  } as unknown as HTMLAudioElement;
}

export function fakeMicrophone(track = new FakeMediaTrack()): MediaStream {
  return {
    getAudioTracks: () => [track as unknown as MediaStreamTrack],
    getTracks: () => [track as unknown as MediaStreamTrack],
  } as unknown as MediaStream;
}
