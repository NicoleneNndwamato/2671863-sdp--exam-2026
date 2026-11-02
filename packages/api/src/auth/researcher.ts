import { arlApiBaseUrl } from "../env";

export interface Researcher {
  code: string;
  name?: string;
  services?: string[];
}

const cache = new Map<string, { researcher: Researcher | null; expiresAt: number }>();
const TTL_MS = 60_000;

/**
 * Resolves a researcher code against the ARL API.
 *
 * The brief is explicit: nobody signs in, but control operations must be
 * protected. So the code arrives on each control request and is verified
 * server-side - never trusted because the UI sent it.
 *
 * TODO: confirm the exact endpoint and response shape from the API's /docs
 * page. Only this function should need to change.
 */
export async function resolveResearcher(code: string): Promise<Researcher | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const cached = cache.get(trimmed);
  if (cached && cached.expiresAt > Date.now()) return cached.researcher;

  try {
    const res = await fetch(`${arlApiBaseUrl}/researchers/${encodeURIComponent(trimmed)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3000)
    });

    if (!res.ok) {
      cache.set(trimmed, { researcher: null, expiresAt: Date.now() + TTL_MS });
      return null;
    }

    const body = (await res.json()) as Record<string, unknown>;
    const researcher: Researcher = {
      code: trimmed,
      name: typeof body.name === "string" ? body.name : undefined,
      services: Array.isArray(body.services)
        ? body.services.filter((s): s is string => typeof s === "string")
        : undefined
    };

    cache.set(trimmed, { researcher, expiresAt: Date.now() + TTL_MS });
    return researcher;
  } catch {
    // API unreachable is not the same as "invalid code", but we cannot grant
    // control on an unverified identity. Fail closed.
    return null;
  }
}

export function canAccessService(researcher: Researcher, serviceId: string): boolean {
  if (!researcher.services || researcher.services.length === 0) return true;
  return researcher.services.includes(serviceId);
}
