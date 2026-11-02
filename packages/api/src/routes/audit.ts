import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import type { AuditEntry } from "@sdp/shared";
import { db } from "../db/client";
import { auditLog } from "../db/schema";

/**
 * Read-only view of the audit trail.
 *
 * Query params:
 *   limit   1..1000, default 200
 *   service optional service id
 *   action  optional exact action, e.g. `control.start_scan`
 *   actor   optional researcher code
 */
export async function auditRoutes(app: FastifyInstance) {
  app.get("/audit", async (req) => {
    const query = req.query as {
      limit?: string;
      service?: string;
      action?: string;
      actor?: string;
    };

    const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 1000);

    const filters = [];
    if (query.service) filters.push(eq(auditLog.service, query.service));
    if (query.action) filters.push(eq(auditLog.action, query.action));
    if (query.actor) filters.push(eq(auditLog.actor, query.actor));

    const rows = await db
      .select()
      .from(auditLog)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(auditLog.at))
      .limit(limit);

    const entries: AuditEntry[] = rows.map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      actor: row.actor,
      action: row.action,
      service: row.service,
      entity: row.entity,
      detail: row.detail,
      result: row.result,
      topic: row.topic,
      value: (row.value as Record<string, unknown> | null) ?? null
    }));

    return { count: entries.length, entries };
  });
}
