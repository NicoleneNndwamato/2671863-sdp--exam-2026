CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"service" text,
	"entity" text,
	"detail" text,
	"result" text DEFAULT 'accepted' NOT NULL,
	"topic" text,
	"value" jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_service_idx" ON "audit_log" USING btree ("service");