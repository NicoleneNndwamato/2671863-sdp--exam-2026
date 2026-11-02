import { arlApiBaseUrl } from "../env";

/**
 * Researcher identity comes entirely from the ARL API.
 *
 * The brief is explicit: nobody signs in. A researcher code arrives with each
 * mutating request (`x-researcher-code`) and is checked server-side - the
 * browser is never trusted to have checked anything.
 *
 * Two endpoints are used, for two different questions:
 *   GET  /v1/researchers/{code}          who is this, and what do they work on?
 *   POST /v1/researchers/verify          may this person touch this service?
 *
 * The second is authoritative for access control: a code can exist and still
 * not be permitted on a given experiment.
 */
export interface Researcher {
  code: string;
  name?: string;
  experiments?: string[];
  status?: string;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

const PROFILE_TTL_MS = 60_000;
const VERIFY_TTL_MS = 30_000;

const profiles = new Map<string, { value: Researcher | null; expiresAt: number }>();
const verifications = new Map<string, { value: VerifyResult; expiresAt: number }>();

/** Who is this code? `null` when the API says the code does not exist. */
export async function resolveResearcher(code: string): Promise<Researcher | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const cached = profiles.get(trimmed);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const res = await fetch(`${arlApiBaseUrl}/v1/researchers/${encodeURIComponent(trimmed)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3000)
    });

    if (res.status === 404) {
      profiles.set(trimmed, { value: null, expiresAt: Date.now() + PROFILE_TTL_MS });
      return null;
    }
    if (!res.ok) return null;

    const body = (await res.json()) as Record<string, unknown>;
    const researcher: Researcher = {
      code: typeof body.code === "string" ? body.code : trimmed,
      name: typeof body.name === "string" ? body.name : undefined,
      experiments: Array.isArray(body.experiments)
        ? body.experiments.filter((s): s is string => typeof s === "string")
        : undefined,
      status: typeof body.status === "string" ? body.status : undefined
    };

    profiles.set(trimmed, { value: researcher, expiresAt: Date.now() + PROFILE_TTL_MS });
    return researcher;
  } catch {
    // Unreachable API is not the same as "invalid code", but control cannot be
    // granted on an unverified identity. Fail closed.
    return null;
  }
}

/**
 * Is `code` allowed to operate `service`? This is the check that guards every
 * mutating route and is asked of the ARL API, not derived from the profile.
 */
export async function verifyResearcher(code: string, service: string): Promise<VerifyResult> {
  const trimmed = code.trim();
  if (!trimmed) return { valid: false, reason: "missing" };

  const key = `${trimmed}|${service}`;
  const cached = verifications.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const res = await fetch(`${arlApiBaseUrl}/v1/researchers/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ code: trimmed, service }),
      signal: AbortSignal.timeout(3000)
    });

    if (!res.ok) return { valid: false, reason: `api_${res.status}` };

    const body = (await res.json()) as Record<string, unknown>;
    const result: VerifyResult = {
      valid: body.valid === true,
      reason: typeof body.reason === "string" ? body.reason : undefined
    };

    verifications.set(key, { value: result, expiresAt: Date.now() + VERIFY_TTL_MS });
    return result;
  } catch {
    return { valid: false, reason: "api_unreachable" };
  }
}

/**
 * Fallback check used where only a profile is available. An empty experiment
 * list is treated as "no specific assignment" rather than "everything": a
 * researcher who exists but is unassigned should not gain control of the array.
 */
export function canAccessService(researcher: Researcher, serviceId: string): boolean {
  if (!researcher.experiments) return false;
  return researcher.experiments.includes(serviceId);
}
