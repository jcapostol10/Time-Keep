import { RECEIPT_MAX_BYTES, type ReceiptType, receiptExtension } from "@timekeep/core";

/**
 * Receipts are shrunk in the browser (decision 15): a photo is scaled to at
 * most 2,000 px and re-encoded as JPEG when it is larger than that or over
 * 4 MB, and a 320 px JPEG thumbnail is made; a PDF passes through as is.
 */

export const RECEIPT_MAX_SIDE = 2000;
export const THUMB_MAX_SIDE = 320;

export interface PreparedReceipt {
  file: Blob;
  mime: ReceiptType;
  extension: string;
  thumb: Blob | null;
}

/** The size that fits `w × h` inside a `max` square, keeping the ratio; never enlarged. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const scale = max / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

const IMAGE_TYPES: ReceiptType[] = ["image/jpeg", "image/png", "image/webp"];

async function drawJpeg(image: ImageBitmap, max: number, quality: number): Promise<Blob> {
  const { width, height } = fitWithin(image.width, image.height, max);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image"))),
      "image/jpeg",
      quality,
    );
  });
}

export async function prepareReceipt(file: File): Promise<PreparedReceipt> {
  if (file.type === "application/pdf") {
    return { file, mime: "application/pdf", extension: "pdf", thumb: null };
  }
  const declared = IMAGE_TYPES.find((t) => t === file.type);
  if (!declared) throw new Error("Receipts are JPEG, PNG, WebP or PDF files.");
  const image = await createImageBitmap(file);
  try {
    const thumb = await drawJpeg(image, THUMB_MAX_SIDE, 0.8);
    const tooBig =
      image.width > RECEIPT_MAX_SIDE ||
      image.height > RECEIPT_MAX_SIDE ||
      file.size > RECEIPT_MAX_BYTES;
    if (!tooBig) return { file, mime: declared, extension: receiptExtension(declared), thumb };
    const shrunk = await drawJpeg(image, RECEIPT_MAX_SIDE, 0.85);
    return { file: shrunk, mime: "image/jpeg", extension: "jpg", thumb };
  } finally {
    image.close();
  }
}
