const SETTLE_MS = 400;
const JPEG_QUALITY = 0.8;
const MAX_WIDTH = 640;

/**
 * One frame from the device camera as a JPEG, or null when the camera is
 * unavailable: a clock in never waits on the photo (ruling R5). The camera is
 * on only for this call.
 */
export async function capturePhoto(): Promise<Blob | null> {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // The first frames of a camera are often dark.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
  } catch {
    return null;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}
