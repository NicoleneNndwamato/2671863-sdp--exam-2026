import { useEffect, useMemo, useState } from "react";
import type { AlertView, Reading, ServiceTopology } from "@sdp/shared";
import { useTheme } from "./theme-provider";
import {
  acknowledgeAlert,
  fetchAlerts,
  fetchAudit,
  fetchLatest,
  fetchReadings,
  fetchStats,
  fetchTargets,
  fetchTopology,
  resolveAlert,
  sendControl,
  type LatestItem,
  type StatsResponse,
  type Target
} from "./api";
import { buildSnapshot, snapshotAt } from "./snapshot";
import { buildReplayEvents } from "./replayEvents";
import { Badge, Btn, Dot, Toasts, type ToastMessage } from "./components/ui";
import { AlertList } from "./components/AlertList";
import { PanelBoundary } from "./components/ErrorBoundary";
import { ReplayBar } from "./components/ReplayBar";
import { ResearcherCard } from "./components/ResearcherCard";
import { CodeModal, type GateRequest } from "./components/CodeModal";
import { RtaView } from "./views/RtaView";
import { WeatherView } from "./views/WeatherView";
import { PowerView } from "./views/PowerView";
import { ReplayView, type ReplaySession } from "./views/ReplayView";
import { AnnunciatorView } from "./views/AnnunciatorView";
import { AuditView } from "./views/AuditView";
import { ResearchersView } from "./views/ResearchersView";
import type { ViewProps } from "./view-types";
import { ago, fmtInt, fmtTime } from "./format";
import {
  canOperate,
  clearResearcher,
  describeServices,
  loadResearcher,
  saveResearcher,
  type ResearcherSession
} from "./researcher";

/**
 * Meridian shell.
 *
 * The layout is the argument: the brand owns the top-left corner, the service
 * panel is the middle column, the annunciator is always mounted on the right,
 * and the replay transport always takes the bottom rail. An operator therefore
 * never loses sight of an open alert or of the fact that they are not looking
 * at live data.
 *
 * Nothing here is hidden behind authentication. A researcher code is asked for
 * at the moment of interaction, which is exactly what the brief requires: data
 * visible to everyone, state changes attributable to someone.
 */

const SERVICES = [
  { id: "rta", label: "Radio Telescope", short: "RTA", hint: "100 dishes", icon: "telescope" },
  { id: "lwm", label: "Local Weather", short: "LWM", hint: "5 sites", icon: "weather" },
  { id: "opg", label: "Power Generation", short: "OPG", hint: "solar · battery · diesel", icon: "power" }
] as const;

const PLATFORM = [
  { id: "replay", label: "Replay", hint: "captured windows", icon: "replay" },
  { id: "annunciator", label: "Annunciator", hint: "every open alert", icon: "bell" },
  { id: "audit", label: "Audit log", hint: "append-only", icon: "audit" },
  { id: "researchers", label: "Active researchers", hint: "who is verified here", icon: "users" }
] as const;

type ServiceId = (typeof SERVICES)[number]["id"];
type Route = ServiceId | (typeof PLATFORM)[number]["id"];

const ALERT_POLL_MS = 5_000;
const LATEST_POLL_MS = 3_000;
const HISTORY_POLL_MS = 20_000;
const HISTORY_WINDOW_MS = 30 * 60_000;

function isService(route: Route): route is ServiceId {
  return route === "rta" || route === "lwm" || route === "opg";
}

/** A control action that was waiting on a researcher code. */
interface PendingGate {
  request: GateRequest;
  initialCode?: string;
  run?: (code: string) => void;
}

