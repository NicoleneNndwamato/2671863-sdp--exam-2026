import { useState } from "react";
import type { AlertView } from "@sdp/shared";
import { useTheme } from "../theme-provider";
import { ago, fmtDateTime } from "../format";
import { Badge, Btn, Empty } from "./ui";

/**
 * The annunciator.
 *
 * Three visual states map exactly onto the lifecycle in the database:
 * raised (flashing, needs acknowledgement), acknowledged (steady, needs a
 * resolution), resolved (muted, kept as history). Nothing is ever deleted - the
 * trail is the point.
 */
export function AlertList({
  alerts,
  onAcknowledge,
  onResolve,
  canAct,
  actHint,
  compact,
  emptyLabel = "No alerts."
}: {
  alerts: AlertView[];
  onAcknowledge: (id: string) => Promise<void> | void;
  onResolve: (id: string, note: string) => Promise<void> | void;
  canAct: boolean;
  /** Why acting is (or is not) possible, shown on hover. */
  actHint?: string;
  compact?: boolean;
  emptyLabel?: string;
}) {
  const { theme: t } = useTheme();
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const hint = actHint ?? "A researcher code is asked for when you press this";

  if (alerts.length === 0) {
    return <Empty>{emptyLabel}</Empty>;
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: compact ? 6 : 8 }}>
      {alerts.map((alert) => {
        const tone = alert.severity === "critical" ? "crit" : alert.severity === "warning" ? "warn" : "info";
        const open = alert.status !== "resolved";
        return (
          <li
            key={alert.id}
            style={{
              // Severity is carried by three signals, not one: border, left
              // rule and a tinted body, so critical does not look like info at
              // a glance from across the room.
              border: `1px solid ${open ? (tone === "crit" ? t.critBorder : tone === "warn" ? t.warnBorder : t.infoBorder) : t.line}`,
              borderLeft: `3px solid ${open ? (tone === "crit" ? t.crit : tone === "warn" ? t.warn : t.info) : t.muted3}`,
              background: open ? (tone === "crit" ? t.critBg : tone === "warn" ? t.warnBg : t.infoBg) : t.panelSunken,
              padding: compact ? "7px 8px" : "9px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              opacity: alert.status === "resolved" ? 0.62 : 1
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Badge tone={tone}>{alert.severity}</Badge>
              <Badge tone={alert.status === "resolved" ? "neutral" : alert.status === "acknowledged" ? "info" : "warn"}>
                {alert.status}
              </Badge>
              <span style={{ fontSize: 10, color: t.muted2, marginLeft: "auto" }} title={fmtDateTime(alert.raisedAt)}>
                {ago(alert.raisedAt)}
              </span>
            </div>

            <div style={{ fontSize: 12, color: t.text, lineHeight: 1.35 }}>{alert.cause}</div>

            <div style={{ fontSize: 10, color: t.muted, fontFamily: "var(--font-mono)" }}>
              {alert.service}/{alert.device ?? "service"} · {alert.code}
            </div>

            {alert.status === "acknowledged" ? (
              <div style={{ fontSize: 10, color: t.muted2 }}>
                acked {ago(alert.acknowledgedAt)} by {alert.acknowledgedBy}
              </div>
            ) : null}
            {alert.status === "resolved" ? (
              <div style={{ fontSize: 10, color: t.muted2 }}>
                resolved {ago(alert.resolvedAt)} by {alert.resolvedBy} — {alert.resolution}
              </div>
            ) : null}

            {open ? (
              alert.status === "raised" ? (
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  <Btn
                    variant="primary"
                    onClick={() => void onAcknowledge(alert.id)}
                    title={canAct ? "Acknowledge this alert" : hint}
                  >
                    Acknowledge
                  </Btn>
                </div>
              ) : resolving === alert.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
                  <label htmlFor={`resolution-${alert.id}`} className="visually-hidden">
                    Resolution note
                  </label>
                  <textarea
                    id={`resolution-${alert.id}`}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={2}
                    placeholder="What did you do about it?"
                    style={{
                      background: t.panel,
                      border: `1px solid ${t.lineSoft}`,
                      color: t.text,
                      padding: "5px 6px",
                      resize: "vertical",
                      fontSize: 12
                    }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn
                      variant="ok"
                      disabled={note.trim().length === 0}
                      title={canAct ? "Resolve this alert" : hint}
                      onClick={async () => {
                        await onResolve(alert.id, note.trim());
                        setResolving(null);
                        setNote("");
                      }}
                    >
                      Resolve
                    </Btn>
                    <Btn variant="ghost" onClick={() => setResolving(null)}>
                      Cancel
                    </Btn>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  <Btn variant="ok" onClick={() => setResolving(alert.id)} title={canAct ? "Resolve this alert" : hint}>
                    Resolve
                  </Btn>
                </div>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
