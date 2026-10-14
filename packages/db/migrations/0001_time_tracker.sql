CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"project_id" text,
	"task_id" text,
	"billable" boolean DEFAULT false NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone,
	"duration_seconds" integer,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entry_tag" (
	"time_entry_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "time_entry_tag_time_entry_id_tag_id_pk" PRIMARY KEY("time_entry_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"idle_detection_minutes" smallint,
	"pomodoro_enabled" boolean DEFAULT false NOT NULL,
	"pomodoro_focus_minutes" smallint DEFAULT 25 NOT NULL,
	"pomodoro_break_minutes" smallint DEFAULT 5 NOT NULL,
	"reminders_enabled" boolean DEFAULT false NOT NULL,
	"reminder_days" smallint[] DEFAULT '{1,2,3,4,5}'::smallint[] NOT NULL,
	"reminder_start_minutes" smallint DEFAULT 540 NOT NULL,
	"reminder_end_minutes" smallint DEFAULT 1020 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_tag" ADD CONSTRAINT "time_entry_tag_time_entry_id_time_entry_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_tag" ADD CONSTRAINT "time_entry_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_workspace_name_uq" ON "project" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "project_workspace_id_idx" ON "project" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_workspace_name_uq" ON "tag" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "tag_workspace_id_idx" ON "tag" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "time_entry_workspace_user_start_idx" ON "time_entry" USING btree ("workspace_id","user_id","start" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "time_entry_project_id_idx" ON "time_entry" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entry_one_running_uq" ON "time_entry" USING btree ("workspace_id","user_id") WHERE "end" IS NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "time_entry_tag_tag_id_idx" ON "time_entry_tag" USING btree ("tag_id");