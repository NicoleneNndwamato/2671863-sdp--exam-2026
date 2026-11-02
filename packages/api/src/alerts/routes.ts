import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import type { AlertStatus, AlertView } from "@sdp/shared";
import { db } from "../db/client";
import { alerts, type AlertRow } from "../db/schema";
import { recordAudit } from "../db/audit";
import { resolveResearcher, verifyResearcher } from "../auth/researcher";
import { AlertTransitionError, applyAcknowledge, applyResolve } from "./state";

const codeHeader = "x-researcher-code";

const resolveBody = z.object({
  resolution: z.string().min(1).max(2000)
});

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  status: z.enum(["raised", "acknowledged", "resolved", "open"]).optional(),
  service: z.string().optional(),
  // Bounds on raisedAt, for replay windows.
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(500).default(200)
});

function toView(row: AlertRow): AlertView {
  return {
    id: row.id,
    service: row.service,
    device: row.device,
    code: row.code,
    severity: row.severity,
    cause: row.cause,
    status: row.status,
    raisedAt: row.raisedAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: row.acknowledgedBy ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy ?? null,
    resolution: row.resolution ?? null
  };
}

/**
 * Alerts are readable by anyone; acting on one requires a researcher code that
 * the ARL API says may operate the affected service.
 *
 * The service is taken from the alert row, not from the request, so a caller
 * cannot claim a service they have access to in order to act on another.
 */
async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply,
  service: string,
  action: string,
  alertId: string
): Promise<string | null> {
  const raw = req.headers[codeHeader];
  const code = Array.isArray(raw) ? raw[0] : raw;

  if (!code) {
    await recordAudit({
      actor: "anonymous",
      action,
      service,
      entity: alertId,
      detail: "missing researcher code",
      result: "rejected"
    });
    reply.code(401).send({ error: "missing_researcher_code" });
    return null;
  }

  const researcher = await resolveResearcher(code);
  if (!researcher) {
    await recordAudit({
      actor: code,
      action,
      service,
      entity: alertId,
      detail: "unknown researcher code",
      result: "rejected"
    });
    reply.code(403).send({ error: "invalid_researcher_code" });
    return null;
  }

  const verdict = await verifyResearcher(code, service);
  if (!verdict.valid) {
    await recordAudit({
      actor: code,
      action,
      service,
      entity: alertId,
      detail: `not permitted on ${service} (${verdict.reason ?? "denied"})`,
      result: "rejected"
    });
    reply.code(403).send({ error: "service_access_denied", detail: verdict.reason });
    return null;
  }

  return researcher.code;
}

export async function alertRoutes(app: FastifyInstance) {
  app.get("/alerts", async (req, reply) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query" });

    const { status, service, from, to, limit } = parsed.data;
    const filters = [];
    if (service) filters.push(eq(alerts.service, service));
    if (from) filters.push(gte(alerts.raisedAt, from));
    if (to) filters.push(lte(alerts.raisedAt, to));
    if (status === "open") filters.push(inArray(alerts.status, ["raised", "acknowledged"] as AlertStatus[]));
    else if (status) filters.push(eq(alerts.status, status));

    const rows = await db
      .select()
      .from(alerts)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(alerts.raisedAt))
      .limit(limit);

    return { count: rows.length, alerts: rows.map(toView) };
  });

  app.post("/alerts/:id/acknowledge", async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_alert_id" });

    const [alert] = await db.select().from(alerts).where(eq(alerts.id, params.data.id)).limit(1);
    if (!alert) return reply.code(404).send({ error: "alert_not_found" });

    const actor = await authenticate(req, reply, alert.service, "alert.acknowledge", alert.id);
    if (!actor) return;

    try {
      const next = applyAcknowledge(alert, actor);
      const [updated] = await db
        .update(alerts)
        .set({
          status: next.status,
          acknowledgedAt: next.acknowledgedAt,
          acknowledgedBy: next.acknowledgedBy
        })
        .where(eq(alerts.id, alert.id))
        .returning();

      await recordAudit({
        actor,
        action: "alert.acknowledge",
        service: alert.service,
        entity: alert.device,
        detail: `acknowledged ${alert.code}`,
        result: "accepted",
        value: { alertId: alert.id }
      });

      return toView(updated);
    } catch (err) {
      if (err instanceof AlertTransitionError) {
        await recordAudit({
          actor,
          action: "alert.acknowledge",
          service: alert.service,
          entity: alert.device,
          detail: err.message,
          result: "rejected",
          value: { alertId: alert.id }
        });
        return reply.code(409).send({ error: "invalid_transition", detail: err.message });
      }
      throw err;
    }
  });

  app.post("/alerts/:id/resolve", async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_alert_id" });

    const body = resolveBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "resolution_required" });

    const [alert] = await db.select().from(alerts).where(eq(alerts.id, params.data.id)).limit(1);
    if (!alert) return reply.code(404).send({ error: "alert_not_found" });

    const actor = await authenticate(req, reply, alert.service, "alert.resolve", alert.id);
    if (!actor) return;

    try {
      const next = applyResolve(alert, actor, body.data.resolution);
      const [updated] = await db
        .update(alerts)
        .set({
          status: next.status,
          resolvedAt: next.resolvedAt,
          resolvedBy: next.resolvedBy,
          resolution: next.resolution
        })
        .where(eq(alerts.id, alert.id))
        .returning();

      await recordAudit({
        actor,
        action: "alert.resolve",
        service: alert.service,
        entity: alert.device,
        detail: `resolved ${alert.code}: ${body.data.resolution}`,
        result: "accepted",
        value: { alertId: alert.id }
      });

      return toView(updated);
    } catch (err) {
      if (err instanceof AlertTransitionError) {
        await recordAudit({
          actor,
          action: "alert.resolve",
          service: alert.service,
          entity: alert.device,
          detail: err.message,
          result: "rejected",
          value: { alertId: alert.id }
        });
        return reply.code(409).send({ error: "invalid_transition", detail: err.message });
      }
      throw err;
    }
  });
}
