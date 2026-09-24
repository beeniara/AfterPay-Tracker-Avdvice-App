CREATE TYPE "public"."ask_kind" AS ENUM('question', 'advice');--> statement-breakpoint
ALTER TABLE "ask_history" ADD COLUMN "kind" "ask_kind" DEFAULT 'question' NOT NULL;