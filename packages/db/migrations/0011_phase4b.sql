CREATE TYPE "public"."creator_setting" AS ENUM('admins', 'managers', 'everyone');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('work', 'break');--> statement-breakpoint
CREATE TYPE "public"."rounding_mode" AS ENUM('off', 'up', 'down', 'nearest');--> statement-breakpoint
CREATE TABLE "favorite_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"project_id" text,
	"task_id" text,
	"tag_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"billable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "favorite_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "rounding_mode" "rounding_mode" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "rounding_minutes" smallint DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "hidden_pages" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "members_see_team_time" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "project_creators" "creator_setting" DEFAULT 'admins' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "client_creators" "creator_setting" DEFAULT 'admins' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "task_creators" "creator_setting" DEFAULT 'admins' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tag_creators" "creator_setting" DEFAULT 'admins' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "required_fields" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "force_timer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "allow_breaks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "type" "entry_type" DEFAULT 'work' NOT NULL;--> statement-breakpoint
ALTER TABLE "favorite_entry" ADD CONSTRAINT "favorite_entry_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_entry" ADD CONSTRAINT "favorite_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_entry" ADD CONSTRAINT "favorite_entry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_entry" ADD CONSTRAINT "favorite_entry_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "favorite_entry_user_idx" ON "favorite_entry" USING btree ("workspace_id","user_id","created_at");