import "server-only";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "./env";

let client: S3Client | undefined;

function getClient(): S3Client {
  if (!client) {
    const e = env();
    client = new S3Client({
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      // RustFS, MinIO and most self-hosted S3 implementations need path-style URLs.
      forcePathStyle: true,
      credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
    });
  }
  return client;
}

export async function uploadObject(args: {
  key: string;
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
}): Promise<{ url: string }> {
  const e = env();
  await getClient().send(
    new PutObjectCommand({
      Bucket: e.S3_BUCKET,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
      CacheControl: args.cacheControl ?? "public, max-age=31536000, immutable",
    }),
  );
  return { url: publicObjectUrl(args.key) };
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
}

export function publicObjectUrl(key: string): string {
  return `${env().S3_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
}

/** Inverse of publicObjectUrl; null when the URL is not in our bucket. */
export function objectKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const base = `${env().S3_PUBLIC_URL.replace(/\/$/, "")}/`;
  return url.startsWith(base) ? url.slice(base.length) : null;
}

/**
 * Report exports live in their own private bucket (S3_EXPORT_BUCKET): the
 * main bucket is public on Supabase, which has no per-prefix policies.
 */
export async function uploadExport(args: {
  key: string;
  body: Uint8Array;
  contentType: string;
}): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: env().S3_EXPORT_BUCKET,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
      CacheControl: "private, no-store",
    }),
  );
}

/** S3 refuses a part under 5 MB unless it is the last one. */
const PART_BYTES = 8 * 1024 * 1024;

/**
 * Stores a file that arrives in chunks (the receipts zip) without holding it
 * whole: a multipart upload, one part in memory at a time. A failure aborts
 * the upload, so no parts are left behind.
 */
export async function uploadExportStream(args: {
  key: string;
  chunks: AsyncIterable<Uint8Array>;
  contentType: string;
}): Promise<void> {
  const client = getClient();
  const target = { Bucket: env().S3_EXPORT_BUCKET, Key: args.key };
  const { UploadId } = await client.send(
    new CreateMultipartUploadCommand({
      ...target,
      ContentType: args.contentType,
      CacheControl: "private, no-store",
    }),
  );
  if (!UploadId) throw new Error(`No upload id for ${args.key}`);
  const parts: { ETag: string | undefined; PartNumber: number }[] = [];
  const send = async (body: Uint8Array) => {
    const PartNumber = parts.length + 1;
    const out = await client.send(
      new UploadPartCommand({ ...target, UploadId, PartNumber, Body: body }),
    );
    parts.push({ ETag: out.ETag, PartNumber });
  };
  try {
    let pending: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of args.chunks) {
      pending.push(chunk);
      size += chunk.byteLength;
      if (size >= PART_BYTES) {
        await send(concat(pending, size));
        pending = [];
        size = 0;
      }
    }
    // The last part may be any size; an empty file still needs one part.
    if (size > 0 || parts.length === 0) await send(concat(pending, size));
    await client.send(
      new CompleteMultipartUploadCommand({
        ...target,
        UploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  } catch (error) {
    await client
      .send(new AbortMultipartUploadCommand({ ...target, UploadId }))
      .catch((abortError: unknown) =>
        console.error("[storage] abort failed", args.key, abortError),
      );
    throw error;
  }
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** A short-lived download link that saves the file under `filename` (or shows it, `inline`). */
export async function presignedExportUrl(
  key: string,
  ttlSeconds: number,
  filename: string,
  opts: { inline?: boolean } = {},
): Promise<string> {
  const safe = filename.replace(/[^\w.\- ]+/g, "_");
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: env().S3_EXPORT_BUCKET,
      Key: key,
      ResponseContentDisposition: `${opts.inline ? "inline" : "attachment"}; filename="${safe}"`,
    }),
    { expiresIn: ttlSeconds },
  );
}

export async function deleteExport(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: env().S3_EXPORT_BUCKET, Key: key }));
}

/** The bytes of a file in the private bucket (a receipt the zip job bundles). */
export async function getExport(key: string): Promise<Uint8Array> {
  const out = await getClient().send(
    new GetObjectCommand({ Bucket: env().S3_EXPORT_BUCKET, Key: key }),
  );
  if (!out.Body) throw new Error(`Empty object: ${key}`);
  return out.Body.transformToByteArray();
}

/**
 * Deletes export files last written before `olderThan`, up to one listing
 * page (1,000 keys) per call; the next call takes the rest. Returns how many
 * it deleted. One delete per key: not every S3-compatible backend accepts
 * the batch call the way the SDK sends it.
 */
export async function sweepExports(olderThan: Date, prefix = "exports/"): Promise<number> {
  const bucket = env().S3_EXPORT_BUCKET;
  const listing = await getClient().send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  const old = (listing.Contents ?? []).filter(
    (o) => o.Key && o.LastModified && o.LastModified < olderThan,
  );
  for (const o of old) {
    await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: o.Key }));
  }
  return old.length;
}
