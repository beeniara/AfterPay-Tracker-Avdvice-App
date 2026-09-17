CREATE TYPE "public"."fee_kind" AS ENUM('late', 'establishment', 'other');--> statement-breakpoint
CREATE TYPE "public"."order_channel" AS ENUM('online', 'in_store');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('active', 'settled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'bank', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('bnpl', 'store_finance', 'loan', 'other');--> statement-breakpoint
CREATE TABLE "fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instalment_id" uuid NOT NULL,
	"kind" "fee_kind" DEFAULT 'late' NOT NULL,
	"amount_cents" integer NOT NULL,
	"incurred_on" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instalments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"due_on" date NOT NULL,
	"principal_cents" integer NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"pending_cents" integer DEFAULT 0 NOT NULL,
	"waived_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" uuid NOT NULL,
	"merchant" text NOT NULL,
	"reference" text,
	"channel" "order_channel" DEFAULT 'online' NOT NULL,
	"purchased_at" timestamp with time zone NOT NULL,
	"total_amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"instalment_count" integer NOT NULL,
	"status" "order_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instalment_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_on" date NOT NULL,
	"method" "payment_method" DEFAULT 'card' NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "provider_kind" DEFAULT 'bnpl' NOT NULL,
	"website" text,
	"support_phone" text,
	"notes" text,
	"color_seed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"refunded_on" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"currency" text DEFAULT 'NZD' NOT NULL,
	"time_zone" text DEFAULT 'Pacific/Auckland' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "fees" ADD CONSTRAINT "fees_instalment_id_instalments_id_fk" FOREIGN KEY ("instalment_id") REFERENCES "public"."instalments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instalments" ADD CONSTRAINT "instalments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_instalment_id_instalments_id_fk" FOREIGN KEY ("instalment_id") REFERENCES "public"."instalments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fees_instalment_idx" ON "fees" USING btree ("instalment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instalments_order_sequence_unique" ON "instalments" USING btree ("order_id","sequence");--> statement-breakpoint
CREATE INDEX "instalments_due_idx" ON "instalments" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "orders_user_purchased_idx" ON "orders" USING btree ("user_id","purchased_at");--> statement-breakpoint
CREATE INDEX "orders_user_status_idx" ON "orders" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "orders_provider_idx" ON "orders" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "orders_merchant_idx" ON "orders" USING btree ("merchant");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_provider_reference_unique" ON "orders" USING btree ("provider_id","reference");--> statement-breakpoint
CREATE INDEX "payments_instalment_idx" ON "payments" USING btree ("instalment_id");--> statement-breakpoint
CREATE INDEX "providers_user_idx" ON "providers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_user_name_unique" ON "providers" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");