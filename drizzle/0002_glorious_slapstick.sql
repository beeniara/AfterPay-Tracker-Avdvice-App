CREATE TABLE "ask_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"sql" text,
	"note" text,
	"model" text,
	"row_count" integer,
	"error" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ask_history" ADD CONSTRAINT "ask_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_history_user_created_idx" ON "ask_history" USING btree ("user_id","created_at");