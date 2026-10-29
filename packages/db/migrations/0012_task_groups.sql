CREATE TYPE "public"."task_visibility" AS ENUM('EVERYONE', 'BY_GROUP');--> statement-breakpoint
CREATE TABLE "task_group" (
	"task_id" text NOT NULL,
	"group_id" text NOT NULL,
	"assigned_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_group_task_id_group_id_pk" PRIMARY KEY("task_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "task_group" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "task_visibility" "task_visibility" DEFAULT 'EVERYONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_group" ADD CONSTRAINT "task_group_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_group" ADD CONSTRAINT "task_group_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_group" ADD CONSTRAINT "task_group_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_group_group_id_idx" ON "task_group" USING btree ("group_id");