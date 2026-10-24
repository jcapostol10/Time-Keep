CREATE TYPE "public"."export_format" AS ENUM('csv', 'xlsx', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."export_report" AS ENUM('summary', 'detailed', 'weekly', 'project-status');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_kind" AS ENUM('summary', 'detailed', 'weekly');--> statement-breakpoint
CREATE TABLE "export_job" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"format" "export_format" NOT NULL,
	"report" "export_report" NOT NULL,
	"query" jsonb NOT NULL,
	"status" "export_status" DEFAULT 'queued' NOT NULL,
	"row_count" integer,
	"object_key" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "export_job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_share_link" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text NOT NULL,
	"token_hash" text NOT NULL,
	"kind" "report_kind" NOT NULL,
	"query" jsonb NOT NULL,
	"prefs" jsonb NOT NULL,
	"title" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_share_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_share_link" ADD CONSTRAINT "report_share_link_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_share_link" ADD CONSTRAINT "report_share_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_job_workspace_user_created_idx" ON "export_job" USING btree ("workspace_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "report_share_link_token_hash_uq" ON "report_share_link" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "report_share_link_workspace_created_idx" ON "report_share_link" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "time_entry_workspace_start_idx" ON "time_entry" USING btree ("workspace_id","start") WHERE "deleted_at" IS NULL AND "end" IS NOT NULL;