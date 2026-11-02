import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { rawMessages } from "../db/schema";
import { arlApiBaseUrl } from "../env";
import { reconstructScan, type ReconstructedImage, type ScanSample } from "../services/scanImage";

/**
 * RTA scans and their reconstructed images.
 *
 * A scan is ~50 000 samples (128 × 128 pixels × 3 dishes each) spread over ten
 * minutes, far more than the browser's history window holds, so the image is
 * built here from raw_messages and only the 128 × 128 result crosses the wire.
 * The scan's lifecycle comes from arl/rta/events/scan: `started` carries the
 * grid size and field of view the pixel formula needs.
 */

const SCAN_EVENTS_TOPIC = "arl/rta/events/scan";
const LIST_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Samples can trail the lifecycle events by a second or two either side. */
const EDGE_MS = 60 * 1000;
const DEFAULT_GRID = 128;

export interface ScanSummary {
  scanId: string;
  subarray: string | null;
  target: string | null;
  state: string;
  origin: string | null;
  startedAt: string | null;
  endedAt: string | null;
  gridSize: number | null;
  fovRad: number | null;
  bandHz: number | null;
  raRad: number | null;
  decRad: number | null;
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/** Fold scan lifecycle events (oldest first) into one summary per scan. */
export function summariseScans(events: Array<{ observedAt: Date; payload: Record<string, unknown> }>): ScanSummary[] {
  const scans = new Map<string, ScanSummary>();
  for (const { observedAt, payload } of events) {
    const scanId = str(payload.scan_id);
    if (!scanId) continue;
    const scan =
      scans.get(scanId) ??
      ({
        scanId,
        subarray: str(payload.entity),
        target: null,
        state: "running",
        origin: null,
        startedAt: null,
        endedAt: null,
        gridSize: null,
        fovRad: null,
        bandHz: null,
        raRad: null,
        decRad: null
      } satisfies ScanSummary);
    const event = str(payload.event);
    const at = observedAt.toISOString();

    if (event === "started") {
      Object.assign(scan, {
        state: "running",
        startedAt: at,
        target: str(payload.target),
        origin: str(payload.origin),
        gridSize: num(payload.grid_size),
        fovRad: num(payload.fov_rad),
        bandHz: num(payload.band_hz),
        raRad: num(payload.ra_rad),
        decRad: num(payload.dec_rad)
      });
    } else if (event === "paused") {
      scan.state = "paused";
    } else if (event === "resumed") {
      scan.state = "running";
    } else if (event === "completed" || event === "cancelled" || event === "failed") {
      scan.state = event;
      scan.endedAt = at;
    }
    scans.set(scanId, scan);
  }
  // Newest first: the scan an operator wants is almost always the latest.
  return [...scans.values()].sort((a, b) => (b.startedAt ?? b.endedAt ?? "").localeCompare(a.startedAt ?? a.endedAt ?? ""));
}

async function loadScans(since: Date): Promise<ScanSummary[]> {
  const rows = await db
    .select({ observedAt: rawMessages.observedAt, payload: rawMessages.payload })
    .from(rawMessages)
    .where(and(eq(rawMessages.topic, SCAN_EVENTS_TOPIC), gte(rawMessages.observedAt, since)))
    .orderBy(asc(rawMessages.observedAt));
  return summariseScans(rows as Array<{ observedAt: Date; payload: Record<string, unknown> }>);
}

/**
 * The field of view of the array's current target, for a scan whose `started`
 * event was missed (the API came up mid-scan). The target state names a
 * catalogue entry; the catalogue holds its field of view.
 */
async function currentFov(): Promise<number | null> {
  const [row] = await db
    .select({ payload: rawMessages.payload })
    .from(rawMessages)
    .where(and(eq(rawMessages.service, "rta"), sql`${rawMessages.topic} like 'arl/rta/%/state/target'`))
    .orderBy(desc(rawMessages.observedAt))
    .limit(1);
  const targetId = str((row?.payload as Record<string, unknown> | undefined)?.value);
  if (!targetId) return null;
  try {
    const res = await fetch(`${arlApiBaseUrl}/v1/targets`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const targets = (await res.json()) as Array<Record<string, unknown>>;
    return num(Array.isArray(targets) ? targets.find((t) => t.id === targetId)?.fov_rad : null);
  } catch {
    return null;
  }
}

/** Completed scans never change, so their images are kept; a running one is rebuilt per request. */
const imageCache = new Map<string, ReconstructedImage>();
const IMAGE_CACHE_SIZE = 8;

export function clearScanImageCache(): void {
  imageCache.clear();
}

const round = (value: number | null) => (value === null ? null : Math.round(value * 1000) / 1000);

export async function scanRoutes(app: FastifyInstance) {
  app.get("/services/rta/scans", async () => {
    const scans = await loadScans(new Date(Date.now() - LIST_WINDOW_MS));
    return { scans: scans.slice(0, 20) };
  });

  app.get("/services/rta/scans/:scanId/image", async (req, reply) => {
    const { scanId } = req.params as { scanId: string };
    const query = req.query as { to?: string };
    if (!/^[\w-]{1,64}$/.test(scanId)) return reply.code(400).send({ error: "invalid_scan_id" });

    const until = query.to ? new Date(query.to) : null;
    if (until && Number.isNaN(until.getTime())) {
      return reply.code(400).send({ error: "invalid_window", detail: "to must be an ISO timestamp" });
    }

    const scans = await loadScans(new Date((until ?? new Date()).getTime() - LIST_WINDOW_MS));
    const scan = scans.find((candidate) => candidate.scanId === scanId) ?? null;
    const finished = scan?.endedAt !== null && scan?.endedAt !== undefined;
    // An image "as of" a replay instant before the scan ended is partial and must not be cached.
    const cacheable = finished && (!until || until.getTime() >= Date.parse(scan!.endedAt!));

    let image = cacheable ? imageCache.get(scanId) : undefined;
    if (!image) {
      const fovRad = scan?.fovRad ?? (await currentFov());
      if (fovRad === null || fovRad <= 0) {
        return reply.code(404).send({ error: "scan_unavailable", detail: `no field of view known for ${scanId}` });
      }

      const end = until ?? (finished ? new Date(Date.parse(scan!.endedAt!) + EDGE_MS) : new Date());
      const filters = [
        eq(rawMessages.service, "rta"),
        lte(rawMessages.observedAt, end),
        sql`${rawMessages.topic} like 'arl/rta/%/telemetry/scan'`,
        sql`${rawMessages.payload}->>'scan_id' = ${scanId}`
      ];
      if (scan?.startedAt) filters.push(gte(rawMessages.observedAt, new Date(Date.parse(scan.startedAt) - EDGE_MS)));

      const samples = (await db
        .select({
          device: rawMessages.device,
          ra: sql<number | null>`(${rawMessages.payload}->>'pointing_offset_ra_rad')::float8`,
          dec: sql<number | null>`(${rawMessages.payload}->>'pointing_offset_dec_rad')::float8`,
          signal: sql<number | null>`(${rawMessages.payload}->>'signal_strength')::float8`,
          fault: sql<string | null>`${rawMessages.payload}->>'fault_code'`
        })
        .from(rawMessages)
        .where(and(...filters))) as ScanSample[];

      if (samples.length === 0 && !scan) {
        return reply.code(404).send({ error: "unknown_scan", detail: `no samples stored for ${scanId}` });
      }

      image = reconstructScan(samples, { gridSize: scan?.gridSize ?? DEFAULT_GRID, fovRad });
      if (cacheable) {
        imageCache.set(scanId, image);
        if (imageCache.size > IMAGE_CACHE_SIZE) imageCache.delete(imageCache.keys().next().value!);
      }
    }

    return {
      scan,
      scanId,
      complete: cacheable,
      ...image,
      pixels: image.pixels.map(round),
      min: round(image.min),
      max: round(image.max),
      low: round(image.low),
      high: round(image.high)
    };
  });
}
