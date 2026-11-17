CREATE TABLE "daily_job_run" (
	"workspace_id" text NOT NULL,
	"local_date" date NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "daily_job_run_workspace_id_local_date_pk" PRIMARY KEY("workspace_id","local_date")
);
--> statement-breakpoint
ALTER TABLE "daily_job_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kiosk" ADD COLUMN "tag_id" text;--> statement-breakpoint
ALTER TABLE "daily_job_run" ADD CONSTRAINT "daily_job_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk" ADD CONSTRAINT "kiosk_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE set null ON UPDATE no action;