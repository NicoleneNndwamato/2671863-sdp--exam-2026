import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { alerts, rawMessages } from "../db/schema";
import { canAccessService, resolveResearcher, type Researcher } from "../auth/researcher";
import { AlertTransitionError, applyAcknowledge, applyResolve } from "./state";

const codeHeader = "x-researcher-code";

const resolveBody = z.object({
  resolution: z.string().min(1).max(2000)
});

const idParam = z.object({ id: z.string().uuid() });

/**
 * Data is visible to everyone; only mutating a service requires an identity.
 * The code is checked against the ARL API on every control request - the
 * browser is not trusted to have checked anything.
 */
async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply,
  service: string
): Promise<Researcher | null> {
  const raw = req.headers[codeHeader];
  const code = Array.isArray(raw) ? raw[0] : raw;

  if (!code) {
    reply.code(401).send({ error: "researcher code required" });
    return null;
  }

  const researcher = await resolveResearcher(code);
  if (!researcher) {
    reply.code(403).send({ error: "unrecognised researcher code" });
    return null;
  }

  if (!canAccessService(researcher, service)) {
    reply.code(403).send({ error: `no access to ${service}` });
    return null;
  }

  return researcher;
}

export async function alertRoutes(app: FastifyInstance) {
  app.get("/alerts", async () => {
    const rows = await db.select().from(alerts).orderBy(desc(alerts.raisedAt)).limit(200);
    return rows;
  });

  app.post("/alerts/:id/acknowledge", async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid alert id" });

    const [alert] = await db.select().from(alerts).where(eq(alerts.id, params.data.id)).limit(1);
    if (!alert) return reply.code(404).send({ error: "alert not found" });

    const researcher = await authenticate(req, reply, alert.service);
    if (!researcher) return;

    try {
      const next = applyAcknowledge(alert, researcher.code);
      const [updated] = await db
        .update(alerts)
        .set({
          status: next.status,
          acknowledgedAt: next.acknowledgedAt,
          acknowledgedBy: next.acknowledgedBy
        })
        .where(eq(alerts.id, alert.id))
        .returning();

      return updated;
    } catch (err) {
      if (err instanceof AlertTransitionError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  app.post("/alerts/:id/resolve", async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid alert id" });

    const body = resolveBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "resolution note required" });

    const [alert] = await db.select().from(alerts).where(eq(alerts.id, params.data.id)).limit(1);
    if (!alert) return reply.code(404).send({ error: "alert not found" });

    const researcher = await authenticate(req, reply, alert.service);
    if (!researcher) return;

    try {
      const next = applyResolve(alert, researcher.code, body.data.resolution);
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

      return updated;
    } catch (err) {
      if (err instanceof AlertTransitionError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });
}

// --- Read-only replay window ------------------------------------------------

const windowQuery = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  device: z.string().optional(),
  limit: z.coerce.number().int().positive().max(5000).default(1000)
});

export async function replayRoutes(app: FastifyInstance) {
  app.get("/services/:id/readings", async (req, reply) => {
    const serviceId = z.string().safeParse((req.params as { id: string }).id);
    if (!serviceId.success) return reply.code(400).send({ error: "invalid service" });

    const query = windowQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "from and to must be ISO timestamps" });

    const from = new Date(query.data.from);
    const to = new Date(query.data.to);

    const filters = [
      eq(rawMessages.service, serviceId.data),
      gte(rawMessages.observedAt, from),
      lte(rawMessages.observedAt, to)
    ];
    if (query.data.device) filters.push(eq(rawMessages.device, query.data.device));

    const rows = await db
      .select()
      .from(rawMessages)
      .where(and(...filters))
      .orderBy(rawMessages.observedAt)
      .limit(query.data.limit);

    return rows;
  });
}
