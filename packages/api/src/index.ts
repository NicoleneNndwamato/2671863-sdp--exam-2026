import "dotenv/config";
import { buildApp } from "./app";
import { env } from "./env";
import { IngestBuffer } from "./mqtt/ingest";
import { postgresWriter } from "./mqtt/writer";
import { startBroker } from "./mqtt/broker";
import { services } from "./services/registry";
import { prefetchAlertLimits } from "./alerts/limits";
import { setIngestStatsProvider } from "./state";

async function main() {
  const app = await buildApp();

  // Fastify's logger and the console have different signatures; adapt once
  // rather than scattering `as any` through the ingest path.
  const log = {
    info: (msg: string) => app.log.info(msg),
    warn: (msg: string) => app.log.warn(msg),
    error: (msg: string) => app.log.error(msg)
  };

  const buffer = new IngestBuffer(postgresWriter, {
    maxBatch: env.INGEST_MAX_BATCH,
    maxQueue: env.INGEST_MAX_QUEUE
  });
  setIngestStatsProvider(() => buffer.stats);

  // Warm the alert-limit cache before the firehose starts: waiting for the
  // first dish message to trigger a fetch would show every early alert as
  // "limit unavailable".
  await prefetchAlertLimits(services.map((service) => service.id));

  const client = startBroker(buffer, log);

  const flushTimer = setInterval(() => {
    buffer.flush().catch((err) => app.log.error({ err }, "ingest flush failed"));
  }, env.INGEST_FLUSH_MS);

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`api listening on :${env.PORT}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received, shutting down`);
    clearInterval(flushTimer);
    try {
      await buffer.flush();
      client.end(true);
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "shutdown failed");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
