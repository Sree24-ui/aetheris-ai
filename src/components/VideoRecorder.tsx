"use client";

import { useRef, useState } from "react";

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

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export default function VideoRecorder() {
  const [recording, setRecording] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileExtension, setFileExtension] = useState("webm");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  async function start() {
    setError(null);
    setDownloadUrl(null);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = pickSupportedMimeType();
      const container = mimeType?.split(";")[0] ?? "video/webm";
      setFileExtension(container === "video/mp4" ? "mp4" : "webm");
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: container });
        setDownloadUrl(URL.createObjectURL(blob));
        stream!.getTracks().forEach((t) => t.stop());
      };
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        stopRecording();
      });
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      // Whatever failed (permission denial, or MediaRecorder rejecting an
      // unsupported setup after capture already started), release any
      // acquired tracks so the browser's "sharing this tab" indicator
      // doesn't stay active in the background.
      stream?.getTracks().forEach((t) => t.stop());
      setError(
        "Screen capture was not started (permission denied or unsupported). Choose 'This Tab' and enable 'Share tab audio' when prompted."
      );
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div className="flex items-center gap-3 text-xs">
      {!recording ? (
        <button
          onClick={start}
          className="px-3 py-1.5 rounded-full border border-error/50 text-error hover:bg-error-container/20"
          title="Captures this browser tab (video + audio) into a downloadable teaching video. Choose 'This Tab' and enable tab audio when prompted."
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
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={`ai-teacher-lesson.${fileExtension}`}
          className="px-3 py-1.5 rounded-full border border-secondary/50 text-secondary-fixed-dim"
        >
          ⬇ Download video
        </a>
      )}
      {error && <span className="text-error">{error}</span>}
    </div>
  );
}
