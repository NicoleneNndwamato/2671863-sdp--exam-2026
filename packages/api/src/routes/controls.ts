import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TopologyControl } from "@sdp/shared";
import { serviceById } from "../services/registry";
import { getTopology } from "../services/topology";
import { publishCommand } from "../mqtt/publisher";
import { recordAudit } from "../db/audit";
import { requireResearcher, requireServiceAccess } from "../auth/middleware";

/**
 * The command surface.
 *
 * Commands are validated against the service's own `$topology` rather than a
 * hard-coded list: if the topic structure does not advertise
 * `cmd/<entity>/<control>`, the request is rejected. That keeps the UI and the
 * API honest - the same document that renders the button authorises it.
 *
 * Every attempt is audited, including rejected ones: "who tried to stow the
 * array at 02:14" is exactly the question an audit log exists to answer.
 */

const commandBody = z.object({
  entity: z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/),
  control: z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/),
  value: z.unknown()
});

/** `cmd` topic pattern -> does it accept this entity + control? */
function matches(control: TopologyControl, service: string, entity: string, name: string): boolean {
  const parts = control.topic.split("/");
  // arl/<service>/cmd/<entity>/<control>
  if (parts.length !== 5) return false;
  if (parts[0] !== "arl" || parts[1] !== service || parts[2] !== "cmd") return false;
  const entityOk = parts[3] === "+" || parts[3] === entity;
  return entityOk && parts[4] === name;
}

/** Type-check the value against the `value` spec published in the topology. */
function validateValue(
  control: TopologyControl,
  value: unknown
): { ok: true } | { ok: false; detail: string } {
  const spec = (control.value ?? {}) as Record<string, unknown>;
  const type = typeof spec.type === "string" ? spec.type : undefined;

  switch (type) {
    case "bool":
      return typeof value === "boolean" ? { ok: true } : { ok: false, detail: "expected a boolean" };
    case "integer":
      return Number.isInteger(value)
        ? checkRange(spec, value as number)
        : { ok: false, detail: "expected an integer" };
    case "float":
      return typeof value === "number" && Number.isFinite(value)
        ? checkRange(spec, value)
        : { ok: false, detail: "expected a number" };
    case "string":
      return typeof value === "string" && value.length > 0
        ? { ok: true }
        : { ok: false, detail: "expected a non-empty string" };
    case "timestamp":
      return typeof value === "number" && Number.isFinite(value)
        ? { ok: true }
        : { ok: false, detail: "expected an epoch-millisecond timestamp" };
    case "enum": {
      const values = Array.isArray(spec.values) ? spec.values : [];
      return typeof value === "string" && values.includes(value)
        ? { ok: true }
        : { ok: false, detail: `expected one of: ${values.join(", ")}` };
    }
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? { ok: true }
        : { ok: false, detail: "expected an object" };
    default:
      return { ok: true };
  }
}

function checkRange(
  spec: Record<string, unknown>,
  value: number
): { ok: true } | { ok: false; detail: string } {
  if (typeof spec.min === "number" && value < spec.min) {
    return { ok: false, detail: `value ${value} is below the minimum ${spec.min}` };
  }
  if (typeof spec.max === "number" && value > spec.max) {
    return { ok: false, detail: `value ${value} is above the maximum ${spec.max}` };
  }
  return { ok: true };
}

export async function controlRoutes(app: FastifyInstance) {
  /**
   * The controls a service advertises, for rendering forms. Read-only, like the
   * rest of the discovery endpoints.
   */
  app.get("/services/:id/controls", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!serviceById(id)) return reply.code(404).send({ error: "unknown_service" });

    const topology = getTopology(id);
    if (!topology) {
      return reply.code(503).send({ error: "topology_unavailable" });
    }
    return { service: id, controls: topology.controls ?? [] };
  });

  app.post(
    "/services/:id/control",
    { preHandler: [requireResearcher, requireServiceAccess] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const researcher = req.researcher!;

      const parsed = commandBody.safeParse(req.body);
      if (!parsed.success) {
        await recordAudit({
          actor: researcher.code,
          action: "control.rejected",
          service: id,
          detail: "malformed control request",
          result: "rejected"
        });
        return reply.code(400).send({ error: "invalid_command", detail: parsed.error.issues });
      }

      const { entity, control, value } = parsed.data;

      const topology = getTopology(id);
      if (!topology) {
        return reply.code(503).send({
          error: "topology_unavailable",
          detail: `no $topology seen for ${id}; cannot validate the command`
        });
      }

      const advertised = (topology.controls ?? []).find((c) => matches(c, id, entity, control));
      if (!advertised) {
        await recordAudit({
          actor: researcher.code,
          action: `control.${control}`,
          service: id,
          entity,
          detail: "control is not advertised in $topology",
          result: "rejected",
          value: { value }
        });
        return reply.code(400).send({
          error: "unknown_control",
          detail: `${control} is not published for ${entity} on ${id}`
        });
      }

      const validity = validateValue(advertised, value);
      if (!validity.ok) {
        await recordAudit({
          actor: researcher.code,
          action: `control.${control}`,
          service: id,
          entity,
          detail: `rejected: ${validity.detail}`,
          result: "rejected",
          value: { value }
        });
        return reply.code(422).send({ error: "invalid_value", detail: validity.detail });
      }

      const result = publishCommand(id, entity, control, value);

      await recordAudit({
        actor: researcher.code,
        action: `control.${control}`,
        service: id,
        entity,
        detail: result.published
          ? `published ${control} on ${entity}`
          : `broker offline; ${control} on ${entity} not published`,
        result: "accepted",
        topic: result.topic,
        value: { value }
      });

      return reply.send({
        accepted: true,
        published: result.published,
        topic: result.topic,
        // The exam broker accepts publishes but the simulator ignores commands,
        // so the UI says so plainly instead of implying a physical effect.
        note: result.published
          ? "command published; the live simulator accepts but does not act on commands"
          : "broker connection is down; command recorded but not published"
      });
    }
  );
}
