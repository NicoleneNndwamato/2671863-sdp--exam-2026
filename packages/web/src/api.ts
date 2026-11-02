import type { AlertView, Reading } from "@sdp/shared";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `request failed (${res.status})`);
  }

  return (await res.json()) as T;
}

export function fetchAlerts(): Promise<AlertView[]> {
  return request<AlertView[]>("/api/alerts");
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

export function fetchReadings(service: string, from: string, to: string): Promise<Reading[]> {
  const query = new URLSearchParams({ from, to });
  return request<Reading[]>(`/api/services/${service}/readings?${query.toString()}`);
}
