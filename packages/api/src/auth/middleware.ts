import type { FastifyRequest, FastifyReply } from "fastify";
import { resolveResearcher, verifyResearcher, type Researcher } from "./researcher";
import { recordAudit } from "../db/audit";

/**
 * Guards every mutating route. The researcher code travels in the
 * `x-researcher-code` header; nothing is trusted from the browser.
 *
 * Fails closed: a missing code, an unknown code, or an ARL API that cannot be
 * reached all deny the request.
 *
 * Usage:
 *   app.post("/services/:id/control", { preHandler: requireResearcher }, handler);
 */

declare module "fastify" {
  interface FastifyRequest {
    researcher?: Researcher;
  }
}

export async function requireResearcher(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<Researcher | void> {
  const raw = req.headers["x-researcher-code"];
  const code = Array.isArray(raw) ? raw[0] : raw;
  const serviceId = (req.params as { id?: string }).id ?? null;

  if (!code) {
    // A refused command is worth recording: "nothing happened" is exactly the
    // kind of thing an incident review needs to be able to prove.
    await recordAudit({
      actor: "anonymous",
      action: "auth.missing_code",
      service: serviceId,
      detail: `${req.method} ${req.url}`,
      result: "rejected"
    });
    return reply.code(401).send({
      error: "missing_researcher_code",
      detail: "x-researcher-code header is required for control operations"
    });
  }

  const researcher = await resolveResearcher(code);
  if (!researcher) {
    await recordAudit({
      actor: code,
      action: "auth.unknown_code",
      service: serviceId,
      detail: `${req.method} ${req.url}`,
      result: "rejected"
    });
    return reply.code(403).send({
      error: "invalid_researcher_code",
      detail: "researcher code is invalid or could not be verified"
    });
  }

  req.researcher = researcher;
  return researcher;
}

/**
 * Second half of the guard: does this researcher actually work on this service?
 * Asks the ARL API directly rather than inferring from the profile, because a
 * valid code can still be outside a service's experiment.
 *
 * Must run after requireResearcher.
 */
export async function requireServiceAccess(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const researcher = req.researcher;
  if (!researcher) {
    return reply.code(401).send({ error: "unauthorized", detail: "researcher authentication required" });
  }

  const serviceId = (req.params as { id?: string }).id;
  if (!serviceId) {
    return reply.code(400).send({ error: "missing_service", detail: "service id is required" });
  }

  const verdict = await verifyResearcher(researcher.code, serviceId);
  if (!verdict.valid) {
    await recordAudit({
      actor: researcher.code,
      action: "auth.service_denied",
      service: serviceId,
      detail: verdict.reason ?? "not assigned to this service's experiment",
      result: "rejected"
    });
    return reply.code(403).send({
      error: "service_access_denied",
      detail: `researcher ${researcher.code} may not operate ${serviceId}`,
      reason: verdict.reason
    });
  }
}

/** Convenience accessor for handlers registered behind requireResearcher. */
export function getResearcher(req: FastifyRequest): Researcher {
  if (!req.researcher) {
    throw new Error("researcher not attached - did you run requireResearcher?");
  }
  return req.researcher;
}
