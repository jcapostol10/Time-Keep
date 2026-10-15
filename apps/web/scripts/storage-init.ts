/**
 * Prepare the S3-compatible bucket for local development and CI:
 * create it if missing and allow anonymous reads of avatars and logos.
 * Works against RustFS, MinIO, LocalStack or real S3, so no vendor CLI is needed.
 *
 *   pnpm storage:init   (reads S3_* from the root .env)
 */
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
const region = process.env.S3_REGION ?? "us-east-1";
const bucket = process.env.S3_BUCKET ?? "timekeep";
const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? "rustfsadmin";
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? "rustfsadmin";
const publicUrl = (process.env.S3_PUBLIC_URL ?? `${endpoint}/${bucket}`).replace(/\/$/, "");

/** Object key prefixes that must be readable without credentials. */
const PUBLIC_PREFIXES = ["avatars/*", "logos/*", "public/*"];

const client = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

async function waitForEndpoint(attempts = 30): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return;
    } catch (error) {
      const name = (error as { name?: string }).name ?? "";
      // 404/403 mean the server answered; anything else means it is not up yet.
      if (
        name === "NotFound" ||
        name === "NoSuchBucket" ||
        name === "Forbidden" ||
        name === "403"
      ) {
        return;
      }
      if (i === attempts) throw error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.info(`[storage] bucket "${bucket}" exists`);
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.info(`[storage] created bucket "${bucket}"`);
  }
}

async function allowPublicReads(): Promise<void> {
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "PublicReadForAssets",
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: PUBLIC_PREFIXES.map((p) => `arn:aws:s3:::${bucket}/${p}`),
      },
    ],
  };
  await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) }));
  console.info(`[storage] public read enabled for ${PUBLIC_PREFIXES.join(", ")}`);
}

async function verifyAnonymousRead(): Promise<void> {
  const key = "public/.probe";
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: "ok", ContentType: "text/plain" }),
  );
  const res = await fetch(`${publicUrl}/${key}`).catch(() => null);
  if (res?.ok) {
    console.info(`[storage] anonymous read OK via ${publicUrl}`);
  } else {
    console.warn(
      `[storage] WARNING: anonymous read of ${publicUrl}/${key} returned ${res?.status ?? "no response"}; avatars will not render until the bucket policy allows public GetObject.`,
    );
  }
}

/** Supabase Storage has no S3 bucket policies; its bucket is made public in Supabase itself. */
const isSupabase = new URL(endpoint).hostname.endsWith(".supabase.co");

async function main() {
  await waitForEndpoint();
  await ensureBucket();
  if (isSupabase) {
    console.info(
      "[storage] Supabase Storage: skipping bucket policy (the bucket is public in Supabase)",
    );
  } else {
    await allowPublicReads();
  }
  await verifyAnonymousRead();
}

main().catch((error) => {
  console.error("[storage] init failed", error);
  process.exit(1);
});
