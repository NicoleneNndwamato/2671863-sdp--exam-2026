import { useEffect, useState } from "react";
import type { AlertView } from "@sdp/shared";
import { fetchAlerts } from "./api";

const SERVICES = [
  { id: "rta", label: "Radio Telescope Array" },
  { id: "lwm", label: "Local Weather" },
  { id: "opg", label: "Power Generation" }
];

/**
 * Shell only: the annunciator is always mounted, because an operator must be
 * able to see alerts no matter which service they are looking at. Service
 * panels slot into <main>.
 */
export function App() {
  const [active, setActive] = useState(SERVICES[0].id);
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAlerts()
      .then((rows) => {
        if (!cancelled) setAlerts(rows);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeService = SERVICES.find((s) => s.id === active)!;
  const openAlerts = alerts.filter((a) => a.status !== "resolved");

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <nav aria-label="Services" style={{ width: 220, borderRight: "1px solid #ddd", padding: 16 }}>
        <h1 style={{ fontSize: 16 }}>ARL Operations</h1>
        {SERVICES.map((service) => (
          <button
            key={service.id}
            onClick={() => setActive(service.id)}
            aria-pressed={service.id === active}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              marginBottom: 4,
              border: "1px solid #ddd",
              borderRadius: 6,
              background: service.id === active ? "#eef4ff" : "transparent",
              cursor: "pointer"
            }}
          >
            {service.label}
          </button>
        ))}
      </nav>

      <main style={{ flex: 1, padding: 16 }}>
        <h2 style={{ fontSize: 18 }}>{activeService.label}</h2>
        <p style={{ color: "#666" }}>
          Telemetry panel for {activeService.id} goes here.
        </p>
        {error ? <p role="alert">Could not load alerts: {error}</p> : null}
      </main>

      <aside
        aria-label="Alert annunciator"
        style={{ width: 280, borderLeft: "1px solid #ddd", padding: 16 }}
      >
        <h2 style={{ fontSize: 16 }}>Alerts ({openAlerts.length})</h2>
        {openAlerts.length === 0 ? (
          <p style={{ color: "#666" }}>No alerts.</p>
        ) : (
          <ul style={{ paddingLeft: 16 }}>
            {openAlerts.map((alert) => (
              <li key={alert.id} style={{ marginBottom: 8 }}>
                <strong>{alert.severity}</strong> — {alert.cause}
                <div style={{ fontSize: 12, color: "#666" }}>{alert.status}</div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
