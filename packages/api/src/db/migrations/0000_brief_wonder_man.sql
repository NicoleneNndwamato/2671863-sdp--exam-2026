CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('raised', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"device" text,
	"code" text NOT NULL,
	"severity" "alert_severity" DEFAULT 'warning' NOT NULL,
	"cause" text NOT NULL,
	"status" "alert_status" DEFAULT 'raised' NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"device" text,
	"topic" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_status_raised_idx" ON "alerts" USING btree ("status","raised_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_service_idx" ON "alerts" USING btree ("service");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_messages_service_time_idx" ON "raw_messages" USING btree ("service","observed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_messages_topic_time_idx" ON "raw_messages" USING btree ("topic","observed_at");