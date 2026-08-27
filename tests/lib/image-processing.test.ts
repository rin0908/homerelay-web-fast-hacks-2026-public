import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureVideoFrame,
  fitWithin,
  PHOTO_JPEG_QUALITY,
} from "@/lib/media/image";

describe("photo re-encoding", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps small images and limits the largest edge to 1600 pixels", () => {
    expect(fitWithin(1200, 900)).toEqual({ width: 1200, height: 900 });
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });

  it("draws a fresh canvas and exports JPEG rather than retaining source metadata", async () => {
    const output = new Blob(["synthetic"], { type: "image/jpeg" });
    const drawImage = vi.fn();
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback) => callback(output));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(4032);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(3024);

    const video = document.createElement("video");
    const result = await captureVideoFrame(video);

    expect(result).toEqual({ blob: output, width: 1600, height: 1200 });
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1600, 1200);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", PHOTO_JPEG_QUALITY);
  });
});
