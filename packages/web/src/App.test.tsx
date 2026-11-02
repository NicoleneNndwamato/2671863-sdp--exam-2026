import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { fetchResearcher, fetchTopology, verifyResearcher } from "./api";

jest.mock("./api", () => ({
  fetchAlerts: jest.fn().mockResolvedValue([]),
  fetchLatest: jest.fn().mockResolvedValue([]),
  fetchReadings: jest.fn().mockResolvedValue({ service: "rta", from: "", to: "", count: 0, readings: [] }),
  fetchStats: jest.fn().mockResolvedValue({
    at: new Date().toISOString(),
    ingest: { queued: 0, dropped: 0, written: 0 },
    services: []
  }),
  fetchTopology: jest.fn().mockResolvedValue(undefined),
  fetchTargets: jest.fn().mockResolvedValue([]),
  fetchAudit: jest.fn().mockResolvedValue([]),
  fetchResearcher: jest.fn(),
  verifyResearcher: jest.fn(),
  fetchAlertLimits: jest.fn().mockResolvedValue([]),
  fetchServices: jest.fn().mockResolvedValue([]),
  acknowledgeAlert: jest.fn(),
  resolveAlert: jest.fn(),
  sendControl: jest.fn()
}));

const validResearcher = {
  code: "arl-as3",
  name: "Person A",
  experiments: ["rta", "mhe", "lwm", "pes"],
  status: "active"
};

/** Just enough topology to render one real button in the array control panel. */
const rtaTopology = {
  v: 1,
  service: "rta",
  version: "test",
  updatedAt: new Date().toISOString(),
  entities: [
    { id: "dish-001", kind: "dish" },
    { id: "main", kind: "subarray" }
  ],
  streams: [],
  controls: [
    { topic: "arl/rta/cmd/+/start_scan", entity_kinds: ["subarray"], value: { type: "bool" } },
    { topic: "arl/rta/cmd/+/enable_dish", entity_kinds: ["dish"], value: { type: "bool" } }
  ]
};

beforeEach(() => {
  window.sessionStorage.clear();
  (fetchResearcher as jest.Mock).mockResolvedValue(validResearcher);
  (verifyResearcher as jest.Mock).mockResolvedValue({ valid: true, reason: null });
});

describe("App shell", () => {
  it("keeps the annunciator visible and leaves the transport off the live dashboard", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Radio Telescope" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Services" })).toBeInTheDocument();
    expect(screen.getByLabelText("Alert annunciator")).toBeInTheDocument();
    // The transport belongs to the replay page, not to the live console.
    expect(screen.queryByLabelText("Replay transport")).not.toBeInTheDocument();

    expect(await screen.findByText("No alerts.")).toBeInTheDocument();
  });

  it("switches the active service panel", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Local Weather" }));

    expect(screen.getByRole("heading", { name: "Local Weather" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Local Weather" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens controls only after the ARL API verifies the researcher code", async () => {
    const user = userEvent.setup();
    render(<App />);

    // Reading is open to everyone; the header says so.
    expect(screen.getByLabelText("Researcher session")).toHaveTextContent("Not verified");

    await user.click(screen.getByRole("button", { name: "Enter Code" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Researcher code"), "arl-as3");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(fetchResearcher).toHaveBeenCalledWith("arl-as3"));
    await waitFor(() => expect(verifyResearcher).toHaveBeenCalledWith("arl-as3", "rta"));

    expect(await screen.findByText("Person A")).toBeInTheDocument();
    expect(screen.getByLabelText("Researcher session")).toHaveTextContent("arl-as3");
    // The session survives a refresh inside the tab, and dies with the tab.
    expect(window.sessionStorage.getItem("meridian.researcher")).toContain("arl-as3");
  });

  it("asks for a code when a control is pressed, instead of disabling it", async () => {
    const user = userEvent.setup();
    (fetchTopology as jest.Mock).mockResolvedValue(rtaTopology);
    render(<App />);

    // Signed out, the button is still pressable: pressing it is what triggers
    // the gate. A disabled button would hide the requirement.
    const control = await screen.findByRole("button", { name: "Start scan" });
    expect(control).toBeEnabled();
    await user.click(control);

    expect(screen.getByRole("dialog")).toHaveTextContent("Researcher code required");
  });

  it("accepts a real code but refuses its action on an unassigned service", async () => {
    const user = userEvent.setup();
    (verifyResearcher as jest.Mock).mockResolvedValue({ valid: false, reason: "not_permitted" });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Power Generation" }));
    await user.click(screen.getByRole("button", { name: "Enter Code" }));
    await user.type(screen.getByLabelText("Researcher code"), "arl-as3");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    // The code is genuine, so the person is identified...
    expect(await screen.findByText("Person A")).toBeInTheDocument();
    expect(screen.getByLabelText("Researcher session")).toHaveTextContent("arl-as3");
    // ...and the service is marked as read-only for them, naming the reason.
    expect(screen.getByTitle("Person A is not assigned to Power Generation")).toBeInTheDocument();
  });

  it("refuses a code the ARL API does not know", async () => {
    const user = userEvent.setup();
    (fetchResearcher as jest.Mock).mockRejectedValue(Object.assign(new Error("unknown_researcher"), { status: 404 }));
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Enter Code" }));
    await user.type(screen.getByLabelText("Researcher code"), "arl-nope");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("does not know that researcher code");
    expect(screen.getByLabelText("Researcher session")).toHaveTextContent("Not verified");
  });

  it("signs out and forgets the code", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Enter Code" }));
    await user.type(screen.getByLabelText("Researcher code"), "arl-as3");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await screen.findByText("Person A");

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByLabelText("Researcher session")).toHaveTextContent("Not verified");
    expect(window.sessionStorage.getItem("meridian.researcher")).toBeNull();
  });
});
