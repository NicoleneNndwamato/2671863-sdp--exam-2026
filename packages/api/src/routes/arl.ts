import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { arlApiBaseUrl } from "../env";
import { resolveResearcher, verifyResearcher } from "../auth/researcher";
import { getAlertLimits } from "../alerts/limits";
import { serviceById } from "../services/registry";

/**
 * Thin pass-throughs to the ARL API.
 *
 * The browser must never call the ARL API directly: that would leak the API
 * address, put researcher codes in third-party request logs, and let a client
 * decide its own permissions. Everything goes through the server, which caches
 * and fails closed.
 */
export async function arlRoutes(app: FastifyInstance) {
  /** Does this code exist, and what is it allowed to work on? */
  app.get("/researchers/:code", async (req, reply) => {
    const { code } = req.params as { code: string };
    const researcher = await resolveResearcher(code);
    if (!researcher) {
      return reply.code(404).send({ error: "unknown_researcher", detail: code });
    }
    return researcher;
  });

  const verifyBody = z.object({
    code: z.string().min(1).max(120),
    service: z.string().min(1).max(40)
  });

  /**
   * Used by the UI to show "code accepted" before an operator commits to a
   * control. Authoritative for the actual command as well.
   */
  app.post("/researchers/verify", async (req, reply) => {
    const parsed = verifyBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", detail: parsed.error.issues });
    }
    return verifyResearcher(parsed.data.code, parsed.data.service);
  });

  /** The thresholds the alert engine is actually using right now. */
  app.get("/alert-limits/:service", async (req, reply) => {
    const { service } = req.params as { service: string };
    if (!serviceById(service)) return reply.code(404).send({ error: "unknown_service" });

    const limits = await getAlertLimits(service);
    return {
      service,
      limits: [...limits.entries()]
        .map(([key, value]) => ({ key, value }))
        .sort((a, b) => a.key.localeCompare(b.key))
    };
  });

  /**
   * Observing targets the array can be pointed at. Pass-through with a short
   * timeout: the target list is static and the UI needs it to populate the
   * `set_target` control.
   */
  app.get("/targets", async (_req, reply) => {
    try {
      const res = await fetch(`${arlApiBaseUrl}/v1/targets`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(4000)
      });
      if (!res.ok) return reply.code(502).send({ error: "arl_api_error", detail: `HTTP ${res.status}` });
      const targets = (await res.json()) as unknown;
      return { targets: Array.isArray(targets) ? targets : [] };
    } catch (err) {
      return reply.code(502).send({ error: "arl_api_unreachable", detail: (err as Error).message });
    }
  });
}