export function App() {
  const { theme: t, dark, toggle } = useTheme();

  const [route, setRoute] = useState<Route>("rta");
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [topologies, setTopologies] = useState<Record<string, ServiceTopology | null>>({});
  const [targets, setTargets] = useState<Target[]>([]);
  const [researcher, setResearcher] = useState<ResearcherSession | null>(loadResearcher);
  const [pending, setPending] = useState<PendingGate | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [live, setLive] = useState<LatestItem[]>([]);
  const [history, setHistory] = useState<Reading[]>([]);
  const [replay, setReplay] = useState<ReplaySession | null>(null);
  const [clock, setClock] = useState<Date>(() => new Date());

  // --- side effects -------------------------------------------------------

  function notify(tone: ToastMessage["tone"], title: string, detail?: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((previous) => [...previous, { id, tone, title, detail }].slice(-4));
    window.setTimeout(() => setToasts((previous) => previous.filter((message) => message.id !== id)), 7000);
  }

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Topology and target catalogue are static for the length of a session.
  useEffect(() => {
    let cancelled = false;

    fetchTargets()
      .then((rows) => {
        if (!cancelled) setTargets(Array.isArray(rows) ? rows : []);
      })
      .catch(() => undefined);

    for (const service of SERVICES) {
      fetchTopology(service.id)
        .then((topology) => {
          if (!cancelled) setTopologies((previous) => ({ ...previous, [service.id]: topology ?? null }));
        })
        .catch(() => {
          if (!cancelled) setTopologies((previous) => ({ ...previous, [service.id]: null }));
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  async function reloadAlerts() {
    try {
      const rows = await fetchAlerts({ limit: 200 });
      setAlerts(Array.isArray(rows) ? rows : []);
      setAlertsError(null);
    } catch (err) {
      setAlertsError((err as Error).message);
    }
  }

  async function reloadStats() {
    try {
      setStats(await fetchStats());
    } catch {
      // Health is decoration; a failure here must not blank the panel.
    }
  }

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void reloadAlerts();
      void reloadStats();
    };
    tick();
    const id = window.setInterval(tick, ALERT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveService: ServiceId | null = isService(route) ? route : null;

  useEffect(() => {
    if (!liveService) return;
    let cancelled = false;
    const service = liveService;

    async function loadLatest() {
      try {
        const items = await fetchLatest(service);
        if (!cancelled) setLive(Array.isArray(items) ? items : []);
      } catch {
        // Keep the previous snapshot rather than flashing an empty panel.
      }
    }

    async function loadHistory() {
      try {
        const to = new Date().toISOString();
        const from = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
        const window_ = await fetchReadings(service, from, to, { limit: 8000 });
        if (!cancelled) setHistory(window_?.readings ?? []);
      } catch {
        // Charts degrade to "no data in this window".
      }
    }

    void loadLatest();
    void loadHistory();
    const latestTimer = window.setInterval(() => void loadLatest(), LATEST_POLL_MS);
    const historyTimer = window.setInterval(() => void loadHistory(), HISTORY_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(latestTimer);
      window.clearInterval(historyTimer);
    };
  }, [liveService]);

  // Playback clock. One tick advances the cursor by speed x 1s of captured time.
  useEffect(() => {
    if (!replay?.playing) return;
    const id = window.setInterval(() => {
      setReplay((previous) => {
        if (!previous || !previous.playing) return previous;
        const end = previous.readings.length
          ? Date.parse(previous.readings[previous.readings.length - 1].observedAt)
          : Date.parse(previous.to);
        const next = previous.cursor + 1000 * previous.speed;
        if (next >= end) return { ...previous, cursor: end, playing: false };
        return { ...previous, cursor: next };
      });
    }, 400);
    return () => window.clearInterval(id);
  }, [replay?.playing, replay?.speed]);

  // --- derived state ------------------------------------------------------

  const openAlerts = useMemo(() => alerts.filter((alert) => alert.status !== "resolved"), [alerts]);
  const criticalOpen = openAlerts.filter((alert) => alert.severity === "critical").length;

  const liveSnapshot = useMemo(() => buildSnapshot(live), [live]);

  const replayFrame = useMemo(() => {
    if (!replay) return null;
    const readings = replay.readings;
    // readings are ascending, so the visible history is a prefix.
    let lo = 0;
    let hi = readings.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Date.parse(readings[mid].observedAt) <= replay.cursor) lo = mid + 1;
      else hi = mid;
    }
    return { snapshot: snapshotAt(readings, replay.cursor), history: readings.slice(0, lo) };
  }, [replay]);

  const snapshot = replayFrame?.snapshot ?? liveSnapshot;
  const visibleHistory = replayFrame?.history ?? history;

  const activeService: ServiceId = isService(route) ? route : replay ? (replay.service as ServiceId) : "rta";
  const activeMeta = SERVICES.find((service) => service.id === activeService) ?? SERVICES[0];
  const activeStats = stats?.services?.find((service) => service.id === activeService) ?? null;

  /** Reading is open to everyone; operating this service is not. */
  const canControl = canOperate(researcher, activeService);

  /**
   * The sentence a disabled-looking action carries. It distinguishes the three
   * reasons the console will not act: replay, no code at all, and a valid code
   * that is simply not assigned to this experiment - the last one is easy to
   * mistake for "signed out", so it has to name the reason.
   */
  const actHint = canControl
    ? undefined
    : replay
      ? "Replay is read-only - exit the replay to act"
      : !researcher
        ? "A researcher code is asked for when you press this"
        : `${researcher.name ?? researcher.code} is not assigned to ${activeMeta.label}`;

  const serviceTitle = isService(route) ? activeMeta.label : PLATFORM.find((entry) => entry.id === route)?.label;

  // --- actions ------------------------------------------------------------

  /**
   * Every state change goes through here.
   *
   * No code yet -> ask for one and keep the action pending. Code present but
   * not for this experiment -> say so before the ARL API has to. Otherwise run
   * it, with the code attached, so the audit trail names a person.
   */
  function guard(service: string, label: string, run: (code: string) => void) {
    if (replay) {
      notify("warn", "Replay is read-only", "Exit the replay before sending a command to the lab.");
      return;
    }
    if (!researcher) {
      setPending({ request: { service, label }, run });
      return;
    }
    if (!canOperate(researcher, service)) {
      notify(
        "crit",
        `Not permitted on ${service.toUpperCase()}`,
        `${researcher.name ?? researcher.code} is not assigned to that experiment, so the ARL API would refuse the command.`
      );
      return;
    }
    run(researcher.code);
  }

  function handleGranted(next: ResearcherSession, refusal?: string) {
    const action = pending?.run;
    saveResearcher(next);
    setResearcher(next);
    setPending(null);

    if (refusal) {
      // The code is genuine, so the console still records who is present -
      // but the awaiting action is dropped rather than sent and rejected.
      notify("warn", `Verified as ${next.name ?? next.code}`, refusal);
      return;
    }

    notify("ok", `Verified as ${next.name ?? next.code}`, `Experiments: ${describeServices(next)}`);
    if (action) action(next.code);
  }

  function signOut() {
    clearResearcher();
    setResearcher(null);
    notify("info", "Code cleared", "The console is read-only again. The code is forgotten when the tab closes.");
  }

  async function handleAcknowledge(id: string) {
    const alert = alerts.find((candidate) => candidate.id === id);
    guard(alert?.service ?? activeService, "Acknowledge an alert", (code) => {
      void (async () => {
        try {
          const updated = await acknowledgeAlert(id, code);
          if (updated?.id) setAlerts((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
          notify("ok", "Alert acknowledged", `Recorded against ${code}.`);
          void reloadAlerts();
        } catch (err) {
          notify("crit", "Acknowledgement refused", (err as Error).message);
        }
      })();
    });
  }

  async function handleResolve(id: string, note: string) {
    const alert = alerts.find((candidate) => candidate.id === id);
    guard(alert?.service ?? activeService, "Resolve an alert", (code) => {
      void (async () => {
        try {
          const updated = await resolveAlert(id, code, note || "resolved by operator");
          if (updated?.id) setAlerts((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
          notify("ok", "Alert resolved", note ? `Resolution: ${note}` : "No resolution note given.");
          void reloadAlerts();
        } catch (err) {
          notify("crit", "Resolution refused", (err as Error).message);
        }
      })();
    });
  }

  function handleControl(service: ServiceId, entity: string, control: string, value: unknown) {
    const label = `${control.replace(/_/g, " ")} → ${entity}`;
    guard(service, label, (code) => {
      void (async () => {
        try {
          const result = await sendControl(service, code, entity, control, value);
          notify(result?.accepted ? "ok" : "warn", label, result?.note ?? "Command published.");
        } catch (err) {
          notify("crit", "Command refused", (err as Error).message);
        }
      })();
    });
  }

  async function loadReplay(service: string, from: string, to: string) {
    setReplay({
      service,
      from,
      to,
      readings: [],
      cursor: Date.parse(from),
      playing: false,
      speed: 4,
      loading: true,
      error: null
    });
    try {
      // Markers are context, not the replay itself: if the alert or audit
      // read fails the window still plays, just without dots on the rail.
      const [window_, windowAlerts, windowAudit] = await Promise.all([
        fetchReadings(service, from, to, { limit: 10_000 }),
        Promise.resolve()
          .then(() => fetchAlerts({ service, from, to, limit: 500 }))
          .catch(() => []),
        Promise.resolve()
          .then(() => fetchAudit({ service, from, to, limit: 1000 }))
          .catch(() => [])
      ]);
      const readings = window_?.readings ?? [];
      const events = buildReplayEvents(
        Array.isArray(windowAlerts) ? windowAlerts : [],
        Array.isArray(windowAudit) ? windowAudit : [],
        from,
        to
      );
      setReplay((previous) =>
        previous
          ? {
              ...previous,
              readings,
              events,
              loading: false,
              // "Play/Load window": start playing as soon as there is something to play.
              playing: readings.length > 0,
              cursor: readings.length > 0 ? Date.parse(readings[0].observedAt) : Date.parse(from)
            }
          : previous
      );
    } catch (err) {
      setReplay((previous) => (previous ? { ...previous, loading: false, error: (err as Error).message } : previous));
    }
  }

  function seek(cursor: number) {
    setReplay((previous) => {
      if (!previous) return previous;
      const start = previous.readings.length ? Date.parse(previous.readings[0].observedAt) : Date.parse(previous.from);
      const end = previous.readings.length
        ? Date.parse(previous.readings[previous.readings.length - 1].observedAt)
        : Date.parse(previous.to);
      return { ...previous, cursor: Math.min(Math.max(cursor, start), end) };
    });
  }

  function step(seconds: number) {
    setReplay((previous) => {
      if (!previous) return previous;
      const start = previous.readings.length ? Date.parse(previous.readings[0].observedAt) : Date.parse(previous.from);
      const end = previous.readings.length
        ? Date.parse(previous.readings[previous.readings.length - 1].observedAt)
        : Date.parse(previous.to);
      const cursor = Math.min(Math.max(previous.cursor + seconds * 1000, start), end);
      return { ...previous, cursor };
    });
  }

  function togglePlay() {
    setReplay((previous) => (previous ? { ...previous, playing: !previous.playing } : previous));
  }

  function setSpeed(speed: number) {
    setReplay((previous) => (previous ? { ...previous, speed } : previous));
  }

  /**
   * Switching service while a replay is loaded would show one service's history
   * inside another service's panels, so the replay is dropped instead: the
   * bottom rail goes back to LIVE and every panel back to its own feed.
   */
  function openService(id: ServiceId) {
    setRoute(id);
    setReplay((previous) => (previous && previous.service !== id ? null : previous));
  }

  // --- render -------------------------------------------------------------

  const viewProps: ViewProps = {
    service: activeService,
    displayName: activeMeta.label,
    topology: topologies[activeService] ?? null,
    snapshot,
    history: visibleHistory,
    onSubmit: (entity, control, value) => handleControl(activeService, entity, control, value),
    canControl,
    actHint,
    targets,
    replayAt: replay ? new Date(replay.cursor).toISOString() : null
  };

  const onlineCount = stats?.services?.filter((service) => service.online).length ?? 0;
  // The API lost the broker and is backing off; say so rather than "idle".
  const linkDown = stats?.broker?.state === "reconnecting" || stats?.broker?.state === "connecting";
  const written = stats?.ingest.written ?? 0;

  return (
    <div className="shell" style={{ background: t.bg, color: t.text }}>
      <div className="brand" style={{ background: t.primary, color: t.onPrimary }}>
        <div className="brand-mark" aria-hidden>
          M
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="brand-name">Meridian</div>
          <div className="brand-sub">ARL · Carnarvon · ZA</div>
        </div>
      </div>

      <header className="topbar" style={{ background: t.panel, borderColor: t.line }}>
        <span className="pill" style={{ background: t.panel2, borderColor: t.line }}>
          <Dot tone={linkDown ? "warn" : onlineCount > 0 ? "ok" : "muted"} pulse={!linkDown && onlineCount > 0} />
          broker{" "}
          <b title={linkDown ? stats?.broker?.lastError ?? undefined : undefined}>
            {linkDown
              ? `reconnecting${stats?.broker?.attempts ? ` (try ${stats.broker.attempts})` : ""}`
              : onlineCount > 0
                ? `${onlineCount} live`
                : "idle"}
          </b>
        </span>
        <span className="pill hide-md" style={{ background: t.panel2, borderColor: t.line }}>
          <Dot tone="info" />
          <b>{fmtInt(written)}</b> messages written
        </span>
        <span className="pill" style={{ background: t.panel2, borderColor: t.line }}>
          <Dot tone={criticalOpen > 0 ? "crit" : openAlerts.length > 0 ? "warn" : "ok"} />
          <b>{openAlerts.length}</b> open {criticalOpen > 0 ? `· ${criticalOpen} critical` : "alerts"}
        </span>

        <div className="spacer" />

        <div className={replay ? "clock replay" : "clock"}>
          {fmtTime(clock.toISOString())} <span>UTC</span>
        </div>

        <div className="theme-toggle" role="group" aria-label="Colour theme" style={{ background: t.panel2, borderColor: t.line }}>
          <button
            type="button"
            aria-pressed={!dark}
            onClick={() => {
              if (dark) toggle();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
            </svg>
            Light
          </button>
          <button
            type="button"
            aria-pressed={dark}
            onClick={() => {
              if (!dark) toggle();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M20 13.5A8 8 0 0 1 10.5 4a8 8 0 1 0 9.5 9.5Z" />
            </svg>
            Dark
          </button>
        </div>

        <ResearcherCard
          researcher={researcher}
          service={activeService}
          busy={Boolean(pending)}
          onAskCode={() => setPending({ request: { service: activeService, label: "Verify a researcher code" } })}
          onSignOut={signOut}
        />
      </header>

      <nav className="sidebar" aria-label="Services" style={{ background: t.panel, borderColor: t.line }}>
        <div className="nav-label">Services</div>
        {SERVICES.map((service) => {
          const serviceStats = stats?.services?.find((row) => row.id === service.id);
          const openHere = openAlerts.filter((alert) => alert.service === service.id).length;
          return (
            <button
              key={service.id}
              type="button"
              className={route === service.id ? "nav-item active" : "nav-item"}
              aria-pressed={route === service.id}
              aria-label={service.label}
              onClick={() => openService(service.id)}
              style={route === service.id ? { background: t.primary, color: t.onPrimary } : { color: t.navFg }}
            >
              <Icon name={service.icon} />
              <span className="nav-text">
                <span style={{ fontSize: 13, fontWeight: route === service.id ? 600 : 400 }}>{service.label}</span>
                <span className="nav-hint" style={route === service.id ? undefined : { color: t.muted3 }}>
                  {service.short} · {serviceStats ? (serviceStats.online ? service.hint : "offline") : service.hint}
                </span>
              </span>
              {openHere > 0 ? <span className="nav-badge">{openHere}</span> : null}
            </button>
          );
        })}

        <div className="nav-label">Platform</div>
        {PLATFORM.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={route === entry.id ? "nav-item active" : "nav-item"}
            aria-pressed={route === entry.id}
            aria-label={entry.label}
            onClick={() => setRoute(entry.id)}
            style={route === entry.id ? { background: t.primary, color: t.onPrimary } : { color: t.navFg }}
          >
            <Icon name={entry.icon} />
            <span className="nav-text">
              <span style={{ fontSize: 13, fontWeight: route === entry.id ? 600 : 400 }}>{entry.label}</span>
              <span className="nav-hint" style={route === entry.id ? undefined : { color: t.muted3 }}>
                {entry.hint}
              </span>
            </span>
            {entry.id === "annunciator" && openAlerts.length > 0 ? (
              <span className="nav-badge">{openAlerts.length}</span>
            ) : null}
          </button>
        ))}

        <div className="sidebar-foot">
          Ingest queued <b>{fmtInt(stats?.ingest.queued ?? 0)}</b>
          <br />
          Written <b>{fmtInt(written)}</b>
          <br />
          Dropped{" "}
          <b style={{ color: (stats?.ingest.dropped ?? 0) > 0 ? t.crit : t.strong }}>{fmtInt(stats?.ingest.dropped ?? 0)}</b>
          <br />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>wmc.ms.wits.ac.za:1883</span>
        </div>
      </nav>

      <main className="main" style={{ borderColor: t.line }}>
        <div className="panel-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="panel-title">{serviceTitle}</h1>
            <p className="panel-sub">
              {isService(route) ? (
                <>
                  <b>{activeMeta.label}</b> · {topologies[activeService] ? `${topologies[activeService]!.entities.length} entities` : "topology pending"}
                  {activeStats ? ` · ${fmtInt(activeStats.messages)} messages` : ""}
                  {snapshot.at ? ` · seen ${ago(snapshot.at)}` : ""}
                </>
              ) : (
                "Platform tooling for the whole lab"
              )}
            </p>
          </div>

          <div className="subarrays">
            {replay ? <span className="chip on">replay · {new Date(replay.cursor).toISOString().slice(11, 16)}Z</span> : null}
            {!replay && isService(route) ? <span className="chip on">live</span> : null}
            {isService(route) ? (
              <span className="chip" style={{ color: canControl ? t.ok : t.muted }} title={actHint}>
                {canControl
                  ? `${researcher!.code} · control`
                  : researcher
                    ? `${researcher.code} · not on ${activeMeta.short}`
                    : "read-only"}
              </span>
            ) : null}
          </div>
        </div>

        {alertsError ? (
          <div
            role="alert"
            style={{
              marginBottom: 10,
              padding: "6px 10px",
              fontSize: 11.5,
              background: t.warnBg,
              border: `1px solid ${t.warnBorder}`,
              color: t.warn
            }}
          >
            Could not reach the alert service: {alertsError}. The panel below may be stale.
          </div>
        ) : null}

        <PanelBoundary name={serviceTitle ?? "This view"}>
          {route === "rta" ? <RtaView {...viewProps} /> : null}
          {route === "lwm" ? <WeatherView {...viewProps} /> : null}
          {route === "opg" ? <PowerView {...viewProps} /> : null}

          {route === "annunciator" ? (
            <AnnunciatorView
              alerts={alerts}
              onAcknowledge={handleAcknowledge}
              onResolve={handleResolve}
              canAct={canControl}
              actHint={actHint}
              serviceFilter="all"
              onServiceFilter={() => undefined}
              onRefresh={() => void reloadAlerts()}
            />
          ) : null}

          {route === "replay" ? (
            <ReplayView
              session={replay}
              alerts={alerts}
              onLoad={(service, from, to) => void loadReplay(service, from, to)}
              onSeek={seek}
              onTogglePlay={togglePlay}
              onSpeed={setSpeed}
              onOpen={(service) => openService(service as ServiceId)}
              onExit={() => setReplay(null)}
            />
          ) : null}

          {route === "audit" ? <AuditView service={activeService} /> : null}

          {route === "researchers" ? (
            <ResearchersView
              researcher={researcher}
              activeCode={researcher?.code ?? ""}
              onUseCode={(code) => setPending({ request: { service: activeService, label: `Verify ${code}` }, initialCode: code })}
              onSignOut={signOut}
            />
          ) : null}
        </PanelBoundary>

        {/* The transport belongs to this page: it appears once a window is
            loaded and disappears with the page, so live dashboards never show
            a paused transport they cannot use. */}
        {route === "replay" && replay ? (
          <div className="replay-dock">
            <ReplayBar
              session={replay}
              onTogglePlay={togglePlay}
              onSeek={seek}
              onStep={step}
              onSpeed={setSpeed}
              onLive={() => setReplay(null)}
              onOpenReplay={() => setRoute("replay")}
            />
          </div>
        ) : null}
      </main>

      <aside className="alerts" aria-label="Alert annunciator" style={{ background: t.panel, borderColor: t.line }}>
        <div className="alerts-head" style={{ borderColor: t.line }}>
          <h2>Annunciator</h2>
          <Badge tone={criticalOpen > 0 ? "crit" : openAlerts.length > 0 ? "warn" : "ok"}>{openAlerts.length} open</Badge>
          <div style={{ marginLeft: "auto" }}>
            <Btn onClick={() => void reloadAlerts()} title="Re-read the alert table now">
              Refresh
            </Btn>
          </div>
        </div>

        <div className="alerts-body">
          <AlertList
            alerts={openAlerts.slice(0, 12)}
            onAcknowledge={handleAcknowledge}
            onResolve={handleResolve}
            canAct={canControl}
            actHint={actHint}
            compact
          />
          {openAlerts.length > 12 ? (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: t.muted }}>
                showing 12 of {openAlerts.length}
              </span>
              <div style={{ marginLeft: "auto" }}>
                <Btn onClick={() => setRoute("annunciator")}>Open annunciator</Btn>
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ borderTop: `1px solid ${t.line}`, padding: "8px 12px", background: t.panel2 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: t.muted, marginBottom: 4 }}>
            Ingest
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--font-mono)", color: t.muted }}>
            <span>queued {fmtInt(stats?.ingest.queued ?? 0)}</span>
            <span>written {fmtInt(written)}</span>
            <span style={{ color: (stats?.ingest.dropped ?? 0) > 0 ? t.crit : t.muted }}>
              dropped {fmtInt(stats?.ingest.dropped ?? 0)}
            </span>
          </div>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            {(stats?.services ?? []).map((service) => (
              <div key={service.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: t.muted }}>
                <Dot tone={service.online ? "ok" : "muted"} />
                <span style={{ fontFamily: "var(--font-mono)" }}>{service.id}</span>
                <span style={{ marginLeft: "auto", color: t.muted2 }}>{service.lastSeen ? ago(service.lastSeen) : "never"}</span>
                <span style={{ width: 52, textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmtInt(service.messages)}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {pending ? (
        <CodeModal
          request={pending.request}
          initialCode={pending.initialCode}
          onCancel={() => setPending(null)}
          onGranted={handleGranted}
        />
      ) : null}

      <Toasts messages={toasts} onDismiss={(id) => setToasts((previous) => previous.filter((message) => message.id !== id))} />
    </div>
  );
}

/** Line icons, drawn to the mockup's 24-unit grid. */
function Icon({ name }: { name: string }) {
  if (name === "telescope") {
    return (
      <svg className="ico" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <circle cx="12" cy="12" r="8.5" opacity=".35" />
      </svg>
    );
  }
  if (name === "weather") {
    return (
      <svg className="ico" viewBox="0 0 24 24" aria-hidden>
        <path d="M3 8h11a3 3 0 1 0-2.6-4.5" />
        <path d="M3 13h15a3 3 0 1 1-2.6 4.5" />
        <path d="M3 18h7" />
      </svg>
    );
  }
  if (name === "power") {
    return (
      <svg className="ico" viewBox="0 0 24 24" aria-hidden>
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
      </svg>
    );
  }
  if (name === "replay") {
    return (
      <svg className="ico" viewBox="0 0 24 24" aria-hidden>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
        <path d="M12 8v4l3 2" />
      </svg>
    );
  }
  if (name === "bell") {
    return (
      <svg className="ico" viewBox="0 0 24 24" aria-hidden>
        <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z" />
        <path d="M10.5 20a2 2 0 0 0 3 0" />
      </svg>
    );
  }
  if (name === "audit") {
    return (
      <svg className="ico" viewBox="0 0 24 24" aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    );
  }
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5" />
      <path d="M17.5 14.5A5 5 0 0 1 21 20" />
    </svg>
  );
}
