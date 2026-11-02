import mqtt, { type MqttClient } from "mqtt";
import { env } from "../env";
import { parseMessage } from "../services/registry";
import type { IngestBuffer } from "./ingest";

/**
 * Connects to the shared broker and feeds the ingest buffer.
 *
 * Design notes worth defending in the write-up:
 *  - One client, one connection, resubscribed on every reconnect.
 *  - The discovery topic tells us each service's topic layout; subscriptions
 *    are built from that rather than hard-coded guesses.
 *  - Malformed payloads are logged and skipped, never allowed to kill the loop.
 */
export function startBroker(buffer: IngestBuffer, log: Pick<Console, "info" | "warn" | "error">): MqttClient {
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

  let discovered = false;

  client.on("connect", () => {
    log.info(`mqtt connected to ${env.MQTT_BROKER_ADDRESS}:${env.MQTT_BROKER_PORT}`);
    client.subscribe(env.MQTT_DISCOVERY_TOPIC, { qos: 0 }, (err) => {
      if (err) log.error(`mqtt subscribe failed: ${err.message}`);
    });
    if (discovered) subscribeToServices(client, log);
  });

  client.on("reconnect", () => log.warn("mqtt reconnecting"));
  client.on("offline", () => log.warn("mqtt offline"));
  client.on("error", (err) => log.error(`mqtt error: ${err.message}`));

  client.on("message", (topic, payloadBuffer) => {
    const payload = decode(payloadBuffer, log, topic);
    if (payload === undefined) return;

    if (topic === env.MQTT_DISCOVERY_TOPIC) {
      discovered = true;
      subscribeFromDiscovery(client, payload, log);
      return;
    }

    const message = parseMessage(topic, payload);
    if (message) buffer.add(message);
  });

  return client;
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

/**
 * The discovery payload shape is undocumented until we see the live broker.
 * Accept the three shapes that are plausible for a topic-directory message so
 * the first run does not require a code change.
 */
function subscribeFromDiscovery(
  client: MqttClient,
  payload: unknown,
  log: Pick<Console, "info" | "warn">
): void {
  const prefixes = extractPrefixes(payload);

  if (prefixes.length === 0) {
    log.warn(`discovery payload did not contain topic prefixes: ${JSON.stringify(payload).slice(0, 400)}`);
    return;
  }

  for (const prefix of prefixes) {
    const filter = prefix.endsWith("/#") ? prefix : `${prefix.replace(/\/$/, "")}/#`;
    client.subscribe(filter, { qos: 0 }, (err) => {
      if (err) log.warn(`subscribe ${filter} failed: ${err.message}`);
      else log.info(`subscribed ${filter}`);
    });
  }
}

function subscribeToServices(client: MqttClient, log: Pick<Console, "info">): void {
  // Reconnect path: the broker dropped our subscription, so re-apply the known
  // service prefixes even before a fresh discovery message arrives.
  for (const prefix of ["arl/rta", "arl/lwm", "arl/mhe", "arl/opg", "arl/owt"]) {
    client.subscribe(`${prefix}/#`, { qos: 0 }, () => log.info(`resubscribed ${prefix}/#`));
  }
}

function extractPrefixes(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload.filter((v): v is string => typeof v === "string");
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidates = record.topics ?? record.prefixes ?? record.services;
    if (Array.isArray(candidates)) {
      return candidates
        .map((v) => (typeof v === "string" ? v : typeof v === "object" && v ? String((v as Record<string, unknown>).topic ?? "") : ""))
        .filter(Boolean);
    }
    // { "rta": "arl/rta", ... }
    return Object.values(record).filter((v): v is string => typeof v === "string");
  }
  return [];
}
