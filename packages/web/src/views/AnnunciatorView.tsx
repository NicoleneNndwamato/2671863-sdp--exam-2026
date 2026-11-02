import { useMemo, useState } from "react";
import type { AlertView } from "@sdp/shared";
import { Badge, Btn, Kpi, Panel } from "../components/ui";
import { AlertList } from "../components/AlertList";

/**
 * Full-screen annunciator.
 *
 * The aside keeps the operator honest while they work elsewhere; this view is
 * for the moment the alarm sounds and you need every open alert, grouped, with
 * the acknowledgement and resolution actions in front of you.
 */
export function AnnunciatorView({
  alerts,
  onAcknowledge,
  onResolve,
  canAct,
  actHint,
  serviceFilter,
  onServiceFilter,
  onRefresh
}: {
  alerts: AlertView[];
  onAcknowledge: (id: string) => Promise<void> | void;
  onResolve: (id: string, note: string) => Promise<void> | void;
  canAct: boolean;
  actHint?: string;
  serviceFilter: string;
  onServiceFilter: (value: string) => void;
  onRefresh: () => void;
}) {
  const [status, setStatus] = useState<"open" | "raised" | "acknowledged" | "resolved" | "all">("open");

  const visible = useMemo(() => {
    return alerts.filter((alert) => {
      if (serviceFilter !== "all" && alert.service !== serviceFilter) return false;
      if (status === "all") return true;
      if (status === "open") return alert.status !== "resolved";
      return alert.status === status;
    });
  }, [alerts, serviceFilter, status]);

  const counts = useMemo(
    () => ({
      raised: alerts.filter((alert) => alert.status === "raised").length,
      acknowledged: alerts.filter((alert) => alert.status === "acknowledged").length,
      resolved: alerts.filter((alert) => alert.status === "resolved").length,
      critical: alerts.filter((alert) => alert.status !== "resolved" && alert.severity === "critical").length
    }),
    [alerts]
  );

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        <Kpi label="Raised" value={counts.raised} tone={counts.raised > 0 ? "warn" : "ok"} hint="awaiting acknowledgement" />
        <Kpi label="Acknowledged" value={counts.acknowledged} tone="info" hint="awaiting resolution" />
        <Kpi label="Resolved" value={counts.resolved} tone="ok" hint="kept for the audit trail" />
        <Kpi label="Critical open" value={counts.critical} tone={counts.critical > 0 ? "crit" : "ok"} />
      </div>

      <Panel
        title="Alerts"
        subtitle="raised → acknowledged → resolved, with who and when recorded"
        actions={
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Btn active={status === "open"} onClick={() => setStatus("open")}>
              Open
            </Btn>
            <Btn active={status === "raised"} onClick={() => setStatus("raised")}>
              Raised
            </Btn>
            <Btn active={status === "acknowledged"} onClick={() => setStatus("acknowledged")}>
              Acked
            </Btn>
            <Btn active={status === "resolved"} onClick={() => setStatus("resolved")}>
              Resolved
            </Btn>
            <Btn active={status === "all"} onClick={() => setStatus("all")}>
              All
            </Btn>
            <span style={{ width: 1, background: "currentColor", opacity: 0.15 }} />
            <Btn active={serviceFilter === "all"} onClick={() => onServiceFilter("all")}>
              All services
            </Btn>
            <Btn active={serviceFilter === "rta"} onClick={() => onServiceFilter("rta")}>
              RTA
            </Btn>
            <Btn active={serviceFilter === "lwm"} onClick={() => onServiceFilter("lwm")}>
              LWM
            </Btn>
            <Btn active={serviceFilter === "opg"} onClick={() => onServiceFilter("opg")}>
              OPG
            </Btn>
            <Btn variant="ghost" onClick={onRefresh}>
              Refresh
            </Btn>
          </div>
        }
      >
        <div style={{ marginBottom: 8 }}>
          <Badge tone={canAct ? "ok" : "warn"}>
            {canAct ? "control enabled" : (actHint ?? "researcher code required to act")}
          </Badge>
        </div>
        <AlertList
          alerts={visible}
          onAcknowledge={onAcknowledge}
          onResolve={onResolve}
          canAct={canAct}
          actHint={actHint}
          emptyLabel={status === "open" ? "No open alerts." : "Nothing matches this filter."}
        />
      </Panel>
    </>
  );
}
