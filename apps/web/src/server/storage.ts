import "server-only";

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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
