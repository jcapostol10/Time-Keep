import { writeFileSync } from "node:fs";
import path from "node:path";

import QRCode from "qrcode";

/**
 * A fake camera for the QR punch test: Chromium plays a Y4M file through
 * getUserMedia with `--use-file-for-fake-video-capture`. The file holds ten
 * identical 640x480 I420 frames showing `text` as a QR code (8 px modules,
 * a white quiet zone), which the kiosk's scanner loops over.
 */

export const QR_VIDEO_WIDTH = 640;
export const QR_VIDEO_HEIGHT = 480;
const FRAMES = 10;
const MODULE_PX = 8;
// Video-range luma: 16 is black, 235 white.
const BLACK = 16;
const WHITE = 235;

export async function qrVideoFile(text: string, dir: string): Promise<string> {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const luma = new Uint8Array(QR_VIDEO_WIDTH * QR_VIDEO_HEIGHT).fill(WHITE);
  const left = Math.floor((QR_VIDEO_WIDTH - size * MODULE_PX) / 2);
  const top = Math.floor((QR_VIDEO_HEIGHT - size * MODULE_PX) / 2);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!qr.modules.get(row, col)) continue;
      for (let y = 0; y < MODULE_PX; y++) {
        const start = (top + row * MODULE_PX + y) * QR_VIDEO_WIDTH + left + col * MODULE_PX;
        luma.fill(BLACK, start, start + MODULE_PX);
      }
    }
  }
  const chroma = new Uint8Array((QR_VIDEO_WIDTH * QR_VIDEO_HEIGHT) / 2).fill(128);
  const header = `YUV4MPEG2 W${QR_VIDEO_WIDTH} H${QR_VIDEO_HEIGHT} F10:1 Ip A1:1 C420\n`;
  const frame = Buffer.concat([Buffer.from("FRAME\n"), luma, chroma]);
  const file = path.join(dir, `qr-${Date.now()}.y4m`);
  writeFileSync(
    file,
    Buffer.concat([Buffer.from(header), ...Array.from({ length: FRAMES }, () => frame)]),
  );
  return file;
}
