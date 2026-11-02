import { z } from "zod";
import type { ParsedMessage, ServiceDefinition } from "@sdp/shared";

/**
 * Radio Telescope Array.
 *
 * Topic shapes are undocumented until the discovery topic tells us, so the
 * parser is defensive: it accepts any JSON object, validates only the fields we
 * rely on, and keeps the rest in `data`.
 *
 * TODO from the live discovery payload: pin the real topic layout, e.g.
 *   arl/rta/<sub-array>/<dish>/telemetry   (once every 2 minutes)
 *   arl/rta/<sub-array>/<dish>/scan        (once per second while scanning)
 */
const telemetry = z.object({
  ts: z.union([z.number(), z.string()]).optional(),
  temperature: z.number().optional(),
  powerUsage: z.number().optional(),
  status: z.string().optional(),
  target: z.string().optional()
});

const prefix = "arl/rta";

export const rta: ServiceDefinition = {
  id: "rta",
  displayName: "Radio Telescope Array",
  topicPrefixes: [prefix],

  parseMessage(topic: string, payload: unknown): ParsedMessage | null {
    if (!topic.startsWith(prefix)) return null;
    if (typeof payload !== "object" || payload === null) return null;

    const parsed = telemetry.safeParse(payload);
    const data = parsed.success ? parsed.data : { raw: payload };

    const parts = topic.split("/");
    // arl / rta / <dish> / <kind>
    const device = parts.length >= 4 ? parts[2] : undefined;
    const observedAt = toDate(parsed.success ? parsed.data.ts : undefined);

    return {
      service: "rta",
      device,
      topic,
      observedAt,
      data: data as Record<string, unknown>
    };
  }
};

function toDate(ts: number | string | undefined): Date {
  if (typeof ts === "number") return new Date(ts);
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}
