CREATE TYPE "public"."target_kind" AS ENUM('UNDER', 'OVER');--> statement-breakpoint
CREATE TYPE "public"."target_period" AS ENUM('DAY', 'WEEK');--> statement-breakpoint
CREATE TYPE "public"."time_off_accrual" AS ENUM('NONE', 'YEARLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."time_off_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."time_off_unit" AS ENUM('DAYS', 'HOURS');--> statement-breakpoint
ALTER TYPE "public"."export_report" ADD VALUE 'attendance';--> statement-breakpoint
CREATE TABLE "holiday" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"repeats_yearly" boolean DEFAULT false NOT NULL,
	"source" text,
	"country" text,
	"estimated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holiday" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "holiday_assignee" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"group_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"holiday_id" text NOT NULL,
	CONSTRAINT "holiday_assignee_one_ck" CHECK (("user_id" IS NULL) <> ("group_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "holiday_assignee" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "target_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" "target_kind" NOT NULL,
	"period" "target_period" NOT NULL,
	"threshold_minutes" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"everyone" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "target_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "target_rule_assignee" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"group_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rule_id" text NOT NULL,
	CONSTRAINT "target_rule_assignee_one_ck" CHECK (("user_id" IS NULL) <> ("group_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "target_rule_assignee" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time_off_adjustment" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"amount_centi" integer NOT NULL,
	"effective_on" date NOT NULL,
	"note" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_off_adjustment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time_off_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"unit" time_off_unit NOT NULL,
	"accrual" time_off_accrual NOT NULL,
	"allowance_centi" integer DEFAULT 0 NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"everyone" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_off_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time_off_policy_assignee" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"group_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"policy_id" text NOT NULL,
	CONSTRAINT "time_off_policy_assignee_one_ck" CHECK (("user_id" IS NULL) <> ("group_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "time_off_policy_assignee" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time_off_request" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"half_day" boolean DEFAULT false NOT NULL,
	"minutes" integer,
	"amount_centi" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" time_off_status NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_off_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "daily_capacity_minutes" smallint DEFAULT 480 NOT NULL;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "weekly_capacity_minutes" smallint DEFAULT 2400 NOT NULL;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "working_days" smallint[] DEFAULT '{1,2,3,4,5}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_assignee" ADD CONSTRAINT "holiday_assignee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_assignee" ADD CONSTRAINT "holiday_assignee_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_assignee" ADD CONSTRAINT "holiday_assignee_holiday_id_holiday_id_fk" FOREIGN KEY ("holiday_id") REFERENCES "public"."holiday"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_rule" ADD CONSTRAINT "target_rule_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_rule_assignee" ADD CONSTRAINT "target_rule_assignee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_rule_assignee" ADD CONSTRAINT "target_rule_assignee_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_rule_assignee" ADD CONSTRAINT "target_rule_assignee_rule_id_target_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."target_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_adjustment" ADD CONSTRAINT "time_off_adjustment_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_adjustment" ADD CONSTRAINT "time_off_adjustment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_adjustment" ADD CONSTRAINT "time_off_adjustment_policy_id_time_off_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."time_off_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_adjustment" ADD CONSTRAINT "time_off_adjustment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_policy" ADD CONSTRAINT "time_off_policy_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_policy_assignee" ADD CONSTRAINT "time_off_policy_assignee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_policy_assignee" ADD CONSTRAINT "time_off_policy_assignee_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_policy_assignee" ADD CONSTRAINT "time_off_policy_assignee_policy_id_time_off_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."time_off_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_request" ADD CONSTRAINT "time_off_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_request" ADD CONSTRAINT "time_off_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_request" ADD CONSTRAINT "time_off_request_policy_id_time_off_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."time_off_policy"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_request" ADD CONSTRAINT "time_off_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_workspace_date_name_uq" ON "holiday" USING btree ("workspace_id","date","name");--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_assignee_user_uq" ON "holiday_assignee" USING btree ("holiday_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_assignee_group_uq" ON "holiday_assignee" USING btree ("holiday_id","group_id");--> statement-breakpoint
CREATE INDEX "target_rule_workspace_idx" ON "target_rule" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "target_rule_assignee_user_uq" ON "target_rule_assignee" USING btree ("rule_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "target_rule_assignee_group_uq" ON "target_rule_assignee" USING btree ("rule_id","group_id");--> statement-breakpoint
CREATE INDEX "time_off_adjustment_user_idx" ON "time_off_adjustment" USING btree ("workspace_id","user_id","policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_off_policy_workspace_name_uq" ON "time_off_policy" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "time_off_policy_assignee_user_uq" ON "time_off_policy_assignee" USING btree ("policy_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_off_policy_assignee_group_uq" ON "time_off_policy_assignee" USING btree ("policy_id","group_id");--> statement-breakpoint
CREATE INDEX "time_off_request_user_dates_idx" ON "time_off_request" USING btree ("workspace_id","user_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "time_off_request_status_idx" ON "time_off_request" USING btree ("workspace_id","status","start_date");