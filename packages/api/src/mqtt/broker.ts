import mqtt, { type MqttClient } from "mqtt";
import { env } from "../env";
import { parseMessage, services } from "../services/registry";
import { isTopologyTopic } from "../services/base";
import { recordTopology } from "../services/topology";
import { setCommandPublisher } from "./publisher";
import { markServiceSeen } from "../state";
import type { IngestBuffer } from "./ingest";

/**
 * Connects to the shared broker and feeds the ingest buffer.
 *
 * Design notes worth defending in the write-up:
 *  - One client, one connection, resubscribed on every reconnect.
 *  - Subscriptions are derived from the service registry's topic prefixes, and
 *    each service's `$topology` message is captured so the rest of the system is
 *    driven by the published topic structure rather than hard-coded guesses.
 *  - Malformed payloads are logged and skipped, never allowed to kill the loop.
 */
export function startBroker(
  buffer: IngestBuffer,
  log: Pick<Console, "info" | "warn" | "error">
): MqttClient {
  const client = mqtt.connect({
    host: env.MQTT_BROKER_ADDRESS,
    port: env.MQTT_BROKER_PORT,
    username: env.MQTT_BROKER_USER || undefined,
    password: env.MQTT_BROKER_PASSWORD || undefined,
    protocol: "mqtt",
    reconnectPeriod: 1000,
    connectTimeout: 10_000,
    clean: true
  });

  setCommandPublisher(client);

  client.on("connect", () => {
    log.info(`mqtt connected to ${env.MQTT_BROKER_ADDRESS}:${env.MQTT_BROKER_PORT}`);
    subscribeAll(client, log);
  });

  client.on("reconnect", () => log.warn("mqtt reconnecting"));
  client.on("offline", () => log.warn("mqtt offline"));
  client.on("close", () => setCommandPublisher(null));
  client.on("error", (err) => log.error(`mqtt error: ${err.message}`));

  client.on("message", (topic, payloadBuffer) => {
    const payload = decode(payloadBuffer, log, topic);
    if (payload === undefined) return;

    if (isTopologyTopic(topic)) {
      // A retained `$topology` arrives immediately on subscribe and on change.
      if (topic.endsWith("/$topology")) recordTopology(topic, payload);
      return;
    }

    const message = parseMessage(topic, payload);
    if (message) {
      markServiceSeen(message.service);
      buffer.add(message);
    }
  });

  return client;
}

/**
 * Subscribe to each service's whole subtree (telemetry, state and events) plus
 * its retained `$topology`. Subscribing per service keeps the firehose scoped to
 * the services we implement.
 */
export function subscribeAll(
  client: MqttClient,
  log: Pick<Console, "info" | "warn">
): void {
  const filters = new Set<string>();
  for (const service of services) {
    for (const prefix of service.topicPrefixes) {
      filters.add(`${prefix.replace(/\/$/, "")}/#`);
    }
  }
  // Explicit topology subscription so we receive it even if a service adds a
  // new prefix we do not yet know about.
  filters.add("arl/+/$topology");

  for (const filter of filters) {
    client.subscribe(filter, { qos: 0 }, (err) => {
      if (err) log.warn(`subscribe ${filter} failed: ${err.message}`);
      else log.info(`subscribed ${filter}`);
    });
  }
}

function decode(buffer: Buffer, log: Pick<Console, "warn">, topic: string): unknown {
  const text = buffer.toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    log.warn(`dropping non-JSON payload on ${topic}`);
    return undefined;
  }
}
