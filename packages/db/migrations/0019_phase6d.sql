CREATE TYPE "public"."invoice_item_kind" AS ENUM('TIME', 'EXPENSE', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'SENT', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."recurring_mode" AS ENUM('DRAFT', 'SEND');--> statement-breakpoint
CREATE TYPE "public"."recurring_schedule" AS ENUM('WEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"client_id" text NOT NULL,
	"number" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"tax1_name" text,
	"tax1_bps" integer,
	"tax2_name" text,
	"tax2_bps" integer,
	"notes" text DEFAULT '' NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"pdf_key" text,
	"public_token_hash" text,
	"last_download_at" timestamp with time zone,
	"recurring_id" text,
	"period_key" text,
	"external_ref" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_item" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" "invoice_item_kind" NOT NULL,
	"description" text NOT NULL,
	"quantity_centi" integer NOT NULL,
	"unit_price_minor" bigint,
	"amount_minor" bigint NOT NULL,
	"entry_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"expense_ids" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_settings" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"tax_line" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"payment_terms_days" smallint DEFAULT 30 NOT NULL,
	"number_prefix" text DEFAULT 'INV-' NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"number_padding" smallint DEFAULT 4 NOT NULL,
	"tax1_name" text,
	"tax1_bps" integer,
	"tax2_name" text,
	"tax2_bps" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"date" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recurring_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"schedule" "recurring_schedule" NOT NULL,
	"weekday" smallint,
	"day_of_month" smallint,
	"start_date" date NOT NULL,
	"end_date" date,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"import_period" boolean DEFAULT false NOT NULL,
	"import_group_by" text DEFAULT 'project' NOT NULL,
	"mode" "recurring_mode" DEFAULT 'DRAFT' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_invoice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "invoice_id" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "attachment_key" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "attachment_name" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_recurring_id_recurring_invoice_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_item" ADD CONSTRAINT "invoice_item_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice" ADD CONSTRAINT "recurring_invoice_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice" ADD CONSTRAINT "recurring_invoice_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice" ADD CONSTRAINT "recurring_invoice_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_workspace_number_uq" ON "invoice" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_recurring_period_uq" ON "invoice" USING btree ("recurring_id","period_key") WHERE "recurring_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_public_token_uq" ON "invoice" USING btree ("public_token_hash") WHERE "public_token_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invoice_workspace_status_due_idx" ON "invoice" USING btree ("workspace_id","status","due_date");--> statement-breakpoint
CREATE INDEX "invoice_item_invoice_position_idx" ON "invoice_item" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE INDEX "payment_invoice_idx" ON "payment" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "recurring_invoice_workspace_idx" ON "recurring_invoice" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_workspace_invoice_idx" ON "time_entry" USING btree ("workspace_id","invoice_id") WHERE "invoice_id" IS NOT NULL;