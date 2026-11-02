import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AlertView, AuditEntry, Reading, ServiceTopology } from "@sdp/shared";
import { App } from "../App";
import { ThemeProvider } from "../theme-provider";
import {
  acknowledgeAlert,
  fetchAlerts,
  fetchAudit,
  fetchLatest,
  fetchReadings,
  fetchResearcher,
  fetchTopology,
  resolveAlert,
  verifyResearcher
} from "../api";

/**
 * One test per page.
 *
 * The shell is exercised elsewhere; this file walks the navigation and checks
 * that every destination renders the thing it promises, with data flowing in
 * from the mocked API. A page that silently renders "no data" for the wrong
 * service would pass a smoke test, so each assertion looks for content that
 * can only come from that page's own topics.
 */

jest.mock("../api", () => ({
  fetchServices: jest.fn().mockResolvedValue([]),
  fetchTopology: jest.fn(),
  fetchLatest: jest.fn(),
  fetchReadings: jest.fn(),
  fetchAlerts: jest.fn(),
  fetchAudit: jest.fn(),
  fetchAlertLimits: jest.fn().mockResolvedValue([]),
  fetchStats: jest.fn().mockResolvedValue({ at: "2026-11-02T12:00:00Z", ingest: { queued: 0, dropped: 0, written: 42 }, services: [] }),
  fetchTargets: jest.fn().mockResolvedValue([]),
  fetchScans: jest.fn().mockResolvedValue([]),
  fetchScanImage: jest.fn(),
  fetchResearcher: jest.fn(),
  verifyResearcher: jest.fn(),
  acknowledgeAlert: jest.fn().mockResolvedValue(undefined),
  resolveAlert: jest.fn().mockResolvedValue(undefined),
  sendControl: jest.fn().mockResolvedValue(undefined)
}));

const at = "2026-11-02T12:00:00.000Z";

function item(topic: string, payload: Record<string, unknown>) {
  return { topic, device: topic.split("/")[2], observedAt: at, payload };
}

function reading(topic: string, payload: Record<string, unknown>, offset = 0): Reading {
  const observedAt = new Date(Date.parse(at) - offset * 1000).toISOString();
  return { service: topic.split("/")[1], device: topic.split("/")[2], topic, observedAt, receivedAt: observedAt, payload };
}

const rtaTopology = {
  v: 1,
  service: "rta",
  version: "test",
  updatedAt: at,
  entities: [
    { id: "dish-001", kind: "dish", row: 0, col: 0 },
    { id: "dish-002", kind: "dish", row: 0, col: 1 },
    { id: "dish-003", kind: "dish", row: 1, col: 0 },
    { id: "main", kind: "subarray" }
  ],
  streams: [],
  state: [{ topic: "arl/rta/main/state/scan_state", type: "string" }],
  controls: [
    { topic: "arl/rta/cmd/+/start_scan", entity_kinds: ["subarray"], value: { type: "bool" } },
    { topic: "arl/rta/cmd/+/enable_dish", entity_kinds: ["dish"], value: { type: "bool" } },
    { topic: "arl/rta/cmd/+/adjust_azimuth", entity_kinds: ["dish"], value: { type: "number", min: 0, max: 360 } }
  ]
} as unknown as ServiceTopology;

const lwmTopology = { v: 1, service: "lwm", version: "test", updatedAt: at, entities: [], streams: [] } as unknown as ServiceTopology;
const opgTopology = { v: 1, service: "opg", version: "test", updatedAt: at, entities: [], streams: [] } as unknown as ServiceTopology;

