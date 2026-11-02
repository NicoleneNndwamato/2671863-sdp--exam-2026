import { arlApiBaseUrl } from "../env";

/**
 * Alert thresholds come from the ARL API, not from constants in this repo.
 *
 * `GET /v1/alert-limits/{service}` returns `[{ key, value, unit }]` and the keys
 * map one-to-one onto the fields each service publishes (see each service's
 * `$topology`). Operations can retune a limit without a redeploy, and the
 * platform keeps working if the API is briefly unreachable by falling back to
 * the last successfully fetched values (or the baked-in defaults on cold start).
 */
export type AlertLimits = Map<string, number>;

const TTL_MS = 5 * 60_000;

interface CacheEntry {
  limits: AlertLimits;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<AlertLimits>>();

/**
 * Captured from the live API on 2026-11-02. Only used when the API has never
 * answered - the fetched values always win. Keeping them local means a restart
 * during a network blip does not silently disable every threshold.
 */
const fallback: Record<string, Record<string, number>> = {
  rta: {
    "availability.min_active": 80,
    "calibration.max_age_h": 168,
    "dish_power.max_w": 5000,
    "dish_temperature.crit_k": 343,
    "dish_temperature.warn_k": 333,
    "scan.min_snr_db": 3,
    "wind_stow.gust_ms": 15,
    "wind_stow.release_ms": 10
  },
  lwm: {
    "battery.min_v": 11.5,
    "calibration.max_days": 30,
    "high_wind.crit_ms": 20,
    "high_wind.warn_ms": 15,
    "lightning.max_km": 10,
    "pan.max_mm": 230,
    "pan.min_mm": 175,
    "rain.max_mm_h": 10,
    "soiling.min_ratio": 0.95,
    "storm.approach_km": 25,
    "temperature.max_k": 313,
    "temperature.min_k": 268
  },
  opg: {
    "battery.max_temp_k": 318,
    "battery.warn_pct": 30,
    "fuel.min_pct": 25,
    "solar.min_ratio": 0.8
  }
};

function fallbackFor(service: string): AlertLimits {
  return new Map(Object.entries(fallback[service] ?? {}));
}

export async function getAlertLimits(service: string): Promise<AlertLimits> {
  const cached = cache.get(service);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.limits;

  // Collapse concurrent refreshes: 100 dishes arriving at once must not mean
  // 100 requests to the ARL API.
  const pending = inflight.get(service);
  if (pending) return pending;

  const request = (async () => {
    try {
      const res = await fetch(`${arlApiBaseUrl}/v1/alert-limits/${encodeURIComponent(service)}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(4000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = (await res.json()) as Array<{ key?: unknown; value?: unknown }>;
      const limits: AlertLimits = new Map();
      for (const row of body) {
        if (typeof row.key === "string" && typeof row.value === "number") {
          limits.set(row.key, row.value);
        }
      }
      if (limits.size === 0) throw new Error("empty limits payload");

      cache.set(service, { limits, fetchedAt: Date.now() });
      return limits;
    } catch (err) {
      // Keep serving the previous values; only fall back when we have nothing.
      const previous = cache.get(service);
      if (previous) return previous.limits;
      console.warn(`alert limits for ${service} unavailable: ${(err as Error).message}`);
      return fallbackFor(service);
    } finally {
      inflight.delete(service);
    }
  })();

  inflight.set(service, request);
  return request;
}

/** Warm the cache at startup so the first burst of telemetry is evaluated. */
export async function prefetchAlertLimits(services: string[]): Promise<void> {
  await Promise.all(services.map((service) => getAlertLimits(service)));
}
