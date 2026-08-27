import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import type { DraftResult } from "@/lib/ai/draft";

type MockTrack = {
  stop: ReturnType<typeof vi.fn>;
};

const originalFetch = globalThis.fetch;
const originalMediaDevices = navigator.mediaDevices;
const originalMediaRecorder = globalThis.MediaRecorder;
const rawAudioSentinel = "RAW_AUDIO_MUST_NOT_BE_LOGGED";
const partialTranscriptSentinel = "PARTIAL_TRANSCRIPT_MUST_NOT_BE_LOGGED";

const successfulResult: DraftResult = {
  mode: "demo",
  draft: {
    conditionSummary: "昼食は半分ほど召し上がりました",
    completedSummary: "水分を用意しました",
    nextRequest: "次に訪れた方は水分をご確認ください",
    neededItems: ["トイレットペーパー"],
  },
};

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static isTypeSupported = vi.fn((type: string) => type.startsWith("audio/webm"));

  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  state: RecordingState = "inactive";

  start = vi.fn(() => {
    this.state = "recording";
  });

  stop = vi.fn(() => {
    if (this.state === "inactive") return;
    this.state = "inactive";
    const data = new Blob([rawAudioSentinel], { type: this.mimeType });
    this.ondataavailable?.({ data } as BlobEvent);
    this.onstop?.(new Event("stop"));
  });

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    MockMediaRecorder.instances.push(this);
  }
}

function installMediaDevices(getUserMedia: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

function createMockStream() {
  const tracks: MockTrack[] = [
    { stop: vi.fn() },
    { stop: vi.fn() },
  ];
  const stream = {
    getTracks: vi.fn(() => tracks),
  } as unknown as MediaStream;

  return { stream, tracks };
}

function expectNoConsoleOutput() {
  expect(console.log).not.toHaveBeenCalled();
  expect(console.info).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  expect(console.debug).not.toHaveBeenCalled();
}

describe("VoiceRecorder", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    MockMediaRecorder.instances.length = 0;
    MockMediaRecorder.isTypeSupported.mockClear();
    fetchMock = vi.fn();

    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: MockMediaRecorder as unknown as typeof MediaRecorder,
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    });

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: originalMediaRecorder,
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  it("records audio only, stops every track, and returns a validated draft", async () => {
    const { stream, tracks } = createMockStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    installMediaDevices(getUserMedia);
    fetchMock.mockResolvedValue({
      json: vi.fn().mockResolvedValue(successfulResult),
      ok: true,
    });
    const onDraft = vi.fn();
    const user = userEvent.setup();
    render(<VoiceRecorder onDraft={onDraft} />);

    await user.click(screen.getByRole("button", { name: "声で話す" }));

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(MockMediaRecorder.instances[0]?.start).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/^録音中 0秒$/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "録音を停止" }));

    expect(MockMediaRecorder.instances[0]?.stop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/draft",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.body).toBeInstanceOf(FormData);
    const formData = request.body as FormData;
    expect(Array.from(formData.keys())).toEqual(["audio"]);
    expect(formData.get("audio")).toBeInstanceOf(Blob);

    await waitFor(() => expect(onDraft).toHaveBeenCalledWith(successfulResult));
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expectNoConsoleOutput();
  });

  it("stops every active track when cancelled and when unmounted", async () => {
    const cancelled = createMockStream();
    const unmounted = createMockStream();
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(cancelled.stream)
      .mockResolvedValueOnce(unmounted.stream);
    installMediaDevices(getUserMedia);
    const user = userEvent.setup();
    const { unmount } = render(<VoiceRecorder onDraft={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "声で話す" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole("button", { name: "中止" }));

    for (const track of cancelled.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }

    await user.click(screen.getByRole("button", { name: "声で話す" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    unmount();

    for (const track of unmounted.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoConsoleOutput();
  });

  it("shows the exact microphone permission message and a retry action", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(new DOMException("permission denied", "NotAllowedError"));
    installMediaDevices(getUserMedia);
    const user = userEvent.setup();
    render(<VoiceRecorder onDraft={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "声で話す" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("マイクを許可してください");
    expect(screen.getByRole("button", { name: "もう一度話す" })).toBeInTheDocument();
    expect(MockMediaRecorder.instances).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoConsoleOutput();
  });

  it("offers another recording after an AI failure without logging audio or a partial transcript", async () => {
    const { stream, tracks } = createMockStream();
    installMediaDevices(vi.fn().mockResolvedValue(stream));
    fetchMock.mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        error: "synthetic upstream failure",
        partialTranscript: partialTranscriptSentinel,
      }),
      ok: false,
    });
    const onDraft = vi.fn();
    const user = userEvent.setup();
    render(<VoiceRecorder onDraft={onDraft} />);

    await user.click(screen.getByRole("button", { name: "声で話す" }));
    await user.click(await screen.findByRole("button", { name: "録音を停止" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "AIの下書きを作れませんでした",
    );
    expect(screen.getByRole("button", { name: "もう一度話す" })).toBeInTheDocument();
    expect(onDraft).not.toHaveBeenCalled();
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expectNoConsoleOutput();
  });
});
