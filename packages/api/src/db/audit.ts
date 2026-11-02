import { db } from "./client";
import { auditLog } from "./schema";

export interface AuditInput {
  /** Researcher code, or "system" for engine-originated events. */
  actor: string;
  /** Dotted verb: `alert.acknowledge`, `control.start_scan`, `auth.rejected`. */
  action: string;
  service?: string | null;
  entity?: string | null;
  detail?: string | null;
  result?: "accepted" | "rejected" | "raised";
  topic?: string | null;
  value?: Record<string, unknown> | null;
}

/**
 * Records an action in the append-only audit log.
 *
 * Auditing is best-effort: a logging failure must not turn a successful control
 * command into an error response, so problems are reported and swallowed.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actor: input.actor,
      action: input.action,
      service: input.service ?? null,
      entity: input.entity ?? null,
      detail: input.detail ?? null,
      result: input.result ?? "accepted",
      topic: input.topic ?? null,
      value: input.value ?? null
    });
  } catch (err) {
    console.error(`audit write failed for ${input.action}:`, err);
  }
}
