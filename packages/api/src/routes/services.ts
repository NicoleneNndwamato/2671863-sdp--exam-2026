import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Reading, ServiceSummary } from "@sdp/shared";
import { serviceById, services } from "../services/registry";
import { getTopology } from "../services/topology";
import { db } from "../db/client";
import { rawMessages } from "../db/schema";
import { serviceMessageCount, serviceOnline } from "../state";

/**
 * Service discovery and history.
 *
 * Everything here is read-only and open: telemetry is not secret, and the
 * dashboard must work before anyone types a researcher code. Mutation is
 * guarded separately (see routes/controls.ts).
 */
export async function serviceRoutes(app: FastifyInstance) {
  app.get("/services", async (): Promise<ServiceSummary[]> => {
    return services.map((service) => {
      const topology = getTopology(service.id);
      return {
        id: service.id,
        displayName: service.displayName,
        topicPrefixes: service.topicPrefixes,
        entityCount: topology?.entities.length ?? 0,
        streamCount: topology?.streams.length ?? 0,
        hasTopology: topology !== undefined,
        online: topology === undefined ? null : serviceOnline(service.id)
      };
    });
  });

  app.get("/services/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const service = serviceById(id);
    if (!service) return reply.code(404).send({ error: "unknown_service" });

    const topology = getTopology(id);
    return {
      id: service.id,
      displayName: service.displayName,
      topicPrefixes: service.topicPrefixes,
      messages: serviceMessageCount(id),
      hasTopology: topology !== undefined,
      topologyVersion: topology?.version ?? null,
      topologyUpdatedAt: topology?.updatedAt ?? null
    };
  });

  /**
   * The topic structure the service published on `arl/<service>/$topology`.
   * The UI builds its dish grid, tables and control surfaces from this, which is
   * why adding a service or a device requires no frontend change.
   */
  app.get("/services/:id/topology", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!serviceById(id)) return reply.code(404).send({ error: "unknown_service" });

    const topology = getTopology(id);
    if (!topology) {
      return reply.code(503).send({
        error: "topology_unavailable",
        detail: `no $topology seen for ${id} yet - broker may still be connecting`
      });
    }
    return topology;
  });

  /**
   * Latest value per topic: one query using DISTINCT ON, rather than pulling
   * the window and reducing in JavaScript. This is what the live dashboard
   * polls; at ~100 dishes it stays a single index scan.
   */
  app.get("/services/:id/latest", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!serviceById(id)) return reply.code(404).send({ error: "unknown_service" });

    const { kind } = req.query as { kind?: string };

    // DISTINCT ON (topic) with newest-first ordering gives one row per stream
    // without reading the whole window into memory.
    const rows = await db
      .selectDistinctOn([rawMessages.topic])
      .from(rawMessages)
      .where(
        and(
          eq(rawMessages.service, id),
          kind ? sql`${rawMessages.topic} like ${`%/${kind}/%`}` : undefined
        )
      )
      .orderBy(rawMessages.topic, desc(rawMessages.observedAt));

    return {
      service: id,
      at: new Date().toISOString(),
      latest: rows.map((row) => ({
        topic: row.topic,
        device: row.device,
        observedAt: row.observedAt.toISOString(),
        payload: row.payload as Record<string, unknown>
      }))
    };
  });

  /**
   * Historical window for replay.
   *
   * Ordered oldest-first because that is the direction a replay plays. The
   * caller passes an explicit window; there is no implicit "last hour" here so
   * a replay of a captured incident is exactly reproducible.
   */
  app.get("/services/:id/readings", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!serviceById(id)) return reply.code(404).send({ error: "unknown_service" });

    const query = req.query as {
      from?: string;
      to?: string;
      device?: string;
      kind?: string;
      limit?: string;
    };

    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return reply.code(400).send({ error: "invalid_window", detail: "from and to must be ISO timestamps" });
    }

    const limit = Math.min(Math.max(Number(query.limit) || 2000, 1), 10_000);

    const filters = [
      eq(rawMessages.service, id),
      gte(rawMessages.observedAt, from),
      lte(rawMessages.observedAt, to)
    ];
    if (query.device) filters.push(eq(rawMessages.device, query.device));

    const rows = await db
      .select()
      .from(rawMessages)
      .where(and(...filters))
      .orderBy(asc(rawMessages.observedAt))
      .limit(limit);

    const filtered = query.kind
      ? rows.filter((row) => row.topic.includes(`/${query.kind}/`))
      : rows;

    const readings: Reading[] = filtered.map((row) => ({
      service: row.service,
      device: row.device,
      topic: row.topic,
      observedAt: row.observedAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      payload: row.payload as Record<string, unknown>
    }));

    return {
      service: id,
      from: from.toISOString(),
      to: to.toISOString(),
      count: readings.length,
      readings
    };
  });
}
