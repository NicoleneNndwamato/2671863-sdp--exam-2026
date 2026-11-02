import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { services } from "../services/registry";
import { getTopology } from "../services/topology";
import { ingestStats, serviceLastSeen, serviceMessageCount, serviceOnline } from "../state";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok",
    uptime: process.uptime()
  }));

  // Separate from /health so a dead database is visible without making
  // liveness checks flap (the replay and alert panels both need the DB).
  app.get("/health/db", async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: "ok" };
    } catch (err) {
      app.log.error({ err }, "database unreachable");
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  /**
   * Ingest health, surfaced in the sidebar footer.
   *
   * The drop counter is the honest signal that the buffer is under pressure;
   * hiding it would make a data-loss problem look like a quiet one.
   */
  app.get("/stats", async () => ({
    at: new Date().toISOString(),
    ingest: ingestStats(),
    services: services.map((service) => ({
      id: service.id,
      online: serviceOnline(service.id),
      lastSeen: serviceLastSeen(service.id),
      messages: serviceMessageCount(service.id),
      hasTopology: getTopology(service.id) !== undefined
    }))
  }));
}
