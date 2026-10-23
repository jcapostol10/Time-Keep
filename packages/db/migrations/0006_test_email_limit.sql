ALTER TABLE "user_settings" ADD COLUMN "test_email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "test_email_count" smallint DEFAULT 0 NOT NULL;