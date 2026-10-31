CREATE TYPE "public"."approval_action" AS ENUM('SUBMIT', 'WITHDRAW', 'APPROVE', 'REJECT', 'REOPEN', 'ADMIN_EDIT', 'AUTO_WITHDRAW');--> statement-breakpoint
CREATE TYPE "public"."approval_period" AS ENUM('WEEKLY', 'SEMI_MONTHLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."approval_reviewers" AS ENUM('ADMINS', 'TEAM_MANAGERS', 'PROJECT_MANAGERS');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."lock_mode" AS ENUM('OFF', 'FIXED', 'ROLLING');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "approval_event" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"request_id" text,
	"user_id" text NOT NULL,
	"actor_id" text,
	"action" "approval_action" NOT NULL,
	"note" text,
	"entry_id" text,
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "approval_request" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "approval_status" NOT NULL,
	"work_seconds" bigint DEFAULT 0 NOT NULL,
	"billable_seconds" bigint DEFAULT 0 NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"kind" text NOT NULL,
	"status" "outbox_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "approval_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "approval_period" "approval_period" DEFAULT 'WEEKLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "approval_reviewers" "approval_reviewers" DEFAULT 'ADMINS' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "lock_mode" "lock_mode" DEFAULT 'OFF' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "lock_date" date;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "lock_days" smallint;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "mute_target_reminders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_event" ADD CONSTRAINT "approval_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_event" ADD CONSTRAINT "approval_event_request_id_approval_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_event" ADD CONSTRAINT "approval_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_event" ADD CONSTRAINT "approval_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_event_user_created_idx" ON "approval_event" USING btree ("workspace_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_event_request_idx" ON "approval_event" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_request_user_start_uq" ON "approval_request" USING btree ("workspace_id","user_id","period_start");--> statement-breakpoint
CREATE INDEX "approval_request_cover_idx" ON "approval_request" USING btree ("workspace_id","user_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "approval_request_status_idx" ON "approval_request" USING btree ("workspace_id","status","period_start");--> statement-breakpoint
CREATE INDEX "email_outbox_due_idx" ON "email_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "email_outbox_kind_idx" ON "email_outbox" USING btree ("workspace_id","kind");