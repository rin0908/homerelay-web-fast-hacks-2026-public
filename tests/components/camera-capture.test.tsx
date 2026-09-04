import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { CameraCapture } from "@/components/CameraCapture";

type MockTrack = {
  stop: ReturnType<typeof vi.fn>;
};

const originalMediaDevices = navigator.mediaDevices;
const originalIsSecureContext = window.isSecureContext;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function installMediaDevices(getUserMedia: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

function removeMediaDevices() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: undefined,
  });
}

function createMockStream() {
  const tracks: MockTrack[] = [
    { stop: vi.fn() },
    { stop: vi.fn() },
  ];
  const stream = {
    getTracks: vi.fn(() => tracks),
    getVideoTracks: vi.fn(() => tracks),
  } as unknown as MediaStream;

  return { stream, tracks };
}

async function startCamera(user: ReturnType<typeof userEvent.setup>) {
  const startButton = screen.queryByRole("button", { name: "写真を撮る" });
  if (startButton) {
    await user.click(startButton);
  }
}

describe("CameraCapture", () => {
  const acceptedBlob = new Blob(["synthetic-photo"], { type: "image/jpeg" });
  const drawImage = vi.fn();
  const createObjectURL = vi.fn(() => "blob:synthetic-camera-preview");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });

    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
      1280,
    );
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
      960,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          drawImage,
        }) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(acceptedBlob),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    drawImage.mockClear();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: originalIsSecureContext,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    });
  });

  it("requests the rear camera, supports retake, and accepts the captured blob", async () => {
    const first = createMockStream();
    const second = createMockStream();
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream);
    installMediaDevices(getUserMedia);
    const onAccepted = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<CameraCapture onAccepted={onAccepted} />);

    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument();

    await startCamera(user);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    const constraints = getUserMedia.mock.calls[0]?.[0] as MediaStreamConstraints;
    expect(constraints.video).toEqual(
      expect.objectContaining({
        facingMode: { ideal: "environment" },
      }),
    );

    await user.click(await screen.findByRole("button", { name: /^撮影/ }));
    expect(drawImage).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(acceptedBlob);

    await user.click(screen.getByRole("button", { name: "撮り直す" }));

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(revokeObjectURL).toHaveBeenCalledWith(
      "blob:synthetic-camera-preview",
    );
    for (const track of first.tracks) {
      expect(track.stop).toHaveBeenCalled();
    }

    await user.click(await screen.findByRole("button", { name: /^撮影/ }));
    await user.click(
      await screen.findByRole("button", { name: "この写真を使う" }),
    );

    await waitFor(() =>
      expect(onAccepted).toHaveBeenCalledWith({
        blob: acceptedBlob,
        height: 960,
        width: 1280,
      }),
    );
    for (const track of second.tracks) {
      expect(track.stop).toHaveBeenCalled();
    }
  });

  it("starts the rear camera once when opened from the home capture action", async () => {
    const camera = createMockStream();
    const getUserMedia = vi.fn().mockResolvedValue(camera.stream);
    installMediaDevices(getUserMedia);

    render(<CameraCapture autoStart onAccepted={vi.fn()} />);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: /^撮影/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "写真を撮る" })).not.toBeInTheDocument();
  });

  it("starts the rear camera exactly once under React Strict Mode", async () => {
    const camera = createMockStream();
    const getUserMedia = vi.fn().mockResolvedValue(camera.stream);
    installMediaDevices(getUserMedia);

    render(
      <StrictMode>
        <CameraCapture autoStart onAccepted={vi.fn()} />
      </StrictMode>,
    );

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: /^撮影/ })).toBeEnabled();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
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
    const { unmount } = render(<CameraCapture onAccepted={vi.fn()} />);

    await startCamera(user);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole("button", { name: "中止" }));

    for (const track of cancelled.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }

    await startCamera(user);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    unmount();

    for (const track of unmounted.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });

  it("shows the permission message without exposing a file picker after denial", async () => {
    const permissionError = new DOMException(
      "Camera permission denied",
      "NotAllowedError",
    );
    const getUserMedia = vi.fn().mockRejectedValue(permissionError);
    installMediaDevices(getUserMedia);
    const user = userEvent.setup();
    const { container } = render(<CameraCapture onAccepted={vi.fn()} />);

    await startCamera(user);

    expect(
      await screen.findByText("カメラを許可してください"),
    ).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });

  it("offers a rear-camera file input only when the media API is unavailable", async () => {
    removeMediaDevices();
    const user = userEvent.setup();
    const { container } = render(<CameraCapture onAccepted={vi.fn()} />);

    let input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) {
      const startButton = screen.queryByRole("button", { name: "写真を撮る" });
      expect(startButton).toBeInTheDocument();
      await user.click(startButton!);
      input = container.querySelector<HTMLInputElement>('input[type="file"]');
    }

    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("accept", expect.stringContaining("image/"));
    expect(input).toHaveAttribute("capture", "environment");
  });
});
