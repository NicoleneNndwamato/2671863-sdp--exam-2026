/**
 * Types shared by the API and the web app.
 *
 * Keep this file type-only: it is consumed straight from source, so adding a
 * runtime value here would need a build step in both packages.
 */

export type ServiceId = "rta" | "lwm" | "mhe" | "opg" | "owt";

/** A single decoded MQTT message, ready to persist. */
export interface ParsedMessage {
  service: ServiceId;
  /** Device within the service, e.g. "dish-042" or "weather-site-2". */
  device?: string;
  /** Raw MQTT topic the message arrived on. */
  topic: string;
  /** When the measurement was taken, not when it was received. */
  observedAt: Date;
  /** Normalised payload. The raw payload is kept alongside it by the writer. */
  data: Record<string, unknown>;
}

/**
 * Everything a service needs to plug into the shared shell.
 * Adding a service means: add the table(s), implement this, register it.
 */
export interface ServiceDefinition {
  id: ServiceId;
  displayName: string;
  /** Topic prefixes this service owns, e.g. ["arl/rta"]. */
  topicPrefixes: string[];
  /** Return null when the topic is not this service's, or the payload is malformed. */
  parseMessage(topic: string, payload: unknown): ParsedMessage | null;
}

export type AlertStatus = "raised" | "acknowledged" | "resolved";
export type AlertSeverity = "info" | "warning" | "critical";

/** Shape returned by the alert endpoints. */
export interface AlertView {
  id: string;
  service: string;
  device: string | null;
  code: string;
  severity: AlertSeverity;
  cause: string;
  status: AlertStatus;
  raisedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
}

/** A point on the replay timeline. */
export interface Reading {
  service: string;
  device: string | null;
  topic: string;
  receivedAt: string;
  payload: Record<string, unknown>;
}
