import "server-only";

import { z } from "zod";

import { resolveAppUrl } from "./app-url";

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),
  /** Optional: unset on Vercel previews, where the deployment URL is used (see app-url.ts). */
  BETTER_AUTH_URL: optionalString,
  NEXT_PUBLIC_APP_URL: optionalString,
  VERCEL_ENV: optionalString,
  VERCEL_URL: optionalString,
  VERCEL_BRANCH_URL: optionalString,

  /** Preview deployments only: store outgoing email instead of sending it (e2e reads it). */
  MAIL_CAPTURE: boolish,
  /** Shared secret for the preview-only test endpoints. */
  E2E_SECRET: optionalString,

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  /** Better Auth rate limiting. Defaults to on in production, off elsewhere (e2e hammers sign-in). */
  AUTH_RATE_LIMIT_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? process.env.NODE_ENV === "production" : v === "true")),

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_SECURE: boolish,
  MAIL_FROM: z.string().default("TimeKeep <no-reply@timekeep.local>"),

  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("timekeep"),
  S3_ACCESS_KEY_ID: z.string().default("rustfsadmin"),
  S3_SECRET_ACCESS_KEY: z.string().default("rustfsadmin"),
  S3_PUBLIC_URL: z.string().url().default("http://localhost:9000/timekeep"),
});

export type Env = z.infer<typeof schema> & { APP_URL: string };

let cached: Env | undefined;

/** Validated process.env. Parsed once, on first use, so `next build` never needs secrets. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
      throw new Error(`Invalid environment:\n${issues.join("\n")}`);
    }
    cached = { ...parsed.data, APP_URL: resolveAppUrl(parsed.data) };
  }
  return cached;
}

export function isGoogleAuthEnabled(): boolean {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}
