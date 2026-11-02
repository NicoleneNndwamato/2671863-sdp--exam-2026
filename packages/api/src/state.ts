import type { IngestStats } from "@sdp/shared";

/**
 * Small mutable runtime state shared between the ingest side and the HTTP API.
 *
 * Kept deliberately tiny and separate from the databases: this is "what is
 * happening right now" - queue depth, drop count, when a service last spoke -
 * not something worth persisting.
 */
let statsProvider: () => IngestStats = () => ({ queued: 0, dropped: 0, written: 0 });

export function setIngestStatsProvider(provider: () => IngestStats): void {
  statsProvider = provider;
}

export function ingestStats(): IngestStats {
  return statsProvider();
}

const lastSeen = new Map<string, number>();
const messageCounts = new Map<string, number>();

export function markServiceSeen(service: string): void {
  lastSeen.set(service, Date.now());
  messageCounts.set(service, (messageCounts.get(service) ?? 0) + 1);
}

/** A service counts as online if it has published within the last two minutes. */
export function serviceOnline(service: string): boolean {
  const at = lastSeen.get(service);
  return at !== undefined && Date.now() - at < 120_000;
}

export function serviceLastSeen(service: string): string | null {
  const at = lastSeen.get(service);
  return at === undefined ? null : new Date(at).toISOString();
}

export function serviceMessageCount(service: string): number {
  return messageCounts.get(service) ?? 0;
}
