import type { FastifyInstance } from "fastify";
import { serviceById, services } from "../services/registry";

export async function serviceRoutes(app: FastifyInstance) {
  app.get("/services", async () =>
    services.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      topicPrefixes: s.topicPrefixes
    }))
  );

  app.get("/services/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const service = serviceById(id);
    if (!service) return reply.code(404).send({ error: "unknown service" });

    return {
      id: service.id,
      displayName: service.displayName,
      topicPrefixes: service.topicPrefixes
    };
  });
}
