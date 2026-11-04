import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import jsQR from "jsqr";
import { afterAll, describe, expect, it } from "vitest";

import { QR_VIDEO_HEIGHT, QR_VIDEO_WIDTH, qrVideoFile } from "./qr-video";

const dir = mkdtempSync(path.join(tmpdir(), "qr-video-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("qrVideoFile", () => {
  it("writes ten 640x480 I420 frames whose first frame decodes to the text", async () => {
    const text = `tkq1.${"a".repeat(43)}`;
    const bytes = readFileSync(await qrVideoFile(text, dir));
    const header = bytes.subarray(0, bytes.indexOf(0x0a) + 1).toString("ascii");
    expect(header).toBe(`YUV4MPEG2 W${QR_VIDEO_WIDTH} H${QR_VIDEO_HEIGHT} F10:1 Ip A1:1 C420\n`);
    const frame = QR_VIDEO_WIDTH * QR_VIDEO_HEIGHT * 1.5;
    expect(bytes.length).toBe(header.length + 10 * (6 + frame));

    const y = bytes.subarray(
      header.length + 6,
      header.length + 6 + QR_VIDEO_WIDTH * QR_VIDEO_HEIGHT,
    );
    const rgba = new Uint8ClampedArray(y.length * 4);
    y.forEach((v, i) => rgba.set([v, v, v, 255], i * 4));
    expect(jsQR(rgba, QR_VIDEO_WIDTH, QR_VIDEO_HEIGHT)?.data).toBe(text);
  });
});
