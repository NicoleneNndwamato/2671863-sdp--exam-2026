import Fastify from "fastify";
import cors from "@fastify/cors";
import { env, webOrigins } from "./env";
import { healthRoutes } from "./routes/health";
import { serviceRoutes } from "./routes/services";
import { controlRoutes } from "./routes/controls";
import { auditRoutes } from "./routes/audit";
import { arlRoutes } from "./routes/arl";
import { alertRoutes } from "./alerts/routes";

export async function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : { level: "info" }
  });

  // In production Netlify proxies /api to this service, so the browser sees a
  // single origin and CORS stays closed. WEB_ORIGINS exists for local dev when
  // the Vite server is used directly.
  await app.register(cors, {
    origin: webOrigins.length > 0 ? webOrigins : false,
    methods: ["GET", "POST"]
  });

  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(serviceRoutes, { prefix: "/api" });
  await app.register(controlRoutes, { prefix: "/api" });
  await app.register(alertRoutes, { prefix: "/api" });
  await app.register(auditRoutes, { prefix: "/api" });
  await app.register(arlRoutes, { prefix: "/api" });

  return app;
}
