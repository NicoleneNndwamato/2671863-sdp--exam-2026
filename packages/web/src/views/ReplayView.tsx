import { useMemo, useState } from "react";
import type { AlertView, Reading } from "@sdp/shared";
import { useTheme } from "../theme-provider";
import { Badge, Btn, Empty, Field, Kpi, Panel, Select, TextInput } from "../components/ui";
import { fmtDateTime, fmtTime, splitTopic } from "../format";
import type { ReplayEvent } from "../replayEvents";

export interface ReplaySession {
  service: string;
  from: string;
  to: string;
  readings: Reading[];
  /** Alerts and operator actions inside the window, drawn on the timeline. */
  events?: ReplayEvent[];
  cursor: number;
  playing: boolean;
  speed: number;
  loading: boolean;
  error: string | null;
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

/**
 * Replay.
 *
 * Replay reads the archive this platform captured (`raw_messages`), not the
 * ARL's backlog endpoint: the point is to reconstruct exactly what this
 * dashboard saw. The window is explicit so an incident can be reproduced.
 */
export function ReplayView({
  session,
  alerts,
  onLoad,
  onSeek,
  onTogglePlay,
  onSpeed,
  onOpen,
  onExit
}: {
  session: ReplaySession | null;
  alerts: AlertView[];
  onLoad: (service: string, from: string, to: string) => void;
  onSeek: (cursor: number) => void;
  onTogglePlay: () => void;
  onSpeed: (speed: number) => void;
  onOpen: (service: string) => void;
  onExit: () => void;
}) {
  const { theme: t } = useTheme();
  const now = useMemo(() => new Date(), []);
  const [service, setService] = useState(session?.service ?? "rta");
  const [from, setFrom] = useState(toLocalInput(session?.from ?? new Date(now.getTime() - 15 * 60_000).toISOString()));
  const [to, setTo] = useState(toLocalInput(session?.to ?? now.toISOString()));

  const inWindow = useMemo(() => {
    if (!session) return [];
    return alerts.filter((alert) => {
      const at = Date.parse(alert.raisedAt);
      return alert.service === session.service && at >= Date.parse(session.from) && at <= Date.parse(session.to);
    });
  }, [alerts, session]);

  const nearCursor = useMemo(() => {
    if (!session) return [];
    return session.readings
      .filter((reading) => Math.abs(Date.parse(reading.observedAt) - session.cursor) < 2_000)
      .slice(-40)
      .reverse();
  }, [session]);

  return (
    <>
      <Panel
        title="Replay a captured window"
        subtitle="read from this platform's own archive, so the replay shows exactly what was seen at the time"
        actions={
          session ? (
            <div style={{ display: "flex", gap: 6 }}>
              <Btn variant="primary" onClick={() => onOpen(session.service)}>
                Open {session.service.toUpperCase()} panel
              </Btn>
              <Btn variant="ghost" onClick={onExit}>
                Exit replay
              </Btn>
            </div>
          ) : null
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr auto", gap: 8, alignItems: "end" }}>
          <Field label="Service">
            <Select
              value={service}
              onChange={setService}
              options={[
                { value: "rta", label: "Radio Telescope Array" },
                { value: "lwm", label: "Local Weather" },
                { value: "opg", label: "Power Generation" }
              ]}
            />
          </Field>
          <Field label="From (local)">
            <TextInput value={from} onChange={setFrom} type="datetime-local" />
          </Field>
          <Field label="To (local)">
            <TextInput value={to} onChange={setTo} type="datetime-local" />
          </Field>
          <Btn
            variant="primary"
            onClick={() => onLoad(service, fromLocalInput(from), fromLocalInput(to))}
            disabled={session?.loading}
          >
            {session?.loading ? "Loading…" : "Play/Load window"}
          </Btn>
        </div>

        {session?.error ? (
          <div style={{ marginTop: 10, padding: "8px 10px", background: t.warnBg, border: `1px solid ${t.warnBorder}`, color: t.warn, fontSize: 12 }}>
            {session.error}
          </div>
        ) : null}

        {session && session.readings.length > 0 ? (
          <div className="kpi-row" style={{ marginTop: 12 }}>
            <Kpi label="Captured rows" value={session.readings.length} hint={`${session.service.toUpperCase()} window`} />
            <Kpi label="Window start" value={fmtTime(session.from)} hint={fmtDateTime(session.from)} />
            <Kpi label="Window end" value={fmtTime(session.to)} hint={fmtDateTime(session.to)} />
            <Kpi label="Alerts in window" value={inWindow.length} tone={inWindow.length > 0 ? "warn" : "ok"} />
          </div>
        ) : null}

        {session && session.readings.length === 0 && !session.loading ? (
          <div style={{ marginTop: 12 }}>
            <Empty>No captured messages in that window yet. Let the platform ingest for a few minutes, then replay it.</Empty>
          </div>
        ) : null}
      </Panel>

      {session && session.readings.length > 0 ? (
        <div className="grid-2">
          <Panel
            title="Messages at the cursor"
            subtitle={`${fmtDateTime(new Date(session.cursor).toISOString())} · within ±2 s`}
            actions={
              <div style={{ display: "flex", gap: 4 }}>
                <Btn onClick={onTogglePlay} variant={session.playing ? "danger" : "primary"}>
                  {session.playing ? "Pause" : "Play"}
                </Btn>
                {[0.5, 1, 4, 16].map((speed) => (
                  <Btn key={speed} active={session.speed === speed} onClick={() => onSpeed(speed)}>
                    {speed}×
                  </Btn>
                ))}
              </div>
            }
            dense
          >
            <div style={{ maxHeight: 320, overflow: "auto" }}>
              <table>
                <caption className="visually-hidden">Raw messages captured near the replay cursor</caption>
                <thead style={{ position: "sticky", top: 0, background: t.panel2 }}>
                  <tr style={{ color: t.muted, borderBottom: `1px solid ${t.line}` }}>
                    <th scope="col">Time</th>
                    <th scope="col">Entity</th>
                    <th scope="col">Stream</th>
                    <th scope="col">Fields</th>
                  </tr>
                </thead>
                <tbody style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
                  {nearCursor.map((reading, index) => {
                    const parts = splitTopic(reading.topic);
                    const fields = Object.entries(reading.payload)
                      .filter(([key]) => !["v", "ts", "seq", "entity", "_kind", "_name"].includes(key))
                      .map(([key, value]) => `${key}=${typeof value === "number" ? Number(value.toFixed(3)) : String(value)}`)
                      .join(" ");
                    return (
                      <tr key={`${reading.topic}-${reading.observedAt}-${index}`} style={{ borderBottom: `1px solid ${t.lineSoft}` }}>
                        <td style={{ color: t.muted, whiteSpace: "nowrap" }}>{fmtTime(reading.observedAt)}</td>
                        <td style={{ color: t.text }}>{parts.entity}</td>
                        <td style={{ color: t.muted }}>
                          {parts.kind}/{parts.name}
                        </td>
                        <td style={{ color: t.muted2, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {fields || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Alerts raised in this window" subtitle="context for the replay, with the operator's trail">
            {inWindow.length === 0 ? (
              <Empty>No alerts were raised during this window.</Empty>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {inWindow.map((alert) => (
                  <li key={alert.id}>
                    <button
                      onClick={() => onSeek(Date.parse(alert.raisedAt))}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: t.panelSunken,
                        border: `1px solid ${t.line}`,
                        padding: "6px 8px",
                        cursor: "pointer"
                      }}
                    >
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <Badge tone={alert.severity === "critical" ? "crit" : alert.severity === "warning" ? "warn" : "info"}>
                          {alert.severity}
                        </Badge>
                        <span style={{ fontSize: 10, color: t.muted2 }}>{fmtTime(alert.raisedAt)}</span>
                        <span style={{ fontSize: 10, color: t.muted, marginLeft: "auto" }}>{alert.status}</span>
                      </div>
                      <div style={{ fontSize: 11, color: t.text, marginTop: 3 }}>{alert.cause}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}
    </>
  );
}
