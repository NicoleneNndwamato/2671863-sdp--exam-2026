/**
 * Types shared by the API and the web app.
 *
 * Keep this file type-only: it is consumed straight from source, so adding a
 * runtime value here would need a build step in both packages.
 */

export type ServiceId = "rta" | "lwm" | "mhe" | "opg" | "owt";

/** Kind of topic a message was published on. */
export type TopicKind = "telemetry" | "state" | "event" | "topology";

/** A single decoded MQTT message, ready to persist. */
export interface ParsedMessage {
  service: ServiceId;
  /** Device/entity within the service, e.g. "dish-042" or "lwm-3". */
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

// --- Topology (published on arl/<service>/$topology) -----------------------

export interface TopologyEntity {
  id: string;
  kind: string;
  /** Grid position, present on RTA dishes. */
  row?: number;
  col?: number;
  lat?: number;
  lon?: number;
  [key: string]: unknown;
}

export interface TopologyField {
  key: string;
  type: string;
  unit?: string | null;
  values?: string[];
  min?: number;
  max?: number;
}

export interface TopologyStream {
  topic: string;
  entity_kinds?: string[];
  period_s?: number;
  fields: TopologyField[];
}

export interface TopologyState {
  topic: string;
  type: string;
  unit?: string | null;
}

export interface TopologyControl {
  topic: string;
  entity_kinds?: string[];
  value: Record<string, unknown>;
}

export interface ServiceTopology {
  v: number;
  service: string;
  version: string;
  entities: TopologyEntity[];
  streams: TopologyStream[];
  state?: TopologyState[];
  events?: { topic: string }[];
  controls?: TopologyControl[];
  /** Server-side timestamp of when this topology was last seen. */
  updatedAt: string;
}

export interface ServiceSummary {
  id: string;
  displayName: string;
  topicPrefixes: string[];
  entityCount: number;
  streamCount: number;
  hasTopology: boolean;
  online: boolean | null;
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
  observedAt: string;
  receivedAt: string;
  payload: Record<string, unknown>;
}

/** An audit log entry (append-only). */
export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  service: string | null;
  entity: string | null;
  detail: string | null;
  result: string;
  topic: string | null;
  value: Record<string, unknown> | null;
}

/** Ingest statistics surfaced in the sidebar. */
export interface IngestStats {
  queued: number;
  dropped: number;
  written: number;
}
