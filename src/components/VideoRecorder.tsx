"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Preference order for the recorded container/codec. Not every browser
// supports vp9 (Safari notably doesn't), so probe instead of hardcoding one
// string — an unsupported mimeType throws synchronously from the
// MediaRecorder constructor and, uncaught, looks identical to a denied
// permission even though capture actually succeeded.
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

/**
 * Recording bounds (M11).
 *
 * The whole recording is held in browser memory as an array of Blob chunks
 * until it is stopped, so an unbounded recording is an unbounded allocation
 * in the learner's tab. A 30-minute cap and a 512 MB cap both stop on their
 * own and keep what was captured up to that point, which is far better than
 * the tab being killed with nothing to show.
 */
const MAX_DURATION_MS = 30 * 60_000;
const MAX_BYTES = 512 * 1024 * 1024;
/** How often the recorder hands over a chunk, so size can be measured. */
const CHUNK_INTERVAL_MS = 1000;

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function formatMinutes(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function VideoRecorder() {
  const [recording, setRecording] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileExtension, setFileExtension] = useState("webm");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bytesRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  // Object URLs are held so they can be revoked; a URL that is never revoked
  // pins its whole blob in memory for the life of the document.
  const objectUrlRef = useRef<string | null>(null);

  /** Releases the camera/screen capture. The browser's indicator stays on until this runs. */
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const revokeDownload = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    setRecording(false);
  }, []);

  // Unmounting mid-recording used to leave the tracks live, so the browser
  // kept showing "sharing this tab" for a capture nothing was listening to,
  // and the blob URL was never revoked.
  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      releaseStream();
      revokeDownload();
    };
  }, [releaseStream, revokeDownload]);

  // Elapsed time drives both the on-screen counter and the duration cap.
  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setElapsedMs(elapsed);
      if (elapsed >= MAX_DURATION_MS) {
        setNotice(
          `Recording stopped at the ${MAX_DURATION_MS / 60_000}-minute limit. What was captured is ready to download.`
        );
        stopRecording();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [recording, stopRecording]);

  async function start() {
    setError(null);
    setNotice(null);
    setElapsedMs(0);
    // The previous recording's blob is released before a new one replaces it.
    revokeDownload();
    setDownloadUrl(null);

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      streamRef.current = stream;
      chunksRef.current = [];
      bytesRef.current = 0;

      const mimeType = pickSupportedMimeType();
      const container = mimeType?.split(";")[0] ?? "video/webm";
      setFileExtension(container === "video/mp4" ? "mp4" : "webm");

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        chunksRef.current.push(e.data);
        bytesRef.current += e.data.size;
        if (bytesRef.current >= MAX_BYTES) {
          setNotice(
            `Recording stopped at the ${Math.round(MAX_BYTES / (1024 * 1024))} MB limit. What was captured is ready to download.`
          );
          stopRecording();
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: container });
        // Dropped as soon as the blob exists: keeping both doubles the
        // recording's footprint until the page is reloaded.
        chunksRef.current = [];
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setDownloadUrl(url);
        releaseStream();
      };
      // The learner can also end the capture from the browser's own bar.
      stream.getVideoTracks()[0].addEventListener("ended", () => stopRecording());

      recorder.start(CHUNK_INTERVAL_MS);
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      // Whatever failed (permission denial, or MediaRecorder rejecting an
      // unsupported setup after capture already started), release any
      // acquired tracks so the browser's "sharing this tab" indicator
      // doesn't stay active in the background.
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setError(
        "Screen capture was not started (permission denied or unsupported). Choose 'This Tab' and enable 'Share tab audio' when prompted."
      );
    }
  }

  return (
    <div className="flex items-center gap-3 text-xs flex-wrap">
      {!recording ? (
        <button
          onClick={start}
          className="px-3 py-1.5 rounded-full border border-error/50 text-error hover:bg-error-container/20"
          title={`Captures this browser tab (video + audio) into a downloadable teaching video. Choose 'This Tab' and enable tab audio when prompted. Stops automatically after ${MAX_DURATION_MS / 60_000} minutes.`}
        >
          ● Record teaching video
        </button>
      ) : (
        <button
          onClick={stopRecording}
          className="px-3 py-1.5 rounded-full bg-error text-on-error animate-pulse"
        >
          ■ Stop recording
        </button>
      )}
      {recording && (
        <span aria-live="polite" className="text-on-surface-variant tabular-nums">
          {formatMinutes(elapsedMs)} / {formatMinutes(MAX_DURATION_MS)}
        </span>
      )}
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={`aetheris-ai-lesson.${fileExtension}`}
          className="px-3 py-1.5 rounded-full border border-secondary/50 text-secondary-fixed-dim"
        >
          ⬇ Download video
        </a>
      )}
      {notice && (
        <span role="status" className="text-on-surface-variant">
          {notice}
        </span>
      )}
      {error && (
        <span role="alert" className="text-error">
          {error}
        </span>
      )}
    </div>
  );
}
