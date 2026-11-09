CREATE TYPE "public"."expense_category_kind" AS ENUM('FIXED', 'UNIT');--> statement-breakpoint
ALTER TYPE "public"."export_format" ADD VALUE 'zip';--> statement-breakpoint
ALTER TYPE "public"."export_report" ADD VALUE 'expenses';--> statement-breakpoint
ALTER TYPE "public"."export_report" ADD VALUE 'receipts';--> statement-breakpoint
CREATE TABLE "expense" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"category_id" text NOT NULL,
	"date" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"quantity_centi" integer,
	"unit_price_minor" bigint,
	"billable" boolean NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"receipt_key" text,
	"receipt_thumb_key" text,
	"receipt_mime" text,
	"invoice_id" text,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expense_category" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "expense_category_kind" NOT NULL,
	"unit_name" text,
	"unit_price_minor" bigint,
	"billable_default" boolean DEFAULT true NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_category" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_event" ADD COLUMN "expense_id" text;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "expense_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "expense_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_category_id_expense_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_category" ADD CONSTRAINT "expense_category_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_workspace_user_date_idx" ON "expense" USING btree ("workspace_id","user_id","date");--> statement-breakpoint
CREATE INDEX "expense_workspace_project_date_idx" ON "expense" USING btree ("workspace_id","project_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_category_workspace_name_uq" ON "expense_category" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "expense_category_workspace_id_idx" ON "expense_category" USING btree ("workspace_id");