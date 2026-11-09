CREATE TYPE "public"."estimate_kind" AS ENUM('NONE', 'TIME', 'MONEY');--> statement-breakpoint
CREATE TYPE "public"."estimate_reset" AS ENUM('NONE', 'MONTHLY');--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "budget_thresholds" smallint[] DEFAULT '{50,80,100}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "estimate_kind" "estimate_kind" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "estimate_seconds" bigint;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "estimate_minor" bigint;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "estimate_reset" "estimate_reset" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "estimate_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "estimate_seconds" bigint;