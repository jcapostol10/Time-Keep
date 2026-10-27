CREATE TYPE "public"."rate_kind" AS ENUM('billable', 'cost');--> statement-breakpoint
CREATE TYPE "public"."rate_level" AS ENUM('task', 'project_member', 'project', 'member', 'workspace');--> statement-breakpoint
CREATE TYPE "public"."rate_recalc_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "invitation_group" (
	"invitation_id" text NOT NULL,
	"group_id" text NOT NULL,
	CONSTRAINT "invitation_group_invitation_id_group_id_pk" PRIMARY KEY("invitation_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "invitation_group" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "managed_group" (
	"workspace_id" text NOT NULL,
	"manager_id" text NOT NULL,
	"group_id" text NOT NULL,
	CONSTRAINT "managed_group_workspace_id_manager_id_group_id_pk" PRIMARY KEY("workspace_id","manager_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "managed_group" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "managed_user" (
	"workspace_id" text NOT NULL,
	"manager_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "managed_user_workspace_id_manager_id_user_id_pk" PRIMARY KEY("workspace_id","manager_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "managed_user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_group" (
	"project_id" text NOT NULL,
	"group_id" text NOT NULL,
	CONSTRAINT "project_group_project_id_group_id_pk" PRIMARY KEY("project_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "project_group" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_group" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_group" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_group_member" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "user_group_member_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "user_group_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" "rate_kind" DEFAULT 'billable' NOT NULL,
	"level" "rate_level" NOT NULL,
	"user_id" text,
	"project_id" text,
	"task_id" text,
	"amount_minor" bigint,
	"currency" char(3) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_level_target_from_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","kind","level","user_id","project_id","task_id","effective_from")
);
--> statement-breakpoint
ALTER TABLE "rate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_recalc_job" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"from" timestamp with time zone NOT NULL,
	"status" "rate_recalc_status" DEFAULT 'queued' NOT NULL,
	"total" integer,
	"processed" integer DEFAULT 0 NOT NULL,
	"cursor_start" timestamp with time zone,
	"cursor_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "rate_recalc_job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "is_manager" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "billable_rate_minor" bigint;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "rate_currency" char(3);--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "rate_source" "rate_level";--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "report_share_link" ADD COLUMN "include_amounts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation_group" ADD CONSTRAINT "invitation_group_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_group" ADD CONSTRAINT "invitation_group_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_group" ADD CONSTRAINT "managed_group_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_group" ADD CONSTRAINT "managed_group_manager_id_user_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_group" ADD CONSTRAINT "managed_group_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_user" ADD CONSTRAINT "managed_user_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_user" ADD CONSTRAINT "managed_user_manager_id_user_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_user" ADD CONSTRAINT "managed_user_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group" ADD CONSTRAINT "project_group_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group" ADD CONSTRAINT "project_group_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group" ADD CONSTRAINT "user_group_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_member" ADD CONSTRAINT "user_group_member_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_member" ADD CONSTRAINT "user_group_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate" ADD CONSTRAINT "rate_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate" ADD CONSTRAINT "rate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate" ADD CONSTRAINT "rate_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate" ADD CONSTRAINT "rate_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate" ADD CONSTRAINT "rate_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_recalc_job" ADD CONSTRAINT "rate_recalc_job_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_recalc_job" ADD CONSTRAINT "rate_recalc_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_group_group_id_idx" ON "managed_group" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "project_group_group_id_idx" ON "project_group" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_group_workspace_name_uq" ON "user_group" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "user_group_workspace_id_idx" ON "user_group" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "user_group_member_user_id_idx" ON "user_group_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rate_lookup_idx" ON "rate" USING btree ("workspace_id","kind","level","project_id","task_id","user_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "rate_recalc_job_workspace_created_idx" ON "rate_recalc_job" USING btree ("workspace_id","created_at" DESC NULLS LAST);