import type { Reading, ServiceTopology } from "@sdp/shared";
import type { LatestItem } from "./api";
import { splitTopic } from "./format";
import type { Point } from "./components/charts";

/**
 * Views consume "the current value of every topic" and "the recent history of
 * those topics". Both live polling and replay produce exactly these two shapes,
 * so a panel never needs to know which one it is rendering.
 */

export interface Snapshot {
  /** topic -> newest item */
  topics: Map<string, LatestItem>;
  at: string | null;
}

export function buildSnapshot(items: LatestItem[]): Snapshot {
  const topics = new Map<string, LatestItem>();
  let at: number | null = null;
  for (const item of items) {
    topics.set(item.topic, item);
    const time = Date.parse(item.observedAt);
    if (!Number.isNaN(time) && (at === null || time > at)) at = time;
  }
  return { topics, at: at === null ? null : new Date(at).toISOString() };
}

export function payloadOf(snapshot: Snapshot, topic: string): Record<string, unknown> | undefined {
  return snapshot.topics.get(topic)?.payload;
}

/** Numeric field from a topic, memoised by the caller's snapshot identity. */
export function numOf(snapshot: Snapshot, topic: string, field: string): number | undefined {
  const value = snapshot.topics.get(topic)?.payload[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function stateOf(snapshot: Snapshot, topic: string): unknown {
  return snapshot.topics.get(topic)?.payload.value;
}

export function stateNumber(snapshot: Snapshot, topic: string): number | undefined {
  const value = stateOf(snapshot, topic);
  return typeof value === "number" ? value : undefined;
}

export function stateBool(snapshot: Snapshot, topic: string): boolean | undefined {
  const value = stateOf(snapshot, topic);
  return typeof value === "boolean" ? value : undefined;
}

/** All topics whose path segment `name` matches, e.g. every `/telemetry/weather`. */
export function topicsNamed(snapshot: Snapshot, kind: string, name: string): Array<{ entity: string; item: LatestItem }> {
  const out: Array<{ entity: string; item: LatestItem }> = [];
  for (const item of snapshot.topics.values()) {
    const parts = splitTopic(item.topic);
    if (parts.kind === kind && parts.name === name) out.push({ entity: parts.entity, item });
  }
  return out.sort((a, b) => a.entity.localeCompare(b.entity));
}

/**
 * Extract a numeric series from raw history.
 *
 * `entity` may be "*" to average across every entity publishing that stream -
 * which is what you want for "array temperature" when 100 dishes each report.
 */
export function seriesFrom(
  history: Reading[],
  opts: { kind: string; name: string; field: string; entity?: string; average?: boolean }
): Point[] {
  const buckets = new Map<number, { sum: number; count: number }>();

  for (const reading of history) {
    const parts = splitTopic(reading.topic);
    if (parts.kind !== opts.kind || parts.name !== opts.name) continue;
    if (opts.entity && opts.entity !== "*" && parts.entity !== opts.entity) continue;

    const value = reading.payload[opts.field];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;

    const x = Date.parse(reading.observedAt);
    if (Number.isNaN(x)) continue;

    if (opts.average) {
      const bucket = buckets.get(x) ?? { sum: 0, count: 0 };
      bucket.sum += value;
      bucket.count += 1;
      buckets.set(x, bucket);
    } else {
      buckets.set(x, { sum: value, count: 1 });
    }
  }

  return [...buckets.entries()]
    .map(([x, bucket]) => ({ x, y: bucket.sum / bucket.count }))
    .sort((a, b) => a.x - b.x);
}

/** Entity ids of a given kind, in grid order (row then col). */
export function entitiesOfKind(topology: ServiceTopology | null, kind: string) {
  if (!topology) return [];
  return topology.entities
    .filter((entity) => entity.kind === kind)
    .sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0));
}

/** The time window covered by a set of readings. */
export function windowOf(readings: Reading[]): { start: number; end: number } | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const reading of readings) {
    const x = Date.parse(reading.observedAt);
    if (Number.isNaN(x)) continue;
    if (x < start) start = x;
    if (x > end) end = x;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

/** Snapshot as at a replay cursor: newest reading per topic at or before it. */
export function snapshotAt(readings: Reading[], cursor: number): Snapshot {
  const topics = new Map<string, LatestItem>();
  for (const reading of readings) {
    const x = Date.parse(reading.observedAt);
    if (Number.isNaN(x) || x > cursor) continue;
    const existing = topics.get(reading.topic);
    if (existing && Date.parse(existing.observedAt) >= x) continue;
    topics.set(reading.topic, {
      topic: reading.topic,
      device: reading.device,
      observedAt: reading.observedAt,
      payload: reading.payload
    });
  }
  return { topics, at: new Date(cursor).toISOString() };
}
