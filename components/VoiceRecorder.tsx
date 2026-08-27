"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Mic, RotateCcw, Square, X } from "@/components/Icons";
import { DraftResultSchema, type DraftResult } from "@/lib/ai/draft";

type RecorderState = "idle" | "requesting" | "recording" | "processing" | "error";

export type VoiceRecorderProps = {
  onDraft: (result: DraftResult) => void;
};

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function selectAudioMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function microphoneErrorMessage(error: unknown) {
  if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) {
    return "マイクを許可してください";
  }
  return "音声を録音できませんでした";
}

export function VoiceRecorder({ onDraft }: VoiceRecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const processOnStopRef = useRef(false);
  const requestTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const startedAtRef = useRef(0);

  const releaseStream = useCallback(() => {
    stopTracks(streamRef.current);
    streamRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestTokenRef.current += 1;
      processOnStopRef.current = false;
      abortRef.current?.abort();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      chunksRef.current = [];
      stopTracks(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [state]);

  const processAudio = useCallback(
    async (audio: Blob) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const formData = new FormData();
      formData.append("audio", audio, "homerelay-audio.webm");

      try {
        const response = await fetch("/api/draft", {
          body: formData,
          method: "POST",
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("draft request failed");
        const result = DraftResultSchema.parse(payload);
        if (mountedRef.current) onDraft(result);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (mountedRef.current) {
          setErrorMessage("AIの下書きを作れませんでした");
          setState("error");
        }
      } finally {
        abortRef.current = null;
      }
    },
    [onDraft],
  );

  const beginRecording = useCallback(async () => {
    const requestToken = ++requestTokenRef.current;
    setErrorMessage(null);
    setElapsedSeconds(0);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErrorMessage("このブラウザでは音声を録音できません");
      setState("error");
      return;
    }

    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });

      if (!mountedRef.current || requestToken !== requestTokenRef.current) {
        stopTracks(stream);
        return;
      }

      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = selectAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      processOnStopRef.current = true;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const chunks = chunksRef.current;
        chunksRef.current = [];
        recorderRef.current = null;
        releaseStream();
        if (!processOnStopRef.current || !mountedRef.current) return;
        processOnStopRef.current = false;
        const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        if (audio.size === 0) {
          setErrorMessage("声が入っていません。もう一度話してください");
          setState("error");
          return;
        }
        void processAudio(audio);
      };

      recorder.start();
      startedAtRef.current = Date.now();
      setState("recording");
    } catch (error) {
      releaseStream();
      if (mountedRef.current) {
        setErrorMessage(microphoneErrorMessage(error));
        setState("error");
      }
    }
  }, [processAudio, releaseStream]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setState("processing");
    recorder.stop();
    releaseStream();
  }, [releaseStream]);

  const cancel = useCallback(() => {
    requestTokenRef.current += 1;
    processOnStopRef.current = false;
    abortRef.current?.abort();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    chunksRef.current = [];
    releaseStream();
    setErrorMessage(null);
    setState("idle");
  }, [releaseStream]);

  return (
    <section className="soft-card p-5 sm:p-8" aria-labelledby="voice-title">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#edf4f1] text-[var(--color-primary)]">
          <Mic aria-hidden="true" size={24} />
        </span>
        <div>
          <p className="eyebrow">ステップ 2</p>
          <h2 className="mt-1 text-xl font-semibold text-[var(--color-heading)]" id="voice-title">
            声で様子を伝える
          </h2>
          <p className="mt-1 text-sm text-[var(--color-secondary)]">
            短く話すだけで、確認できる下書きに整えます。
          </p>
        </div>
      </div>

      {errorMessage ? (
        <p className="mt-5 flex items-center gap-2 rounded-xl border border-[#e8c8aa] bg-[#fff7ed] px-4 py-3 text-sm font-semibold text-[#85572f]" role="alert">
          <AlertTriangle aria-hidden="true" size={20} />
          {errorMessage}
        </p>
      ) : null}

      {state === "recording" ? (
        <div className="mt-5 rounded-2xl bg-[#f9eee6] p-5 text-center" aria-live="polite">
          <span className="mx-auto block h-3 w-3 rounded-full bg-[#b85e4e]" />
          <p className="mt-2 font-semibold text-[var(--color-heading)]">録音中 {elapsedSeconds}秒</p>
          <p className="mt-1 text-sm text-[var(--color-secondary)]">終わったら停止してください</p>
        </div>
      ) : null}

      {state === "idle" ? (
        <button className="primary-button mt-5 w-full" onClick={beginRecording} type="button">
          <Mic aria-hidden="true" size={22} />
          声で話す
        </button>
      ) : null}

      {state === "requesting" ? (
        <div className="mt-5 grid gap-3">
          <p className="rounded-xl bg-[#f4f2eb] px-4 py-3 text-center text-sm font-semibold text-[var(--color-heading)]" aria-live="polite">
            マイクを準備しています…
          </p>
          <button className="secondary-button" onClick={cancel} type="button">
            <X aria-hidden="true" size={20} />
            中止
          </button>
        </div>
      ) : null}

      {state === "recording" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <button className="primary-button" onClick={stopRecording} type="button">
            <Square aria-hidden="true" size={20} />
            録音を停止
          </button>
          <button className="secondary-button" onClick={cancel} type="button">
            <X aria-hidden="true" size={20} />
            中止
          </button>
        </div>
      ) : null}

      {state === "processing" ? (
        <div className="mt-5 rounded-2xl bg-[#edf4f1] p-5 text-center" aria-live="polite">
          <p className="font-semibold text-[var(--color-heading)]">AIが下書きを整えています…</p>
          <p className="mt-1 text-sm text-[var(--color-secondary)]">音声は処理後に保持しません</p>
        </div>
      ) : null}

      {state === "error" ? (
        <button className="primary-button mt-5 w-full" onClick={beginRecording} type="button">
          <RotateCcw aria-hidden="true" size={21} />
          もう一度話す
        </button>
      ) : null}
    </section>
  );
}
