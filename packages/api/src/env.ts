import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: bool,

  ARL_API_ADDRESS: z.string().min(1).default("http://localhost"),
  ARL_API_PORT: z.coerce.number().int().positive().default(8080),

  MQTT_BROKER_ADDRESS: z.string().min(1).default("localhost"),
  MQTT_BROKER_PORT: z.coerce.number().int().positive().default(1883),
  MQTT_BROKER_USER: z.string().default(""),
  MQTT_BROKER_PASSWORD: z.string().default(""),

  // The one topic the services publish their own topic structure on.
  MQTT_DISCOVERY_TOPIC: z.string().min(1).default("arl/services"),

  WEB_ORIGINS: z.string().default(""),

  INGEST_FLUSH_MS: z.coerce.number().int().positive().default(1000),
  INGEST_MAX_BATCH: z.coerce.number().int().positive().default(500),
  INGEST_MAX_QUEUE: z.coerce.number().int().positive().default(20000)
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loudly: a missing broker password should not surface as a
  // mysterious timeout ten minutes into the exam.
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;

export const arlApiBaseUrl = `${env.ARL_API_ADDRESS}:${env.ARL_API_PORT}`;
export const webOrigins = env.WEB_ORIGINS.split(",")
  .map((o) => o.trim())
  .filter(Boolean);
