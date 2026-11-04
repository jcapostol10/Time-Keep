"use client";

import { parseQrPayload } from "@timekeep/core";
import jsQR from "jsqr";
import { useEffect, useEffectEvent, useRef, useState } from "react";

const SCAN_MS = 200;

/**
 * Reads QR codes from the device camera: a frame every 200 ms, decoded in the
 * browser. Only our own payloads reach `onScan`, one at a time; anything else
 * in view is ignored. The camera stops when this unmounts.
 */
export function QrScanner({ onScan }: { onScan: (payload: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const scanned = useEffectEvent(onScan);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let last: string | null = null;
    const canvas = document.createElement("canvas");

    function scan() {
      const v = video.current;
      if (!v || v.videoWidth === 0) return;
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(v, 0, 0);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, image.width, image.height)?.data ?? null;
      // A code left in view is read again and again: pass it on once.
      if (code === null || code === last || parseQrPayload(code) === null) return;
      last = code;
      scanned(code);
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (stopped || !video.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.current.srcObject = stream;
        await video.current.play();
        timer = setInterval(scan, SCAN_MS);
      } catch {
        if (!stopped) setFailed(true);
      }
    }

    void start();
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (failed) {
    return <p role="alert">The camera is not available. Enter your PIN instead.</p>;
  }
  return (
    <video
      ref={video}
      muted
      playsInline
      aria-label="Camera"
      className="aspect-video w-full max-w-md rounded-lg bg-black object-cover"
    />
  );
}