const latest: Record<string, ReturnType<typeof item>[]> = {
  rta: [
    item("arl/rta/global/state/active_dishes", { value: 82 }),
    item("arl/rta/global/state/wind_stow", { value: false }),
    item("arl/rta/main/state/scan_state", { value: "complete" }),
    item("arl/rta/main/state/scan_id", { value: "scan-0003" }),
    item("arl/rta/dish-001/telemetry/normal", { temperature_k: 295.1 }),
    item("arl/rta/dish-001/telemetry/scan", { snr_db: 12.4 }),
    item("arl/rta/dish-001/state/enabled", { value: true }),
    item("arl/rta/dish-002/telemetry/normal", { temperature_k: 301.2 }),
    item("arl/rta/dish-002/state/enabled", { value: true }),
    item("arl/rta/dish-003/telemetry/normal", { temperature_k: 288.4 }),
    item("arl/rta/dish-003/state/enabled", { value: false }),
    item("arl/rta/dish-003/telemetry/fault", { fault: "drive_overheat" })
  ],
  lwm: [
    item("arl/lwm/lwm-1/telemetry/weather", {
      temperature_k: 296.05,
      humidity_pct: 30,
      pressure_hpa: 877,
      wind_speed_ms: 6.9,
      wind_gust_ms: 12.1,
      wind_direction_rad: Math.PI / 2,
      rainfall_mm: 0,
      battery_v: 13.05,
      irradiance_wm2: 810,
      status: true
    }),
    item("arl/lwm/lwm-1/state/position", { value: { lat: -30.9667, lon: 22.1167 } }),
    item("arl/lwm/lwm-3/telemetry/weather", {
      temperature_k: 296.4,
      humidity_pct: 28,
      wind_speed_ms: 7.4,
      wind_gust_ms: 11.2,
      wind_direction_rad: 1.2,
      status: true
    }),
    item("arl/lwm/lwm-3/state/position", { value: { lat: -30.968, lon: 22.12 } }),
    item("arl/lwm/lwm-3/telemetry/sonic", { gust_factor: 1.6, turbulence_intensity: 0.18, wind_u_ms: 3.1, wind_v_ms: 6.4 }),
    item("arl/lwm/lwm-4/telemetry/soiling", { reference_irradiance_wm2: 820, exposed_irradiance_wm2: 780, soiling_ratio: 0.95 }),
    item("arl/lwm/lwm-5/telemetry/pan", { pan_level_mm: 42.6, evaporation_mm: 3.1 }),
    item("arl/lwm/global/telemetry/lightning", { lightning_strikes: 0, distance_km: null })
  ],
  opg: [
    item("arl/opg/global/telemetry/power", { total_generation_w: 265_400, total_load_w: 184_500, supply_mode: "solar" }),
    item("arl/opg/global/state/generation_priority", { value: "solar_first" }),
    item("arl/opg/solar/telemetry/power", { power_output_w: 265_400, irradiance_wm2: 810, panel_temperature_k: 315.2, inverter_status: "online" }),
    item("arl/opg/batteries/telemetry/power", { state_of_charge_pct: 85.4, battery_power_w: 80_900, battery_temperature_k: 298.1, battery_health_pct: 92 }),
    item("arl/opg/batteries/state/reserve_pct", { value: 20 }),
    item("arl/opg/diesel/telemetry/power", { fuel_level_pct: 80, power_output_w: 0, generator_status: "off", runtime_h: 1716.9 })
  ]
};

const alerts: AlertView[] = [
  {
    id: "a1",
    service: "rta",
    device: "dish-003",
    code: "drive.overheat",
    severity: "critical",
    status: "raised",
    cause: "Drive temperature above 70 °C",
    raisedAt: at,
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolution: null
  } as AlertView
];

const audit: AuditEntry[] = [
  {
    topic: "arl/rta/cmd/dish-003/enable_dish",
    id: 1,
    at,
    actor: "arl-as3",
    action: "control.rejected",
    service: "rta",
    entity: "dish-003",
    result: "rejected",
    detail: "not permitted",
    value: { control: "enable_dish", value: true }
  },
  { id: 2, at, actor: "Person A", action: "alert.raised", service: "lwm", entity: null, result: "raised", detail: null, topic: null, value: null },
  {
    id: 3,
    at,
    actor: "Person A",
    action: "control.applied",
    service: "opg",
    entity: "batteries",
    result: "ok",
    detail: "load_shed=true",
    topic: null,
    value: null
  }
];

const researcher = { code: "arl-as3", name: "Person A", experiments: ["rta", "lwm", "opg"], status: "active" };

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();

  (fetchTopology as jest.Mock).mockImplementation((service: string) =>
    Promise.resolve(service === "rta" ? rtaTopology : service === "lwm" ? lwmTopology : opgTopology)
  );
  (fetchLatest as jest.Mock).mockImplementation((service: string) => Promise.resolve(latest[service] ?? []));
  (fetchReadings as jest.Mock).mockResolvedValue({
    service: "rta",
    from: "",
    to: "",
    count: 2,
    readings: [
      reading("arl/rta/dish-001/telemetry/normal", { temperature_k: 295 }, 60),
      reading("arl/rta/dish-001/telemetry/normal", { temperature_k: 295.4 }, 0)
    ]
  });
  (fetchAlerts as jest.Mock).mockResolvedValue(alerts);
  (fetchAudit as jest.Mock).mockResolvedValue(audit);
  (fetchResearcher as jest.Mock).mockResolvedValue(researcher);
  (verifyResearcher as jest.Mock).mockResolvedValue({ valid: true, reason: null });
});

