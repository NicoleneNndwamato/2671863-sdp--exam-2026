import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

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
}
