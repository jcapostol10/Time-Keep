CREATE TYPE "public"."kiosk_attempt_method" AS ENUM('PIN', 'QR');--> statement-breakpoint
CREATE TABLE "kiosk" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" text,
	"task_id" text,
	"everyone" boolean DEFAULT true NOT NULL,
	"session_timeout_seconds" smallint DEFAULT 15 NOT NULL,
	"show_logo" boolean DEFAULT true NOT NULL,
	"photo" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kiosk" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kiosk_assignee" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"group_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kiosk_id" text NOT NULL,
	CONSTRAINT "kiosk_assignee_one_ck" CHECK (("user_id" IS NULL) <> ("group_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "kiosk_assignee" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kiosk_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"kiosk_id" text NOT NULL,
	"user_id" text,
	"method" "kiosk_attempt_method" NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kiosk_attempt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kiosk_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"pin_hash" text,
	"pin_set_at" timestamp with time zone,
	"qr_token_hash" text,
	"qr_rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kiosk_credential" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kiosk_photo" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"object_key" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kiosk_photo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "limited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kiosk" ADD CONSTRAINT "kiosk_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk" ADD CONSTRAINT "kiosk_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk" ADD CONSTRAINT "kiosk_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk" ADD CONSTRAINT "kiosk_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_assignee" ADD CONSTRAINT "kiosk_assignee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_assignee" ADD CONSTRAINT "kiosk_assignee_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_assignee" ADD CONSTRAINT "kiosk_assignee_kiosk_id_kiosk_id_fk" FOREIGN KEY ("kiosk_id") REFERENCES "public"."kiosk"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_attempt" ADD CONSTRAINT "kiosk_attempt_kiosk_id_kiosk_id_fk" FOREIGN KEY ("kiosk_id") REFERENCES "public"."kiosk"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_attempt" ADD CONSTRAINT "kiosk_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_credential" ADD CONSTRAINT "kiosk_credential_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_credential" ADD CONSTRAINT "kiosk_credential_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_photo" ADD CONSTRAINT "kiosk_photo_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_photo" ADD CONSTRAINT "kiosk_photo_entry_id_time_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."time_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kiosk_token_hash_uq" ON "kiosk" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "kiosk_workspace_id_idx" ON "kiosk" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kiosk_assignee_user_uq" ON "kiosk_assignee" USING btree ("kiosk_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kiosk_assignee_group_uq" ON "kiosk_assignee" USING btree ("kiosk_id","group_id");--> statement-breakpoint
CREATE INDEX "kiosk_attempt_kiosk_created_idx" ON "kiosk_attempt" USING btree ("kiosk_id","created_at");--> statement-breakpoint
CREATE INDEX "kiosk_attempt_kiosk_user_created_idx" ON "kiosk_attempt" USING btree ("kiosk_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kiosk_credential_workspace_user_uq" ON "kiosk_credential" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kiosk_credential_qr_token_hash_uq" ON "kiosk_credential" USING btree ("qr_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "kiosk_photo_entry_uq" ON "kiosk_photo" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "kiosk_photo_taken_at_idx" ON "kiosk_photo" USING btree ("taken_at");