async function open(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name }));
}

describe("every page renders its own data", () => {
  it("Radio Telescope: array state, heatmap and dish detail", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );

    expect(screen.getByRole("heading", { name: "Radio Telescope" })).toBeInTheDocument();
    expect(await screen.findByText("Active dishes")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Dish array" })).toBeInTheDocument();

    // Selecting a dish opens its detail panel, which is the point of the grid.
    await user.click(screen.getByRole("button", { name: /dish-002/ }));
    expect(await screen.findByRole("heading", { name: "Dish 002" })).toBeInTheDocument();
  });

  it("Local Weather: wind rose, site map and the per-site comparison", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    await open(user, "Local Weather");

    expect(screen.getByRole("heading", { name: "Local Weather" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Site map" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Site conditions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Temperature by site" })).toBeInTheDocument();
    // lwm-3 carries the sonic anemometer, so picking it reveals that panel.
    await user.click(screen.getByRole("button", { name: /lwm-3/ }));
    expect(await screen.findByText(/turbulence/i)).toBeInTheDocument();
  });

  it("Power Generation: energy flow, sources and storage", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    await open(user, "Power Generation");

    expect(screen.getByRole("heading", { name: "Power Generation" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Energy flow" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Output by source" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Storage & supply" })).toBeInTheDocument();
    expect(screen.getAllByText("Battery").length).toBeGreaterThan(0);
  });

  it("Replay: loads a window, shows the transport, and returns to live", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    await open(user, "Replay");

    expect(screen.getByRole("heading", { name: "Replay a captured window" })).toBeInTheDocument();
    // No transport until a window is loaded: that rail belongs to this page.
    expect(screen.queryByLabelText("Replay transport")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Play/Load window" }));

    await waitFor(() => expect(fetchReadings).toHaveBeenCalled());
    expect(await screen.findByLabelText("Replay transport")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Replay timeline" })).toBeInTheDocument();
    expect(screen.getByText("Captured rows")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Live" }));
    await waitFor(() => expect(screen.queryByLabelText("Replay transport")).not.toBeInTheDocument());
  });

  it("Annunciator: acknowledges and resolves an alert with a code on file", async () => {
    window.sessionStorage.setItem("meridian.researcher", JSON.stringify(researcher));
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    await open(user, "Annunciator");

    // Re-query the main column on every use: React replaces the subtree as the
    // route changes, so a cached element goes stale.
    const page = () => within(screen.getByRole("main"));
    expect(page().getByRole("heading", { name: "Alerts" })).toBeInTheDocument();
    expect(await page().findByText("Drive temperature above 70 °C")).toBeInTheDocument();

    await user.click(page().getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(acknowledgeAlert).toHaveBeenCalledWith("a1", "arl-as3"));

    (fetchAlerts as jest.Mock).mockResolvedValue([{ ...alerts[0], status: "acknowledged" }]);
    await user.click(page().getByRole("button", { name: "Refresh" }));
    await user.click(await page().findByRole("button", { name: "Resolve" }));
    await user.type(page().getByLabelText("Resolution note"), "replaced the drive sensor");
    await user.click(page().getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(resolveAlert).toHaveBeenCalledWith("a1", "arl-as3", "replaced the drive sensor"));
  });

  it("Audit log: a ruled table of who did what", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    await open(user, "Audit log");

    expect(screen.getAllByRole("heading", { name: "Audit log" }).length).toBeGreaterThan(0);
    const table = await screen.findByRole("table", { name: "Audited actions, newest first" });
    expect(table).toHaveClass("audit-table");
    for (const column of ["When", "Actor", "Action", "Service", "Entity", "Result", "Detail"]) {
      expect(within(table).getByRole("columnheader", { name: column })).toBeInTheDocument();
    }
    expect(await within(table).findByText("control.rejected")).toBeInTheDocument();
    expect(within(table).getByText("arl-as3")).toBeInTheDocument();
  });

  it("Active researchers: says who is verified and checks a code against the API", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    await open(user, "Active researchers");

    expect(screen.getByRole("heading", { name: "Verified in this tab" })).toBeInTheDocument();
    expect(screen.getByText(/No code verified/)).toBeInTheDocument();

    const input = screen.getByLabelText(/Researcher code/);
    await user.clear(input);
    await user.type(input, "arl-as3");
    await user.click(screen.getByRole("button", { name: "Look up" }));

    expect(await screen.findByText("Person A")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "verify rta" }));
    expect(await screen.findByText("rta: allowed")).toBeInTheDocument();
  });
});

