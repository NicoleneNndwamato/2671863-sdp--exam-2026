import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { AlertView, ServiceTopology } from "@sdp/shared";
import { ThemeProvider } from "../theme-provider";
import { BarChart, Compass, Gauge, LineChart, Meter, SiteMap, Sparkline, StackedBar } from "./charts";
import { AlertList } from "./AlertList";
import { CodeModal } from "./CodeModal";
import { ControlForm, ControlList, humanise } from "./ControlPanel";
import { PanelBoundary } from "./ErrorBoundary";
import { fetchResearcher, verifyResearcher } from "../api";
import { ReplayBar } from "./ReplayBar";
import { ResearcherCard } from "./ResearcherCard";
import { Badge, Btn, DetailRow, Dot, Empty, Field, Kpi, Panel, Select, TextInput, Toasts } from "./ui";

/**
 * Component tests. The palette is published by ThemeProvider, so everything is
 * rendered inside one - the same way the app mounts it.
 */

function wrap(node: ReactNode) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

jest.mock("../api", () => ({
  fetchResearcher: jest.fn(),
  verifyResearcher: jest.fn()
}));

const request = { service: "rta", label: "Stow dish-001" };

function alert(overrides: Partial<AlertView> = {}): AlertView {
  return {
    id: "a1",
    service: "rta",
    device: "dish-001",
    code: "dish.temperature.high",
    severity: "critical",
    status: "raised",
    cause: "Drive temperature above 70 °C",
    raisedAt: new Date().toISOString(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
    ...overrides
  } as AlertView;
}

describe("panel and tile primitives", () => {
  it("renders a titled panel with subtitle and actions", () => {
    wrap(
      <Panel title="Drive temperature" subtitle="colour = band" actions={<button>do</button>}>
        <p>body</p>
      </Panel>
    );
    expect(screen.getByRole("heading", { name: "Drive temperature" })).toBeInTheDocument();
    expect(screen.getByText("colour = band")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "do" })).toBeInTheDocument();
  });

  it("renders an untitled panel", () => {
    wrap(<Panel>bare</Panel>);
    expect(screen.getByText("bare")).toBeInTheDocument();
  });

  it("keeps the headline number, its unit and its hint together", () => {
    const { container } = wrap(<Kpi label="Active dishes" value="82" unit="/ 100" hint="from global/state" tone="ok" />);
    expect(screen.getByText("Active dishes")).toBeInTheDocument();
    expect(screen.getByText("/ 100")).toBeInTheDocument();
    expect(screen.getByText("from global/state")).toBeInTheDocument();
    expect(container.querySelector(".kpi")).not.toBeNull();
  });

  it("flags an alarm tile", () => {
    const { container } = wrap(<Kpi label="Faults" value="1" tone="crit" />);
    expect(container.querySelector(".kpi.alarm")).not.toBeNull();
  });

  it("styles buttons by variant and marks the active one", () => {
    const onClick = jest.fn();
    const { container } = wrap(
      <>
        <Btn onClick={onClick} variant="primary" active>
          Apply
        </Btn>
        <Btn disabled>Off</Btn>
        <Btn variant="ghost">×</Btn>
        <Btn variant="danger">Stow</Btn>
        <Btn variant="ok">Enable</Btn>
      </>
    );
    expect(container.querySelectorAll("button.btn")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Off" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders badges, dots, empties and detail rows", () => {
    wrap(
      <>
        <Badge tone="crit">critical</Badge>
        <Dot tone="warn" pulse />
        <Empty>No alerts.</Empty>
        <DetailRow label="Gust" value="12.1 m/s" />
      </>
    );
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText("No alerts.")).toBeInTheDocument();
    expect(screen.getByText("Gust")).toBeInTheDocument();
    expect(screen.getByText("12.1 m/s")).toBeInTheDocument();
  });

  it("wires inputs and selects to their handlers", async () => {
    const user = userEvent.setup();
    const onText = jest.fn();
    const onPick = jest.fn();
    wrap(
      <>
        <Field label="Azimuth" hint="degrees" htmlFor="az">
          <TextInput id="az" value="" onChange={onText} placeholder="0.0" />
        </Field>
        <Select
          id="mode"
          value="a"
          onChange={onPick}
          options={[
            { value: "a", label: "A" },
            { value: "b", label: "B" }
          ]}
        />
      </>
    );

    await user.type(screen.getByLabelText(/Azimuth/), "45");
    expect(onText).toHaveBeenCalled();
    expect(screen.getByText("degrees")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "b");
    expect(onPick).toHaveBeenCalledWith("b");
  });

  it("shows nothing when there are no toasts, and dismisses the ones there are", async () => {
    const user = userEvent.setup();
    const onDismiss = jest.fn();
    const { rerender, container } = wrap(<Toasts messages={[]} onDismiss={onDismiss} />);
    expect(container.querySelector('[role="status"]')).toBeNull();

    rerender(
      <ThemeProvider>
        <Toasts
          messages={[
            { id: 1, tone: "crit", title: "Control refused", detail: "not permitted" },
            { id: 2, tone: "ok", title: "Scan started" }
          ]}
          onDismiss={onDismiss}
        />
      </ThemeProvider>
    );
    expect(screen.getByText("Control refused")).toBeInTheDocument();
    expect(screen.getByText("not permitted")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Dismiss notification" })[0]);
    expect(onDismiss).toHaveBeenCalledWith(1);
  });
});

describe("charts", () => {
  const series = [
    { label: "dish-001", points: [{ x: 0, y: 1 }, { x: 1, y: 3 }] },
    { label: "dish-002", points: [{ x: 0, y: 2 }, { x: 1, y: 4 }], fill: true, dashed: true }
  ];

  it("draws a line chart with a legend and axis labels", () => {
    wrap(<LineChart series={series} unit="K" />);
    expect(screen.getByRole("img", { name: /Time series: dish-001, dish-002/ })).toBeInTheDocument();
    expect(screen.getByText("dish-002")).toBeInTheDocument();
  });

  it("says so when a chart has no data", () => {
    wrap(<LineChart series={[{ label: "empty", points: [] }]} emptyLabel="Nothing in this window." />);
    expect(screen.getByText("Nothing in this window.")).toBeInTheDocument();
  });

  it("clamps a meter and reports it to assistive tech", () => {
    wrap(<Meter value={85.4} label="State of charge" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "85");
    expect(screen.getByText("85%")).toBeInTheDocument();

    wrap(<Meter value={undefined} label="Battery" />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("colours bars by meaning before position", () => {
    const { container } = wrap(
      <BarChart
        data={[
          { label: "solar", value: 265.4 },
          { label: "diesel", value: undefined, tone: "crit" },
          { label: "load", value: 184.5, colour: "#123456" }
        ]}
        unit="kW"
      />
    );
    expect(screen.getByText("solar")).toBeInTheDocument();
    expect(screen.getByText("184.5")).toBeInTheDocument();
    expect(container.innerHTML).toContain("rgb(18, 52, 86)");
  });

  it("points a wind rose at the direction it is given", () => {
    wrap(<Compass directionRad={Math.PI / 2} spreadRad={0.4} />);
    expect(screen.getByRole("img", { name: /Wind from E, 90 degrees/ })).toBeInTheDocument();
  });

  it("renders a gauge with its value and label", () => {
    wrap(<Gauge value={12.4} min={0} max={25} unit="mm" label="Pan evaporation" digits={1} tone="warn" />);
    expect(screen.getByRole("img", { name: /Pan evaporation/i })).toBeInTheDocument();
    expect(screen.getByText("12.4")).toBeInTheDocument();
  });

  it("plots the weather sites and lets one be picked", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    wrap(
      <SiteMap
        sites={[
          { id: "lwm-1", lat: -26.1, lon: 28.0, online: true },
          { id: "lwm-2", lat: -26.2, lon: 28.1, online: false }
        ]}
        selected="lwm-1"
        onSelect={onSelect}
      />
    );
    await user.click(screen.getByRole("button", { name: "Select lwm-2" }));
    expect(onSelect).toHaveBeenCalledWith("lwm-2");
    expect(screen.getByText(/km|m$/)).toBeInTheDocument();
  });

  it("handles a map with no positions at all", () => {
    wrap(<SiteMap sites={[]} selected="" onSelect={jest.fn()} />);
    expect(screen.getByText("No positions published.")).toBeInTheDocument();
  });

  it("stacks the energy segments and rejects an empty flow", () => {
    wrap(
      <StackedBar
        segments={[
          { label: "Load", value: 184.5, colour: "#111111" },
          { label: "Charging", value: 80.9, colour: "#222222" }
        ]}
      />
    );
    expect(screen.getByRole("img", { name: /Load 184.5 kW/ })).toBeInTheDocument();
    expect(screen.getByText("Charging")).toBeInTheDocument();

    wrap(<StackedBar segments={[{ label: "Load", value: 0, colour: "#111111" }]} />);
    expect(screen.getByText("Nothing is flowing.")).toBeInTheDocument();
  });

  it("draws a sparkline only when there is a trend", () => {
    const { container, rerender } = wrap(<Sparkline values={[1, 2, 3]} />);
    expect(container.querySelector("svg")).not.toBeNull();
    rerender(
      <ThemeProvider>
        <Sparkline values={[1]} />
      </ThemeProvider>
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("ReplayBar", () => {
  const session = {
    service: "rta",
    from: "2026-11-02T10:00:00Z",
    to: "2026-11-02T11:00:00Z",
    cursor: Date.parse("2026-11-02T10:30:00Z"),
    speed: 1,
    playing: false,
    loading: false,
    error: null,
    readings: [
      { service: "rta", device: null, topic: "t", observedAt: "2026-11-02T10:00:00Z", receivedAt: "", payload: {} },
      { service: "rta", device: null, topic: "t", observedAt: "2026-11-02T11:00:00Z", receivedAt: "", payload: {} }
    ]
  };

  const props = {
    onTogglePlay: jest.fn(),
    onSeek: jest.fn(),
    onStep: jest.fn(),
    onSpeed: jest.fn(),
    onLive: jest.fn(),
    onOpenReplay: jest.fn()
  };

  it("is a live indicator with a way into replay when no window is loaded", async () => {
    const user = userEvent.setup();
    wrap(<ReplayBar session={null} {...props} />);
    expect(screen.getByText(/last 30 min captured/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open replay" }));
    expect(props.onOpenReplay).toHaveBeenCalled();
  });

  it("becomes a transport during replay", async () => {
    const user = userEvent.setup();
    wrap(<ReplayBar session={session} {...props} />);
    expect(screen.getByRole("slider", { name: "Replay timeline" })).toBeInTheDocument();

    await user.click(screen.getByTitle("Play"));
    expect(props.onTogglePlay).toHaveBeenCalled();
    await user.click(screen.getByTitle("Step back one minute"));
    expect(props.onStep).toHaveBeenCalledWith(-60);
    await user.click(screen.getByTitle("Jump forward 15 minutes"));
    expect(props.onStep).toHaveBeenCalledWith(900);
    await user.click(screen.getByRole("button", { name: "4×" }));
    expect(props.onSpeed).toHaveBeenCalledWith(4);
    await user.click(screen.getByRole("button", { name: "Live" }));
    expect(props.onLive).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Exit" })).toBeInTheDocument();
  });
});

describe("AlertList", () => {
  it("invites the operator to acknowledge a raised alert", async () => {
    const user = userEvent.setup();
    const onAcknowledge = jest.fn();
    wrap(<AlertList alerts={[alert()]} onAcknowledge={onAcknowledge} onResolve={jest.fn()} canAct />);
    await user.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(onAcknowledge).toHaveBeenCalledWith("a1");
  });

  it("requires a note before resolving, then sends it", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    wrap(
      <AlertList
        alerts={[alert({ status: "acknowledged", acknowledgedBy: "Person A", acknowledgedAt: new Date().toISOString() })]}
        onAcknowledge={jest.fn()}
        onResolve={onResolve}
        canAct
      />
    );
    expect(screen.getByText(/acked .* by Person A/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resolve" }));
    expect(screen.getByRole("button", { name: "Resolve" })).toBeDisabled();
    await user.type(screen.getByLabelText("Resolution note"), "  replaced sensor ");
    await user.click(screen.getByRole("button", { name: "Resolve" }));
    expect(onResolve).toHaveBeenCalledWith("a1", "replaced sensor");
  });

  it("shows resolved alerts as history with no action", () => {
    wrap(
      <AlertList
        alerts={[
          alert({
            status: "resolved",
            resolvedBy: "Person A",
            resolvedAt: new Date().toISOString(),
            resolution: "replaced sensor"
          })
        ]}
        onAcknowledge={jest.fn()}
        onResolve={jest.fn()}
        canAct={false}
      />
    );
    expect(screen.getByText(/resolved .* — replaced sensor/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
  });

  it("renders the empty state", () => {
    wrap(
      <AlertList alerts={[]} onAcknowledge={jest.fn()} onResolve={jest.fn()} canAct={false} emptyLabel="All clear." />
    );
    expect(screen.getByText("All clear.")).toBeInTheDocument();
  });
});

describe("researcher card", () => {
  it("offers a code when nobody is verified", async () => {
    const user = userEvent.setup();
    const onAskCode = jest.fn();
    wrap(<ResearcherCard researcher={null} service="rta" onAskCode={onAskCode} onSignOut={jest.fn()} />);
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enter Code" }));
    expect(onAskCode).toHaveBeenCalled();
  });

  it("names the verified researcher and can clear them", async () => {
    const user = userEvent.setup();
    const onSignOut = jest.fn();
    wrap(
      <ResearcherCard
        researcher={{ code: "arl-as3", name: "Person A", experiments: ["rta"] }}
        service="rta"
        onAskCode={jest.fn()}
        onSignOut={onSignOut}
      />
    );
    expect(screen.getByText("Person A")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("marks a defunct code", () => {
    wrap(
      <ResearcherCard
        researcher={{ code: "arl-as3", status: "defunct" }}
        service="rta"
        onAskCode={jest.fn()}
        onSignOut={jest.fn()}
      />
    );
    expect(screen.getByText(/defunct/)).toBeInTheDocument();
  });
});

describe("ControlPanel", () => {
  const topology = {
    v: 1,
    service: "rta",
    version: "1",
    updatedAt: "2026-11-02T00:00:00Z",
    entities: [
      { id: "dish-001", kind: "dish", row: 0, col: 0 },
      { id: "subarray-1", kind: "subarray" }
    ],
    streams: [],
    controls: [
      { topic: "arl/rta/dish-001/+/adjust_azimuth", entity_kinds: ["dish"], value: { type: "number", min: 0, max: 360 } },
      { topic: "arl/rta/dish-001/+/enable_dish", entity_kinds: ["dish"], value: { type: "bool" } },
      { topic: "arl/rta/dish-001/+/stow_dish", entity_kinds: ["dish"], value: { type: "bool" } },
      { topic: "arl/rta/+/+/start_scan", entity_kinds: ["dish", "subarray"], value: { type: "bool" } },
      { topic: "arl/rta/subarray-1/+/point_at", entity_kinds: ["subarray"], value: { type: "enum", values: ["s1", "s2"] } },
      { topic: "arl/rta/subarray-1/+/set_power", entity_kinds: ["subarray"], value: { type: "float", unit: "W" } },
      { topic: "arl/rta/subarray-1/+/calibrate_at", entity_kinds: ["subarray"], value: { type: "timestamp" } }
    ]
  } as unknown as ServiceTopology;

  it("humanises control names", () => {
    expect(humanise("adjust_azimuth")).toBe("Adjust azimuth");
    expect(humanise("start_scan")).toBe("Start scan");
  });

  it("lists only the controls an entity kind may receive", () => {
    const { container } = wrap(
      <ControlList topology={topology} entity="dish-001" onSubmit={jest.fn()} currentValues={{ enable_dish: true }} />
    );
    expect(within(container).getByText("Adjust azimuth")).toBeInTheDocument();
    expect(within(container).getByRole("button", { name: "Start scan" })).toBeInTheDocument();
    expect(within(container).queryByText("Point at")).toBeNull();
  });

  it("says so when an entity advertises nothing", () => {
    wrap(<ControlList topology={null} entity="ghost" onSubmit={jest.fn()} />);
    expect(screen.getByText("No controls advertised for ghost.")).toBeInTheDocument();
  });

  it("sends a boolean toggle on and off", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    wrap(
      <ControlForm
        topology={topology}
        entity="dish-001"
        name="enable_dish"
        onSubmit={onSubmit}
        currentValue={true}
      />
    );
    await user.click(screen.getByRole("button", { name: "Off" }));
    expect(onSubmit).toHaveBeenCalledWith("enable_dish", false);
    await user.click(screen.getByRole("button", { name: "On" }));
    expect(onSubmit).toHaveBeenCalledWith("enable_dish", true);
  });

  it("sends a one-shot action", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    wrap(<ControlForm topology={topology} entity="dish-001" name="start_scan" onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Start scan" }));
    expect(onSubmit).toHaveBeenCalledWith("start_scan", true);
  });

  it("sends an enum selection", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    wrap(<ControlForm topology={topology} entity="subarray-1" name="point_at" onSubmit={onSubmit} />);
    await user.selectOptions(screen.getByRole("combobox"), "s2");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onSubmit).toHaveBeenCalledWith("point_at", "s2");
  });

  it("sends a typed number, converting it from the field", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    wrap(<ControlForm topology={topology} entity="subarray-1" name="set_power" onSubmit={onSubmit} />);
    const field = screen.getByRole("spinbutton");
    await user.clear(field);
    await user.type(field, "12.5");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onSubmit).toHaveBeenCalledWith("set_power", 12.5);
  });

  it("sends a timestamp as epoch milliseconds", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    wrap(<ControlForm topology={topology} entity="subarray-1" name="calibrate_at" onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onSubmit).toHaveBeenCalled();
    expect(typeof onSubmit.mock.calls[0][1]).toBe("number");
  });

  it("says when a control is not advertised", () => {
    wrap(<ControlForm topology={topology} entity="dish-001" name="self_destruct" onSubmit={jest.fn()} />);
    expect(screen.getByText("Self destruct is not advertised by this service.")).toBeInTheDocument();
  });
});

describe("panel boundary", () => {
  it("contains a failing panel instead of the whole console", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const Boom = () => {
      throw new Error("bad payload");
    };
    wrap(
      <PanelBoundary name="Weather">
        <Boom />
      </PanelBoundary>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Weather could not render: bad payload");
    spy.mockRestore();
  });
});

describe("code modal", () => {
  const profile = { code: "arl-as3", name: "Person A", experiments: ["rta"], status: "active" };

  beforeEach(() => {
    (fetchResearcher as jest.Mock).mockReset();
    (verifyResearcher as jest.Mock).mockReset();
  });

  it("verifies the code against the API for this service, then grants", async () => {
    const user = userEvent.setup();
    const onGranted = jest.fn();
    (fetchResearcher as jest.Mock).mockResolvedValue(profile);
    (verifyResearcher as jest.Mock).mockResolvedValue({ valid: true });

    wrap(<CodeModal request={request} onCancel={jest.fn()} onGranted={onGranted} />);
    expect(screen.getByText("Stow dish-001")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Researcher code"), "  arl-as3  ");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(onGranted).toHaveBeenCalledWith(profile));
    expect(fetchResearcher).toHaveBeenCalledWith("arl-as3");
    expect(verifyResearcher).toHaveBeenCalledWith("arl-as3", "rta");
  });

  it("insists on something being typed", async () => {
    const user = userEvent.setup();
    wrap(<CodeModal request={request} onCancel={jest.fn()} onGranted={jest.fn()} />);
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the code the ARL issued to you.");
    expect(fetchResearcher).not.toHaveBeenCalled();
  });

  it("reports an unknown code without pretending it is an auth failure", async () => {
    const user = userEvent.setup();
    (fetchResearcher as jest.Mock).mockRejectedValue(Object.assign(new Error("unknown"), { status: 404 }));
    wrap(<CodeModal request={request} onCancel={jest.fn()} onGranted={jest.fn()} />);

    await user.type(screen.getByLabelText("Researcher code"), "arl-nope");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("does not know that researcher code");
  });

  it("passes on any other API failure verbatim", async () => {
    const user = userEvent.setup();
    (fetchResearcher as jest.Mock).mockRejectedValue(new Error("request failed (503)"));
    wrap(<CodeModal request={request} onCancel={jest.fn()} onGranted={jest.fn()} />);

    await user.type(screen.getByLabelText("Researcher code"), "arl-as3");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("request failed (503)");
  });

  it("identifies a code that is not assigned here, but refuses the action", async () => {
    const user = userEvent.setup();
    const onGranted = jest.fn();
    (fetchResearcher as jest.Mock).mockResolvedValue(profile);
    (verifyResearcher as jest.Mock).mockResolvedValue({ valid: false, reason: "not_permitted" });

    wrap(<CodeModal request={request} onCancel={jest.fn()} onGranted={onGranted} />);
    await user.type(screen.getByLabelText("Researcher code"), "arl-as3");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(onGranted).toHaveBeenCalled());
    expect(onGranted.mock.calls[0][1]).toContain("RTA");
  });

  it("shows the refusal and the person's other experiments", async () => {
    const user = userEvent.setup();
    (fetchResearcher as jest.Mock).mockResolvedValue(profile);
    (verifyResearcher as jest.Mock).mockResolvedValue({ valid: false, reason: "defunct" });

    wrap(<CodeModal request={request} onCancel={jest.fn()} onGranted={jest.fn()} />);
    await user.type(screen.getByLabelText("Researcher code"), "arl-as3");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("marked defunct");
    expect(alert).toHaveTextContent("Person A is assigned to rta");
  });

  it("closes on Cancel and on Escape", async () => {
    const user = userEvent.setup();
    const onCancel = jest.fn();
    wrap(<CodeModal request={request} onCancel={onCancel} onGranted={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Both the document listener and the field handler fire, so count loosely.
    await user.type(screen.getByLabelText("Researcher code"), "{Escape}");
    expect(onCancel.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("closes when the backdrop itself is pressed, not the dialog", async () => {
    const user = userEvent.setup();
    const onCancel = jest.fn();
    const { container } = wrap(<CodeModal request={request} onCancel={onCancel} onGranted={jest.fn()} />);
    const backdrop = container.querySelector(".modal-back") as HTMLElement;

    await user.click(screen.getByRole("dialog"));
    expect(onCancel).not.toHaveBeenCalled();
    await user.click(backdrop);
    expect(onCancel).toHaveBeenCalled();
  });
});
