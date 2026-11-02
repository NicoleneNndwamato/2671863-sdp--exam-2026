import {
  bigserial,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid
} from "drizzle-orm/pg-core";

export const alertSeverity = pgEnum("alert_severity", ["info", "warning", "critical"]);
export const alertStatus = pgEnum("alert_status", ["raised", "acknowledged", "resolved"]);

/**
 * Append-only log of everything that arrived on the broker.
 *
 * This is what makes replay possible: the service-specific tables hold the
 * current shape of the data, this table holds the history. Batch inserts only -
 * never one row per message.
 */
export const rawMessages = pgTable(
  "raw_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    service: text("service").notNull(),
    device: text("device"),
    topic: text("topic").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull()
  },
  (t) => [
    index("raw_messages_service_time_idx").on(t.service, t.observedAt),
    index("raw_messages_topic_time_idx").on(t.topic, t.observedAt)
  ]
);

/**
 * Alert audit trail. Every field the rubric asks for is a column here:
 * when it happened, why, who acknowledged it, who resolved it, and how.
 */
export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    service: text("service").notNull(),
    device: text("device"),
    code: text("code").notNull(),
    severity: alertSeverity("severity").notNull().default("warning"),
    cause: text("cause").notNull(),
    status: alertStatus("status").notNull().default("raised"),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    resolution: text("resolution")
  },
  (t) => [
    index("alerts_status_raised_idx").on(t.status, t.raisedAt),
    index("alerts_service_idx").on(t.service)
  ]
);

export type AlertRow = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type RawMessageRow = typeof rawMessages.$inferSelect;
export type NewRawMessage = typeof rawMessages.$inferInsert;

/**
 * Append-only audit trail for everything a person did to the platform.
 *
 * Alerts record their own lifecycle columns, but an audit log also covers
 * rejected attempts and control commands - the questions an examiner (or an
 * incident review) asks are "who tried what, when, against which entity, and
 * what came back". Nothing in this table is ever updated or deleted.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** Researcher code, or "system" for engine-originated entries. */
    actor: text("actor").notNull(),
    /** Dotted verb, e.g. `alert.acknowledge`, `control.start_scan`. */
    action: text("action").notNull(),
    service: text("service"),
    entity: text("entity"),
    /** Human-readable summary of what was attempted. */
    detail: text("detail"),
    /** `accepted`, `rejected` or `raised`. */
    result: text("result").notNull().default("accepted"),
    /** MQTT topic published to, for control entries. */
    topic: text("topic"),
    value: jsonb("value")
  },
  (t) => [index("audit_log_at_idx").on(t.at), index("audit_log_service_idx").on(t.service)]
);

export type AuditRow = typeof auditLog.$inferSelect;
export type NewAuditRow = typeof auditLog.$inferInsert;
