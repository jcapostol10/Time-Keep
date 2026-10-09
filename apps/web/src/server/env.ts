import "server-only";

import { z } from "zod";

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
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_SECURE: boolish,
  MAIL_FROM: z.string().default("TimeKeep <no-reply@timekeep.local>"),

  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("timekeep"),
  S3_ACCESS_KEY_ID: z.string().default("minioadmin"),
  S3_SECRET_ACCESS_KEY: z.string().default("minioadmin"),
  S3_PUBLIC_URL: z.string().url().default("http://localhost:9000/timekeep"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated process.env. Parsed once, on first use, so `next build` never needs secrets. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
      throw new Error(`Invalid environment:\n${issues.join("\n")}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function isGoogleAuthEnabled(): boolean {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}
