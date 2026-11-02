import {
  acknowledgeAlert,
  fetchAlertLimits,
  fetchAlerts,
  fetchAudit,
  fetchLatest,
  fetchReadings,
  fetchResearcher,
  fetchServices,
  fetchStats,
  fetchTargets,
  fetchTopology,
  resolveAlert,
  sendControl,
  verifyResearcher
} from "./api";

/**
 * The API client is the only place that talks to the network, so its contract
 * is worth pinning: the exact path, the query string, the header that carries
 * the researcher code, and what happens when the API says no.
 */

function reply(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

/** The path and init of the nth call. */
function call(index = 0) {
  const [path, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return { path, init };
}

describe("api client", () => {
  it("reads discovery endpoints", async () => {
    fetchMock.mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply({})).mockResolvedValueOnce(reply({ latest: [] }));

    await fetchServices();
    await fetchTopology("rta");
    await fetchLatest("lwm");

    expect(call(0).path).toBe("/api/services");
    expect(call(1).path).toBe("/api/services/rta/topology");
    expect(call(2).path).toBe("/api/services/lwm/latest");
  });

  it("narrows the latest feed by kind when asked", async () => {
    fetchMock.mockResolvedValue(reply({ latest: [] }));
    await fetchLatest("rta", "state");
    expect(call().path).toBe("/api/services/rta/latest?kind=state");
  });

  it("builds the readings window query from every option", async () => {
    fetchMock.mockResolvedValue(reply({ service: "rta", from: "", to: "", count: 0, readings: [] }));
    await fetchReadings("rta", "2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z", {
      device: "dish-001",
      kind: "telemetry",
      limit: 500
    });
    const { path } = call();
    expect(path).toContain("/api/services/rta/readings?");
    expect(path).toContain("device=dish-001");
    expect(path).toContain("kind=telemetry");
    expect(path).toContain("limit=500");
  });

  it("omits the query entirely when there is nothing to filter on", async () => {
    fetchMock.mockResolvedValue(reply({ service: "rta", from: "", to: "", count: 0, readings: [] }));
    await fetchReadings("rta", "a", "b");
    expect(call().path).toBe("/api/services/rta/readings?from=a&to=b");
  });

  it("unwraps the alert envelope and passes filters through", async () => {
    fetchMock.mockResolvedValue(reply({ alerts: [{ id: "a1" }] }));
    const rows = await fetchAlerts({ status: "open", service: "rta", limit: 10 });
    expect(rows).toEqual([{ id: "a1" }]);
    const { path } = call();
    expect(path).toContain("status=open");
    expect(path).toContain("service=rta");
    expect(path).toContain("limit=10");
  });

  it("calls the alerts endpoint bare when no filters are given", async () => {
    fetchMock.mockResolvedValue(reply({ alerts: [] }));
    await fetchAlerts();
    expect(call().path).toBe("/api/alerts");
  });

  it("sends the researcher code as a header on mutations", async () => {
    fetchMock.mockResolvedValue(reply({ id: "a1" }));

    await acknowledgeAlert("a1", "arl-as3");
    expect(call(0).path).toBe("/api/alerts/a1/acknowledge");
    expect(call(0).init.method).toBe("POST");
    expect((call(0).init.headers as Record<string, string>)["x-researcher-code"]).toBe("arl-as3");

    await resolveAlert("a1", "arl-as3", "replaced sensor");
    expect(call(1).path).toBe("/api/alerts/a1/resolve");
    expect(JSON.parse(String(call(1).init.body))).toEqual({ resolution: "replaced sensor" });

    await sendControl("rta", "arl-as3", "dish-001", "stow_dish", true);
    expect(call(2).path).toBe("/api/services/rta/control");
    expect(JSON.parse(String(call(2).init.body))).toEqual({
      entity: "dish-001",
      control: "stow_dish",
      value: true
    });
  });

  it("unwraps audit, limits, stats and targets", async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ entries: [{ id: 1 }] }))
      .mockResolvedValueOnce(reply({ limits: [{ key: "x", value: 1 }] }))
      .mockResolvedValueOnce(reply({ at: "now", ingest: { queued: 0, dropped: 0, written: 0 }, services: [] }))
      .mockResolvedValueOnce(reply({ targets: [{ id: "s1" }] }));

    expect(await fetchAudit({ service: "opg", limit: 5 })).toEqual([{ id: 1 }]);
    expect(call(0).path).toContain("/api/audit?");
    expect(await fetchAlertLimits("rta")).toEqual([{ key: "x", value: 1 }]);
    expect(call(1).path).toBe("/api/alert-limits/rta");
    expect((await fetchStats()).at).toBe("now");
    expect(call(2).path).toBe("/api/stats");
    expect(await fetchTargets()).toEqual([{ id: "s1" }]);
    expect(call(3).path).toBe("/api/targets");
  });

  it("leaves the audit query off when unfiltered", async () => {
    fetchMock.mockResolvedValue(reply({ entries: [] }));
    await fetchAudit();
    expect(call().path).toBe("/api/audit");
  });

  it("escapes a researcher code into the path", async () => {
    fetchMock.mockResolvedValue(reply({ code: "arl as3" }));
    await fetchResearcher("arl as3");
    expect(call().path).toBe("/api/researchers/arl%20as3");
  });

  it("posts the verify question with code and service", async () => {
    fetchMock.mockResolvedValue(reply({ valid: true }));
    expect(await verifyResearcher("arl-as3", "rta")).toEqual({ valid: true });
    expect(call().init.method).toBe("POST");
    expect(JSON.parse(String(call().init.body))).toEqual({ code: "arl-as3", service: "rta" });
  });

  it("surfaces the API's own message and status on failure", async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: "unknown researcher" }, false, 404));
    await expect(fetchResearcher("nope")).rejects.toMatchObject({
      message: "unknown researcher",
      status: 404
    });

    // `detail` wins over `error`, and `message` is the last resort.
    fetchMock.mockResolvedValueOnce(reply({ detail: "detail wins", error: "ignored" }, false, 400));
    await expect(fetchServices()).rejects.toMatchObject({ message: "detail wins", status: 400 });

    fetchMock.mockResolvedValueOnce(reply({ message: "server said no" }, false, 500));
    await expect(fetchServices()).rejects.toMatchObject({ message: "server said no", status: 500 });
  });

  it("falls back to the status text when the error body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error("not json"))
    } as unknown as Response);
    await expect(fetchServices()).rejects.toMatchObject({ message: "request failed (502)", status: 502 });
  });
});