describe("page filters and failure paths", () => {
  it("Annunciator: filters by lifecycle state, and says when nothing matches", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    await open(user, "Annunciator");
    // Re-query the main column on every use: React replaces the subtree as the
    // route changes, so a cached element goes stale.
    const page = () => within(screen.getByRole("main"));

    await user.click(page().getByRole("button", { name: "Raised" }));
    expect(await page().findByText("Drive temperature above 70 °C")).toBeInTheDocument();

    await user.click(page().getByRole("button", { name: "Resolved" }));
    expect(await page().findByText("Nothing matches this filter.")).toBeInTheDocument();

    await user.click(page().getByRole("button", { name: "All" }));
    expect(await page().findByText("Drive temperature above 70 °C")).toBeInTheDocument();

    // The shell pins the service filter to "all" - this page is the whole lab -
    // so the per-service buttons here do not narrow anything.
    await user.click(page().getByRole("button", { name: "OPG" }));
    expect(await page().findByText("Drive temperature above 70 °C")).toBeInTheDocument();

    await user.click(page().getByRole("button", { name: "All services" }));
    await user.click(page().getByRole("button", { name: "Open" }));
    expect(await page().findByText("Drive temperature above 70 °C")).toBeInTheDocument();
  });

  it("Active researchers: reports a code the API does not know, then hands a good one to the gate", async () => {
    const user = userEvent.setup();
    (fetchResearcher as jest.Mock).mockRejectedValue(new Error("unknown_researcher"));
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    await open(user, "Active researchers");

    const input = screen.getByLabelText(/Researcher code/);
    await user.clear(input);
    await user.type(input, "arl-nope");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText("No researcher with code arl-nope.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use code" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Researcher code required");
    expect(screen.getByLabelText("Researcher code")).toHaveValue("arl-nope");
  });

  it("Audit log: survives a failed fetch and offers the per-service filter", async () => {
    const user = userEvent.setup();
    (fetchAudit as jest.Mock).mockRejectedValue(new Error("audit unavailable"));
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    await open(user, "Audit log");

    expect(await screen.findByText("Could not load the audit log: audit unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "LWM" }));
    await waitFor(() => expect(fetchAudit).toHaveBeenLastCalledWith({ service: "lwm", limit: 300 }));
  });
});

describe("researcher states", () => {
  it("labels a defunct code and reports a verify call that fails", async () => {
    window.sessionStorage.setItem(
      "meridian.researcher",
      JSON.stringify({ code: "arl-old", name: "Person B", experiments: ["rta"], status: "defunct" })
    );
    const user = userEvent.setup();
    (verifyResearcher as jest.Mock).mockRejectedValue(new Error("ARL API unreachable"));
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    await open(user, "Active researchers");

    expect(screen.getByText("defunct")).toBeInTheDocument();
    expect(screen.getByText("RTA: read-only")).toBeInTheDocument();

    const input = screen.getByLabelText(/Researcher code/);
    await user.clear(input);
    await user.type(input, "arl-as3");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    await user.click(await screen.findByRole("button", { name: "verify lwm" }));
    expect(await screen.findByText("ARL API unreachable")).toBeInTheDocument();
  });
});

describe("shell controls", () => {
  it("switches the whole console to dark and remembers it", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );

    await user.click(screen.getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(window.localStorage.getItem("meridian.theme")).toBe("dark");

    await user.click(screen.getByRole("button", { name: "Light" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  });

  it("keeps the annunciator beside every page", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );

    for (const page of ["Local Weather", "Power Generation", "Replay", "Annunciator", "Audit log", "Active researchers"]) {
      await open(user, page);
      expect(screen.getByLabelText("Alert annunciator")).toBeInTheDocument();
    }
  });

  it("shows the broker and message counters from the first poll", async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    expect((await screen.findAllByText("42")).length).toBeGreaterThan(0);
    expect(screen.getByText("broker")).toBeInTheDocument();
  });
});
