import mqtt, { type MqttClient } from "mqtt";
import { env } from "../env";
import { parseMessage, services } from "../services/registry";
import { isTopologyTopic } from "../services/base";
import { recordTopology } from "../services/topology";
import { setCommandPublisher } from "./publisher";
import { markServiceSeen, setBrokerStatusProvider } from "../state";
import { ReconnectSupervisor, type BackoffOptions } from "./connection";
import type { IngestBuffer } from "./ingest";

/**
 * Connects to the shared broker and feeds the ingest buffer.
 *
 * Design notes worth defending in the write-up:
 *  - One client, one connection, resubscribed on every reconnect. Reconnection
 *    is driven by ReconnectSupervisor (exponential backoff with jitter) rather
 *    than mqtt.js's fixed one-second retry.
 *  - Subscriptions are derived from the service registry's topic prefixes, and
 *    each service's `$topology` message is captured so the rest of the system is
 *    driven by the published topic structure rather than hard-coded guesses.
 *  - Malformed payloads are logged and skipped, never allowed to kill the loop.
 *  - The command publisher is withdrawn while the link is down and restored on
 *    every connect, so a control sent during an outage is reported as
 *    "not published" instead of being queued and fired minutes later.
 */
export interface BrokerTarget {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface BrokerConnection {
  client: MqttClient;
  supervisor: ReconnectSupervisor;
  /** Stop reconnecting and close the link. */
  stop(): void;
}

export function startBroker(
  buffer: IngestBuffer,
  log: Pick<Console, "info" | "warn" | "error">,
  target: BrokerTarget = {
    host: env.MQTT_BROKER_ADDRESS,
    port: env.MQTT_BROKER_PORT,
    username: env.MQTT_BROKER_USER || undefined,
    password: env.MQTT_BROKER_PASSWORD || undefined
  },
  backoff: BackoffOptions = {}
): BrokerConnection {
  const client = mqtt.connect({
    host: target.host,
    port: target.port,
    username: target.username,
    password: target.password,
    protocol: "mqtt",
    // 0 turns the library's fixed-interval retry off; the supervisor owns it.
    reconnectPeriod: 0,
    connectTimeout: 10_000,
    // A dead TCP link is noticed within ~1.5 keepalives instead of never.
    keepalive: 30,
    clean: true
  });

  const supervisor = new ReconnectSupervisor(client, {
    ...backoff,
    log,
    onConnect: () => {
      log.info(`mqtt connected to ${target.host}:${target.port}`);
      setCommandPublisher(client);
      subscribeAll(client, log);
    }
  });
  setBrokerStatusProvider(() => supervisor.snapshot);

  client.on("close", () => setCommandPublisher(null));

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

  return {
    client,
    supervisor,
    stop: () => {
      supervisor.stop();
      setCommandPublisher(null);
    }
  };
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
