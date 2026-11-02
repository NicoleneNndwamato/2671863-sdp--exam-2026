import type {
  AlertView,
  AuditEntry,
  Reading,
  ServiceSummary,
  ServiceTopology
} from "@sdp/shared";

/**
 * All requests are relative: the Vite dev server proxies `/api` to the API in
 * development and Netlify does the same in production. No host name or port
 * ever reaches the browser, and there is no CORS surface to misconfigure.
 */

export interface ApiError extends Error {
  status?: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: unknown;
      message?: string;
    };
    const detail =
      typeof body.detail === "string" ? body.detail : typeof body.error === "string" ? body.error : null;
    const error = new Error(detail ?? body.message ?? `request failed (${res.status})`) as ApiError;
    error.status = res.status;
    throw error;
  }

  return (await res.json()) as T;
}

// --- Discovery -------------------------------------------------------------

export function fetchServices(): Promise<ServiceSummary[]> {
  return request<ServiceSummary[]>("/api/services");
}

export function fetchTopology(service: string): Promise<ServiceTopology> {
  return request<ServiceTopology>(`/api/services/${service}/topology`);
}

export interface LatestItem {
  topic: string;
  device: string | null;
  observedAt: string;
  payload: Record<string, unknown>;
}

export function fetchLatest(service: string, kind?: "telemetry" | "state"): Promise<LatestItem[]> {
  const query = kind ? `?kind=${kind}` : "";
  return request<{ latest: LatestItem[] }>(`/api/services/${service}/latest${query}`).then(
    (body) => body.latest
  );
}

// --- History / replay ------------------------------------------------------

export interface ReadingsWindow {
  service: string;
  from: string;
  to: string;
  count: number;
  readings: Reading[];
}

export function fetchReadings(
  service: string,
  from: string,
  to: string,
  options: { device?: string; kind?: string; limit?: number } = {}
): Promise<ReadingsWindow> {
  const query = new URLSearchParams({ from, to });
  if (options.device) query.set("device", options.device);
  if (options.kind) query.set("kind", options.kind);
  if (options.limit) query.set("limit", String(options.limit));
  return request<ReadingsWindow>(`/api/services/${service}/readings?${query.toString()}`);
}

// --- Alerts ----------------------------------------------------------------

export interface AlertQuery {
  status?: "raised" | "acknowledged" | "resolved" | "open";
  service?: string;
  limit?: number;
}

export function fetchAlerts(params: AlertQuery = {}): Promise<AlertView[]> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.service) query.set("service", params.service);
  if (params.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<{ alerts: AlertView[] }>(`/api/alerts${qs ? `?${qs}` : ""}`).then((b) => b.alerts);
}

/** Control requests carry the operator's code; the API verifies it server-side. */
export function acknowledgeAlert(id: string, researcherCode: string): Promise<AlertView> {
  return request<AlertView>(`/api/alerts/${id}/acknowledge`, {
    method: "POST",
    headers: { "x-researcher-code": researcherCode }
  });
}

export function resolveAlert(
  id: string,
  researcherCode: string,
  resolution: string
): Promise<AlertView> {
  return request<AlertView>(`/api/alerts/${id}/resolve`, {
    method: "POST",
    headers: { "x-researcher-code": researcherCode },
    body: JSON.stringify({ resolution })
  });
}

// --- Controls --------------------------------------------------------------

export interface ControlResult {
  accepted: boolean;
  published: boolean;
  topic: string;
  note: string;
}

export function sendControl(
  service: string,
  researcherCode: string,
  entity: string,
  control: string,
  value: unknown
): Promise<ControlResult> {
  return request<ControlResult>(`/api/services/${service}/control`, {
    method: "POST",
    headers: { "x-researcher-code": researcherCode },
    body: JSON.stringify({ entity, control, value })
  });
}

// --- Audit / researchers / limits -----------------------------------------

export function fetchAudit(params: { service?: string; limit?: number } = {}): Promise<AuditEntry[]> {
  const query = new URLSearchParams();
  if (params.service) query.set("service", params.service);
  if (params.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<{ entries: AuditEntry[] }>(`/api/audit${qs ? `?${qs}` : ""}`).then((b) => b.entries);
}

export interface ResearcherProfile {
  code: string;
  name?: string;
  experiments?: string[];
  status?: string;
}

export function fetchResearcher(code: string): Promise<ResearcherProfile> {
  return request<ResearcherProfile>(`/api/researchers/${encodeURIComponent(code)}`);
}

export function verifyResearcher(
  code: string,
  service: string
): Promise<{ valid: boolean; reason?: string }> {
  return request<{ valid: boolean; reason?: string }>("/api/researchers/verify", {
    method: "POST",
    body: JSON.stringify({ code, service })
  });
}

export interface AlertLimit {
  key: string;
  value: number;
}

export function fetchAlertLimits(service: string): Promise<AlertLimit[]> {
  return request<{ limits: AlertLimit[] }>(`/api/alert-limits/${service}`).then((b) => b.limits);
}

// --- Ingest health ---------------------------------------------------------

export interface StatsResponse {
  at: string;
  ingest: { queued: number; dropped: number; written: number };
  services: Array<{
    id: string;
    online: boolean;
    lastSeen: string | null;
    messages: number;
    hasTopology: boolean;
  }>;
}

export function fetchStats(): Promise<StatsResponse> {
  return request<StatsResponse>("/api/stats");
}

// --- Targets ---------------------------------------------------------------

export interface Target {
  id: string;
  name: string;
  ra_rad: number;
  dec_rad: number;
  fov_rad: number;
  category: string;
}

export function fetchTargets(): Promise<Target[]> {
  return request<{ targets: Target[] }>("/api/targets").then((b) => b.targets);
}
