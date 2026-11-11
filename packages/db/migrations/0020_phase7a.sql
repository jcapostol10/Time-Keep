CREATE TYPE "public"."hours_mode" AS ENUM('PER_DAY', 'TOTAL');--> statement-breakpoint
CREATE TABLE "assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"mode" "hours_mode" NOT NULL,
	"minutes_per_day" integer,
	"total_minutes" integer,
	"include_non_working" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"repeat_weeks" smallint,
	"repeat_until" date,
	"published" boolean DEFAULT false NOT NULL,
	"replaces_id" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_dates_ck" CHECK ("assignment"."end_date" >= "assignment"."start_date"),
	CONSTRAINT "assignment_amount_ck" CHECK (("assignment"."mode" = 'PER_DAY' and "assignment"."minutes_per_day" is not null) or ("assignment"."mode" = 'TOTAL' and "assignment"."total_minutes" is not null)),
	CONSTRAINT "assignment_repeat_ck" CHECK (("assignment"."repeat_weeks" is null) = ("assignment"."repeat_until" is null)),
	CONSTRAINT "assignment_tombstone_ck" CHECK (not "assignment"."deleted" or ("assignment"."replaces_id" is not null and not "assignment"."published"))
);
--> statement-breakpoint
ALTER TABLE "assignment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assignment_publish" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_publish" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "milestone" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "milestone" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_replaces_id_assignment_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_publish" ADD CONSTRAINT "assignment_publish_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_publish" ADD CONSTRAINT "assignment_publish_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_workspace_user_start_idx" ON "assignment" USING btree ("workspace_id","user_id","start_date");--> statement-breakpoint
CREATE INDEX "assignment_workspace_project_start_idx" ON "assignment" USING btree ("workspace_id","project_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_replaces_uq" ON "assignment" USING btree ("replaces_id") WHERE "replaces_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assignment_publish_workspace_idx" ON "assignment_publish" USING btree ("workspace_id","published_at");--> statement-breakpoint
CREATE INDEX "milestone_workspace_date_idx" ON "milestone" USING btree ("workspace_id","date");