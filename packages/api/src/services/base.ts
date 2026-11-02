import type { ParsedMessage, ServiceDefinition, ServiceId } from "@sdp/shared";

/**
 * The live broker publishes every service on the same shape:
 *
 *   arl/<service>/<entity>/telemetry/<stream>   -> samples   (e.g. every 1-120 s)
 *   arl/<service>/<entity>/state/<item>          -> current state
 *   arl/<service>/<entity>/events/<event>        -> edge events
 *   arl/<service>/$topology                      -> topic structure (discovery)
 *
 * `$topology` describes entities, streams, fields, state items, events and
 * controls for a service. The ingest path is therefore identical for every
 * service; only the id/display name differ. This is the "shared shell" the
 * rubric asks for: a new service is a new definition, not a new pipeline.
 */

const KIND_TELEMETRY = "telemetry";
const KIND_STATE = "state";
const KIND_EVENTS = "events";

export function isTopologyTopic(topic: string): boolean {
  return topic === "arl/services" || topic.endsWith("/$topology");
}

export interface StandardServiceOptions {
  id: ServiceId;
  displayName: string;
  /** e.g. "arl/rta" */
  prefix: string;
}

export function createStandardService(options: StandardServiceOptions): ServiceDefinition {
  const prefix = options.prefix.replace(/\/$/, "");

  return {
    id: options.id,
    displayName: options.displayName,
    topicPrefixes: [prefix],

    parseMessage(topic: string, payload: unknown): ParsedMessage | null {
      if (!topic.startsWith(`${prefix}/`)) return null;
      if (isTopologyTopic(topic)) return null;
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;

      // arl / <service> / <entity> / <kind> / <name>
      const parts = topic.split("/");
      const record = payload as Record<string, unknown>;

      // Service-wide events use one fewer path segment: arl/<service>/events/<name>.
      if (parts.length === 4 && parts[2] === KIND_EVENTS) {
        return {
          service: options.id,
          device: typeof record.entity === "string" ? record.entity : "global",
          topic,
          observedAt: toDate(record.ts),
          data: { ...record, _kind: KIND_EVENTS, _name: parts[3] }
        };
      }

      if (parts.length < 5) return null;

      const kind = parts[3];
      if (kind !== KIND_TELEMETRY && kind !== KIND_STATE && kind !== KIND_EVENTS) return null;

      const entity =
        typeof record.entity === "string" && record.entity.length > 0 ? record.entity : parts[2];

      return {
        service: options.id,
        device: entity,
        topic,
        observedAt: toDate(record.ts),
        data: {
          ...record,
          _kind: kind,
          _name: parts[4]
        }
      };
    }
  };
}

/** Epoch-ms `ts` is the live format; tolerate ISO strings and fall back to now. */
export function toDate(ts: unknown): Date {
  if (typeof ts === "number" && Number.isFinite(ts)) {
    // Heuristic: seconds vs milliseconds.
    return new Date(ts < 1e12 ? ts * 1000 : ts);
  }
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}
