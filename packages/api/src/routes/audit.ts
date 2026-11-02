import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, lte } from "drizzle-orm";
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
 *   from,to optional ISO bounds on `at`, so replay can mark operator actions
 *           inside the window it is showing
 */
export async function auditRoutes(app: FastifyInstance) {
  app.get("/audit", async (req, reply) => {
    const query = req.query as {
      limit?: string;
      service?: string;
      action?: string;
      actor?: string;
      from?: string;
      to?: string;
    };

    const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 1000);

    const filters = [];
    if (query.service) filters.push(eq(auditLog.service, query.service));
    if (query.action) filters.push(eq(auditLog.action, query.action));
    if (query.actor) filters.push(eq(auditLog.actor, query.actor));
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return reply.code(400).send({ error: "invalid_query", detail: "from and to must be ISO timestamps" });
    }
    if (from) filters.push(gte(auditLog.at, from));
    if (to) filters.push(lte(auditLog.at, to));

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
