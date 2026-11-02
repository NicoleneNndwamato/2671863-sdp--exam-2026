import type { ServiceTopology, TopologyControl, TopologyEntity } from "@sdp/shared";

/**
 * In-memory cache of the last `$topology` payload seen for each service.
 *
 * Topology is the contract between a service and the shell: it lists entities
 * (with RTA grid positions), telemetry streams and their fields, state items,
 * events and controls. The UI renders the dish grid and control surfaces from
 * this, and subscriptions are derived from it, so a new device or service needs
 * no code change.
 *
 * The broker publishes retained `$topology` messages, so a fresh subscribe
 * populates this within a second of connecting.
 */
const store = new Map<string, ServiceTopology>();

export function recordTopology(topic: string, payload: unknown): void {
  if (!topic.endsWith("/$topology")) return;
  const serviceId = topic.split("/")[1];
  if (!serviceId) return;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return;

  const raw = payload as Record<string, unknown>;
  const topology: ServiceTopology = {
    v: typeof raw.v === "number" ? raw.v : 1,
    service: typeof raw.service === "string" ? raw.service : serviceId,
    version: typeof raw.version === "string" ? raw.version : "0.0.0",
    entities: normalizeEntities(raw.entities),
    streams: Array.isArray(raw.streams) ? (raw.streams as ServiceTopology["streams"]) : [],
    state: Array.isArray(raw.state) ? (raw.state as ServiceTopology["state"]) : [],
    events: Array.isArray(raw.events) ? (raw.events as ServiceTopology["events"]) : [],
    controls: Array.isArray(raw.controls) ? (raw.controls as TopologyControl[]) : [],
    updatedAt: new Date().toISOString()
  };

  store.set(serviceId, topology);
}

export function getTopology(serviceId: string): ServiceTopology | undefined {
  return store.get(serviceId);
}

export function allTopologies(): ServiceTopology[] {
  return [...store.values()];
}

/** Entities of a given kind (e.g. every "dish"). */
export function entitiesOfKind(serviceId: string, kind: string): TopologyEntity[] {
  return getTopology(serviceId)?.entities.filter((e) => e.kind === kind) ?? [];
}

function normalizeEntities(raw: unknown): TopologyEntity[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is TopologyEntity =>
      typeof e === "object" && e !== null && typeof (e as Record<string, unknown>).id === "string"
  );
}
