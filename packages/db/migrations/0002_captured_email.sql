CREATE TABLE "captured_email" (
	"id" text PRIMARY KEY NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "captured_email_to_created_idx" ON "captured_email" USING btree ("to_address","created_at" DESC NULLS LAST);