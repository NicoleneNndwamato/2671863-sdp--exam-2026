/**
 * Alert limits come from `GET /v1/alert-limits/{service}`. These tests pin the
 * three promises limits.ts makes: the API's values win, the API is asked at
 * most once per five minutes per service, and an outage never leaves the
 * engine without thresholds.
 */
type LimitsModule = typeof import("../src/alerts/limits");

let limits: LimitsModule;
let fetchMock: jest.Mock;
const realFetch = global.fetch;

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

// The live API's shape, trimmed to the rows these tests care about.
const rtaRows = [
  { key: "dish_temperature.warn_k", value: 330, unit: "K" },
  { key: "dish_temperature.crit_k", value: 340, unit: "K" },
  { key: "scan.min_snr_db", value: 3, unit: "dB" }
];

beforeEach(() => {
  jest.resetModules();
  // A Response body can only be read once, so build a fresh one per call.
  fetchMock = jest.fn(async () => answer(200, rtaRows));
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  limits = require("../src/alerts/limits");
});

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe("getAlertLimits", () => {
  it("maps the API rows to a key -> value map", async () => {
    const map = await limits.getAlertLimits("rta");

    expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:8080/v1/alert-limits/rta");
    expect(Object.fromEntries(map)).toEqual({
      "dish_temperature.warn_k": 330,
      "dish_temperature.crit_k": 340,
      "scan.min_snr_db": 3
    });
  });

  it("skips rows without a string key and numeric value", async () => {
    fetchMock.mockResolvedValue(
      answer(200, [{ key: "ok.k", value: 1 }, { key: 9, value: 2 }, { key: "bad.k", value: "3" }, {}])
    );
    const map = await limits.getAlertLimits("lwm");
    expect([...map.keys()]).toEqual(["ok.k"]);
  });

  it("serves the cached values for five minutes", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(10_000_000);
    await limits.getAlertLimits("rta");
    now.mockReturnValue(10_000_000 + 4 * 60_000);
    await limits.getAlertLimits("rta");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now.mockReturnValue(10_000_000 + 6 * 60_000);
    await limits.getAlertLimits("rta");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("collapses a burst of concurrent lookups into one request", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => limits.getAlertLimits("rta")));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
  });

  it("caches per service", async () => {
    await limits.getAlertLimits("rta");
    await limits.getAlertLimits("opg");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the baked-in limits when the API has never answered", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const map = await limits.getAlertLimits("rta");

    expect(map.get("dish_temperature.crit_k")).toBe(343);
    expect(map.get("wind_stow.gust_ms")).toBe(15);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("alert limits for rta unavailable"));
  });

  it.each([
    ["an HTTP error", () => answer(500, { error: "internal" })],
    ["an empty list", () => answer(200, [])]
  ])("treats %s as unavailable", async (_label, response) => {
    fetchMock.mockResolvedValue(response());
    const map = await limits.getAlertLimits("lwm");
    expect(map.get("high_wind.crit_ms")).toBe(20);
  });

  it("keeps serving the last good values through an outage", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(20_000_000);
    await limits.getAlertLimits("rta");

    now.mockReturnValue(20_000_000 + 10 * 60_000);
    fetchMock.mockRejectedValue(new Error("timeout"));
    const map = await limits.getAlertLimits("rta");

    // 340 is what the API said; the fallback would have been 343.
    expect(map.get("dish_temperature.crit_k")).toBe(340);
  });

  it("returns an empty map for a service it has no defaults for", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    await expect(limits.getAlertLimits("xrt")).resolves.toEqual(new Map());
  });

  it("URL-encodes the service id", async () => {
    await limits.getAlertLimits("a b");
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:8080/v1/alert-limits/a%20b");
  });
});

describe("prefetchAlertLimits", () => {
  it("warms every service so the first message is evaluated against real limits", async () => {
    await limits.prefetchAlertLimits(["rta", "lwm", "opg"]);
    expect(fetchMock.mock.calls.map((c) => String(c[0]).split("/").pop())).toEqual(["rta", "lwm", "opg"]);

    await limits.getAlertLimits("lwm");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
