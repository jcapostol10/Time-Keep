ALTER TABLE "workspace_settings" ADD COLUMN "managers_see_costs" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "cost_rate_minor" bigint;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "cost_rate_source" "rate_level";--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "cost_amount_minor" bigint;