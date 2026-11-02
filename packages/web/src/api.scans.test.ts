import { fetchScanImage, fetchScans } from "./api";

const fetchMock = jest.fn();
const originalFetch = globalThis.fetch;
const to = "2026-11-02T12:03:04.567Z";

function reply(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("read-only RTA scan client", () => {
  it("unwraps recent scans and forwards cancellation without credentials", async () => {
    const scans = [{ scanId: "scan-0001", state: "running" }];
    const controller = new AbortController();
    fetchMock.mockResolvedValue(reply({ scans }));

    await expect(fetchScans(controller.signal)).resolves.toEqual(scans);
    expect(fetchMock).toHaveBeenCalledWith("/api/services/rta/scans", {
      method: "GET",
      signal: controller.signal,
      headers: { "content-type": "application/json" }
    });
  });

  it("requests only the selected scan at the exact encoded cutoff", async () => {
    const image = { scanId: "scan/one", pixels: [null, 0, 5, 10], coverage: 0.75 };
    const controller = new AbortController();
    fetchMock.mockResolvedValue(reply(image));

    await expect(fetchScanImage("scan/one", to, controller.signal)).resolves.toEqual(image);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(path, "http://localhost");
    expect(url.pathname).toBe("/api/services/rta/scans/scan%2Fone/image");
    expect(url.searchParams.get("to")).toBe(to);
    expect(init).toEqual({ method: "GET", signal: controller.signal, headers: { "content-type": "application/json" } });
    expect(init.body).toBeUndefined();
  });

  it("preserves image unavailability details for the panel", async () => {
    fetchMock.mockResolvedValue(reply({ error: "scan_unavailable", detail: "no field of view known" }, false, 404));
    await expect(fetchScanImage("scan-0001", to)).rejects.toMatchObject({
      message: "no field of view known",
      status: 404
    });
  });

  it("propagates aborted requests", async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(new DOMException("Request aborted", "AbortError"));
    await expect(fetchScans(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
