import type { AlertView, AuditEntry } from "@sdp/shared";

export type ReplayEventKind = "alert" | "control" | "operator";

/** One marker on the replay timeline. */
export interface ReplayEvent {
  id: string;
  at: number;
  kind: ReplayEventKind;
  tone: "crit" | "warn" | "info" | "ok" | "muted";
  label: string;
}

/**
 * The things worth stopping the replay at: alerts the engine raised, controls
 * an operator sent (accepted or refused), and alerts being acknowledged or
 * resolved.
 *
 * The engine's own `system` audit rows are skipped - they restate the alert
 * rows - and so are bare auth rejections, which say nothing about the plant.
 */
export function buildReplayEvents(alerts: AlertView[], audit: AuditEntry[], from: string, to: string): ReplayEvent[] {
  const start = Date.parse(from);
  const end = Date.parse(to);
  const inside = (at: number) => Number.isFinite(at) && at >= start && at <= end;
  const events: ReplayEvent[] = [];

  for (const alert of alerts) {
    const at = Date.parse(alert.raisedAt);
    if (!inside(at)) continue;
    events.push({
      id: `alert:${alert.id}`,
      at,
      kind: "alert",
      tone: alert.severity === "critical" ? "crit" : alert.severity === "warning" ? "warn" : "info",
      label: `${alert.severity} · ${alert.cause}`
    });
  }

  for (const entry of audit) {
    if (entry.actor === "system") continue;
    const at = Date.parse(entry.at);
    if (!inside(at)) continue;
    const accepted = entry.result === "accepted";
    const where = entry.entity ? ` ${entry.entity}` : "";

    if (entry.action.startsWith("control.")) {
      events.push({
        id: `audit:${entry.id}`,
        at,
        kind: "control",
        tone: accepted ? "ok" : "muted",
        label: `${entry.actor} ${entry.action.slice("control.".length)}${where} · ${accepted ? "accepted" : "refused"}`
      });
    } else if ((entry.action === "alert.acknowledge" || entry.action === "alert.resolve") && accepted) {
      events.push({
        id: `audit:${entry.id}`,
        at,
        kind: "operator",
        tone: "info",
        label: `${entry.actor} ${entry.action === "alert.acknowledge" ? "acknowledged" : "resolved"} an alert`
      });
    }
  }

  return events.sort((a, b) => a.at - b.at);
}
