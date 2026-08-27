"use client";

/* eslint-disable @next/next/no-img-element -- Object URLs from a just-captured Blob are not image-optimizer inputs. */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Check, ImagePlus, RotateCcw, X } from "@/components/Icons";
import {
  captureVideoFrame,
  reencodeImageFile,
  type ProcessedImage,
} from "@/lib/media/image";

type CameraState = "idle" | "requesting" | "live" | "captured" | "unsupported" | "error";

export type CameraCaptureProps = {
  onAccepted: (photo: ProcessedImage) => void | Promise<void>;
};

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function cameraErrorMessage(error: unknown) {
  if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) {
    return "カメラを許可してください";
  }
  if (error instanceof DOMException && error.name === "NotReadableError") {
    return "カメラが使用中です。ほかの画面を閉じて、もう一度お試しください";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "利用できるカメラが見つかりませんでした";
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "カメラの準備が中断されました。もう一度お試しください";
  }
  return "カメラを開始できませんでした。もう一度お試しください";
}

async function openCameraStream(constraints: MediaStreamConstraints) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      if (
        error instanceof DOMException &&
        ["NotAllowedError", "SecurityError", "NotFoundError", "OverconstrainedError"].includes(
          error.name,
        )
      ) {
        throw error;
      }
      if (attempt < 2) {
        // Camera drivers and mobile WebViews may release a stopped track a
        // little later than its readyState transition.
        await new Promise((resolve) =>
          window.setTimeout(resolve, 250 * (attempt + 1)),
        );
      }
    }
  }
  throw lastError;
}

export function CameraCapture({ onAccepted }: CameraCaptureProps) {
  const [state, setState] = useState<CameraState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [photo, setPhoto] = useState<ProcessedImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const requestTokenRef = useRef(0);

  const clearPhoto = useCallback(() => {
    setPhoto(null);
    setPreviewUrl(null);
  }, []);

  const stopCamera = useCallback(() => {
    stopTracks(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestTokenRef.current += 1;
      stopTracks(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const beginCamera = useCallback(async () => {
    const requestToken = ++requestTokenRef.current;
    clearPhoto();
    setErrorMessage(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }

    setState("requesting");
    try {
      const stream = await openCameraStream({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          height: { ideal: 1440 },
          width: { ideal: 1920 },
        },
      });

      if (!mountedRef.current || requestToken !== requestTokenRef.current) {
        stopTracks(stream);
        return;
      }

      streamRef.current = stream;
      if (!videoRef.current) {
        stopCamera();
        throw new Error("video element unavailable");
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setState("live");
    } catch (error) {
      stopCamera();
      if (mountedRef.current) {
        setErrorMessage(cameraErrorMessage(error));
        setState("error");
      }
    }
  }, [clearPhoto, stopCamera]);

  const capture = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      const nextPhoto = await captureVideoFrame(videoRef.current);
      stopCamera();
      setPhoto(nextPhoto);
      setPreviewUrl(URL.createObjectURL(nextPhoto.blob));
      setState("captured");
    } catch {
      stopCamera();
      setErrorMessage("写真を準備できませんでした。もう一度お試しください");
      setState("error");
    }
  }, [stopCamera]);

  const selectFallbackPhoto = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setErrorMessage(null);
    try {
      const nextPhoto = await reencodeImageFile(file);
      setPhoto(nextPhoto);
      setPreviewUrl(URL.createObjectURL(nextPhoto.blob));
      setState("captured");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "写真を準備できませんでした");
      setState("unsupported");
    }
  }, []);

  const cancel = useCallback(() => {
    requestTokenRef.current += 1;
    stopCamera();
    clearPhoto();
    setErrorMessage(null);
    setState("idle");
  }, [clearPhoto, stopCamera]);

  const accept = useCallback(async () => {
    if (!photo) return;
    stopCamera();
    await onAccepted(photo);
  }, [onAccepted, photo, stopCamera]);

  const isVideoVisible = state === "requesting" || state === "live";

  return (
    <section className="soft-card overflow-hidden p-5 sm:p-8" aria-labelledby="capture-title">
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl border border-[#cfd8d4] bg-[#f2f4ef] text-center">
        {isVideoVisible ? (
          <video
            aria-label="カメラのプレビュー"
            autoPlay
            className="h-full w-full object-cover"
            muted
            playsInline
            ref={videoRef}
          />
        ) : null}

        {state === "captured" && previewUrl ? (
          <img alt="撮影した写真の確認" className="h-full w-full object-cover" src={previewUrl} />
        ) : null}

        {["idle", "error", "unsupported"].includes(state) ? (
          <div className="max-w-sm px-5">
            <Camera
              aria-hidden="true"
              className="mx-auto text-[var(--color-primary)]"
              size={38}
              strokeWidth={1.6}
            />
            <h2 className="mt-4 text-xl font-semibold text-[var(--color-heading)]" id="capture-title">
              今日の一枚を撮りましょう
            </h2>
            <p className="mt-2 text-sm text-[var(--color-secondary)]">
              写真は端末のギャラリーへ保存しません。
            </p>
          </div>
        ) : null}

        {state === "requesting" ? (
          <div className="absolute inset-x-4 bottom-4 rounded-xl bg-[#fdfbf5e8] px-3 py-2 text-sm font-semibold text-[var(--color-heading)]">
            カメラを準備しています…
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <p
          className="mt-4 flex items-center gap-2 rounded-xl border border-[#e8c8aa] bg-[#fff7ed] px-4 py-3 text-sm font-semibold text-[#85572f]"
          role="alert"
        >
          <AlertTriangle aria-hidden="true" size={20} />
          {errorMessage}
        </p>
      ) : null}

      {state === "idle" || state === "error" ? (
        <button className="primary-button mt-5 w-full" onClick={beginCamera} type="button">
          <Camera aria-hidden="true" size={22} />
          写真を撮る
        </button>
      ) : null}

      {state === "live" ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
          <button className="primary-button w-full" onClick={capture} type="button">
            <Camera aria-hidden="true" size={22} />
            撮影
          </button>
          <button className="secondary-button" onClick={cancel} type="button">
            <X aria-hidden="true" size={20} />
            中止
          </button>
        </div>
      ) : null}

      {state === "requesting" ? (
        <button className="secondary-button mt-5 w-full" onClick={cancel} type="button">
          <X aria-hidden="true" size={20} />
          中止
        </button>
      ) : null}

      {state === "captured" ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button className="secondary-button" onClick={beginCamera} type="button">
            <RotateCcw aria-hidden="true" size={20} />
            撮り直す
          </button>
          <button className="primary-button" onClick={accept} type="button">
            <Check aria-hidden="true" size={21} />
            この写真を使う
          </button>
        </div>
      ) : null}

      {state === "unsupported" ? (
        <div className="mt-5 rounded-2xl border border-[var(--color-divider)] bg-[#fbfaf5] p-4">
          <p className="text-sm text-[var(--color-body)]">
            このブラウザではページ内カメラを使えないため、写真を選んでください。
          </p>
          <label className="secondary-button mt-3 w-full cursor-pointer" htmlFor="camera-fallback-file">
            <ImagePlus aria-hidden="true" size={21} />
            端末から写真を選ぶ
          </label>
          <input
            accept="image/*"
            capture="environment"
            className="sr-only"
            id="camera-fallback-file"
            onChange={(event) => selectFallbackPhoto(event.target.files?.[0])}
            type="file"
          />
        </div>
      ) : null}
    </section>
  );
}
