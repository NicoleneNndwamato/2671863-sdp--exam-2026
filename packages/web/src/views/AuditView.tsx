import { useEffect, useState } from "react";
import type { AuditEntry } from "@sdp/shared";
import { useTheme } from "../theme-provider";
import { fetchAudit } from "../api";
import { Badge, Btn, Empty, Panel } from "../components/ui";
import { fmtDateTime } from "../format";

/**
 * Audit log.
 *
 * Every mutation the platform performs is appended here - alert transitions,
 * control commands, and rejected attempts. It is deliberately read-only in the
 * UI: an audit trail you can edit is not an audit trail.
 */
export function AuditView({ service }: { service: string }) {
  const { theme: t } = useTheme();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState(service === "all" ? "all" : service);

  useEffect(() => {
    setFilter(service === "all" ? "all" : service);
  }, [service]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAudit({ service: filter === "all" ? undefined : filter, limit: 300 })
      .then((rows) => {
        if (!cancelled) {
          setEntries(rows);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <Panel
      title="Audit log"
      subtitle="append-only record of alert transitions, control commands and rejected attempts"
      dense
      actions={
        <div style={{ display: "flex", gap: 6 }}>
          {["all", "rta", "lwm", "opg"].map((option) => (
            <Btn key={option} active={filter === option} onClick={() => setFilter(option)}>
              {option === "all" ? "All" : option.toUpperCase()}
            </Btn>
          ))}
        </div>
      }
    >
      {error ? (
        <div style={{ padding: 12, color: t.crit, fontSize: 12 }}>Could not load the audit log: {error}</div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 12 }}>
          <Empty>{loading ? "Loading…" : "No audited actions yet."}</Empty>
        </div>
      ) : (
        <div className="audit-scroll">
          <table className="audit-table">
            <caption className="visually-hidden">Audited actions, newest first</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Service</th>
                <th scope="col">Entity</th>
                <th scope="col">Result</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ color: t.muted, whiteSpace: "nowrap" }}>{fmtDateTime(entry.at)}</td>
                  <td style={{ color: t.text }}>{entry.actor}</td>
                  <td style={{ color: t.text }}>{entry.action}</td>
                  <td style={{ color: t.muted }}>{entry.service ?? "—"}</td>
                  <td style={{ color: t.muted }}>{entry.entity ?? "—"}</td>
                  <td>
                    <Badge tone={entry.result === "rejected" ? "crit" : entry.result === "raised" ? "warn" : "ok"}>{entry.result}</Badge>
                  </td>
                  <td style={{ color: t.muted, maxWidth: 420, whiteSpace: "normal" }}>
                    {entry.detail ?? "—"}
                    {entry.value ? (
                      <div style={{ color: t.muted2, fontSize: 10, marginTop: 2 }}>{JSON.stringify(entry.value)}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
