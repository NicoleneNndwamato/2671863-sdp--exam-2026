import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fetchScanImage, fetchScans, type ScanImageResponse, type ScanSummary } from "../api";
import { ThemeProvider } from "../theme-provider";
import { ScanImage } from "./ScanImage";
import { RtaView } from "../views/RtaView";

jest.mock("../api", () => ({ fetchScans: jest.fn(), fetchScanImage: jest.fn() }));
const listMock = fetchScans as jest.MockedFunction<typeof fetchScans>;
const imageMock = fetchScanImage as jest.MockedFunction<typeof fetchScanImage>;
const draw = jest.fn();
const cursor = "2026-11-02T12:05:00.000Z";
const earlier = "2026-11-02T12:02:00.000Z";
const scan: ScanSummary = {
  scanId: "scan-0001", subarray: "main", target: "Cygnus A", state: "completed", origin: "operator",
  startedAt: "2026-11-02T12:00:00.000Z", endedAt: "2026-11-02T12:10:00.000Z",
  gridSize: 2, fovRad: 0.02, bandHz: 1.42e9, raRad: 1, decRad: 0.5
};
const image: ScanImageResponse = {
  scan, scanId: scan.scanId, complete: true, gridSize: 2, fovRad: 0.02,
  pixels: [null, 0, 5, 10], coverage: 0.75, min: 0, max: 10, low: 0, high: 10,
  cleaning: { total: 20, used: 12, empty: 1, outOfField: 1, faulty: 2, outliers: 1, excluded: 3, excludedDishes: ["dish-003"] }
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function panel(replayAt?: string | null) {
  return <ThemeProvider><ScanImage replayAt={replayAt} /></ThemeProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
  listMock.mockReset().mockResolvedValue([scan]);
  imageMock.mockReset().mockResolvedValue(image);
  draw.mockReset();
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: draw
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("scan reconstruction", () => {
  it("renders a bounded live grayscale image, distinct holes, scale and cleaning metrics", async () => {
    const user = userEvent.setup();
    const before = Date.now();
    render(panel());
    const canvas = await screen.findByRole("img", { name: /Reconstructed scan scan-0001/ });
    expect(canvas).toHaveAttribute("width", "2");
    expect(canvas).toHaveStyle({ imageRendering: "pixelated" });
    expect(screen.getByText("75.0%")).toBeInTheDocument();
    expect(screen.getByText("2 × 2 pixels")).toBeInTheDocument();
    expect(screen.getByText("1420.000 MHz")).toBeInTheDocument();
    expect(screen.getByText("Cygnus A", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("12 / 20")).toBeInTheDocument();
    expect(screen.getByText("Black: 0.000 (2nd percentile)")).toBeInTheDocument();
    expect(screen.getByText("White: 10.000 (98th percentile)")).toBeInTheDocument();
    expect(screen.getByText(/relative units/, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Blue = no samples / hole (not zero signal)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh scan image" })).toHaveStyle({ background: "#801226" });
    await user.click(screen.getByText("Cleaning: 8 samples removed or skipped"));
    expect(screen.getByText("Fault-flagged samples")).toBeVisible();
    expect(screen.getByText("Excluded dishes: dish-003")).toBeVisible();
    expect(Array.from(draw.mock.calls[0][0].data)).toEqual([
      44, 98, 168, 255, 0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255
    ]);
    const [id, to, signal] = imageMock.mock.calls[0];
    expect(id).toBe(scan.scanId);
    expect(Date.parse(to)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(to)).toBeLessThanOrEqual(Date.now());
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("clips grayscale at the advertised display endpoints", async () => {
    imageMock.mockResolvedValue({ ...image, pixels: [-20, 5, 80, null], min: -20, max: 80 });
    render(panel());
    await screen.findByRole("img");
    expect(Array.from(draw.mock.calls[0][0].data)).toEqual([
      0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255, 44, 98, 168, 255
    ]);
  });

  it("keeps a uniform measured signal distinct from holes in dark mode", async () => {
    window.localStorage.setItem("meridian.theme", "dark");
    imageMock.mockResolvedValue({ ...image, pixels: [5, 5, null, 5], low: 5, high: 5, min: 5, max: 5 });
    render(panel());
    await screen.findByRole("img");
    expect(screen.getByText(/Uniform signal/)).toBeInTheDocument();
    expect(Array.from(draw.mock.calls[0][0].data)).toEqual([
      128, 128, 128, 255, 128, 128, 128, 255, 127, 176, 234, 255, 128, 128, 128, 255
    ]);
  });

  it("shows holes and a no-usable-samples notice for an empty reconstruction", async () => {
    imageMock.mockResolvedValue({ ...image, pixels: [null, null, null, null], coverage: 0, min: null, max: null, low: null, high: null,
      cleaning: { ...image.cleaning, used: 0 } });
    render(panel());
    await screen.findByRole("img");
    expect(screen.getByText("0.0%")).toBeInTheDocument();
    expect(screen.getByText(/No usable samples at this instant/)).toBeInTheDocument();
    expect(screen.getByText("No measured signal range yet.")).toBeInTheDocument();
    expect(draw.mock.calls[0][0].data[3]).toBe(255);
  });

  it("handles an empty recent list without fetching an image", async () => {
    listMock.mockResolvedValue([]);
    render(panel());
    expect(screen.getByRole("status")).toHaveTextContent("Loading recent scans");
    expect(await screen.findByText(/No recent scans available/)).toBeInTheDocument();
    expect(imageMock).not.toHaveBeenCalled();
  });

  it("recovers from list errors with an explicit refresh", async () => {
    const user = userEvent.setup();
    listMock.mockRejectedValueOnce(new Error("Network unavailable"));
    render(panel());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load recent scans: Network unavailable");
    await user.click(screen.getByRole("button", { name: "Refresh scans" }));
    expect(await screen.findByRole("img")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("recovers from image errors without losing the selector", async () => {
    const user = userEvent.setup();
    imageMock.mockRejectedValueOnce(new Error("no field of view known"));
    render(panel());
    expect(await screen.findByRole("alert")).toHaveTextContent("no field of view known");
    expect(screen.getByRole("combobox", { name: "Recent scans" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh scan image" }));
    expect(await screen.findByRole("img")).toBeInTheDocument();
  });

  it("retains metrics if the browser cannot render a canvas", async () => {
    jest.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    render(panel());
    expect(await screen.findByRole("alert")).toHaveTextContent("Canvas rendering is unavailable");
    expect(screen.getByText("75.0%")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("rejects a response for the wrong scan instead of drawing it", async () => {
    imageMock.mockResolvedValue({ ...image, scanId: "wrong-scan" });
    render(panel());
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid scan image response");
    expect(draw).not.toHaveBeenCalled();
  });

  it("changes selection, aborts the old request and ignores a late response", async () => {
    const user = userEvent.setup();
    const pending = deferred<ScanImageResponse>();
    const second = { ...scan, scanId: "scan-0002", target: "Cassiopeia A" };
    listMock.mockResolvedValue([scan, second]);
    imageMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ...image, scanId: second.scanId, scan: second });
    render(panel());
    const selector = await screen.findByRole("combobox", { name: "Recent scans" });
    const signal = imageMock.mock.calls[0][2]!;
    expect(screen.getByRole("status")).toHaveTextContent("Loading scan image");
    await user.selectOptions(selector, second.scanId);
    expect(signal.aborted).toBe(true);
    await screen.findByRole("img", { name: /scan-0002/ });
    await act(async () => pending.resolve(image));
    expect(screen.getByRole("img")).toHaveAccessibleName(/scan-0002/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aborts a pending list on unmount and ignores a late rejection", async () => {
    const pending = deferred<ScanSummary[]>();
    listMock.mockReturnValue(pending.promise);
    const { unmount } = render(panel());
    const signal = listMock.mock.calls[0][0]!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => pending.reject(new Error("late failure")));
    expect(imageMock).not.toHaveBeenCalled();
  });

  it("aborts a pending image on unmount", async () => {
    const pending = deferred<ScanImageResponse>();
    imageMock.mockReturnValue(pending.promise);
    const { unmount } = render(panel());
    await waitFor(() => expect(imageMock).toHaveBeenCalledTimes(1));
    const signal = imageMock.mock.calls[0][2]!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(image));
    expect(draw).not.toHaveBeenCalled();
  });

  it.each(["running", "completed", "paused"])("does not poll a %s scan", async (state) => {
    jest.useFakeTimers();
    listMock.mockResolvedValue([{ ...scan, state }]);
    render(panel());
    await screen.findByRole("img");
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(imageMock).toHaveBeenCalledTimes(1);
  });
});

describe("replay scan isolation", () => {
  it("receives the replay cursor from the RTA view without requiring controls", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    const view = (replayAt: string) => <ThemeProvider><RtaView
      service="rta" displayName="Radio Telescope" topology={null}
      snapshot={{ topics: new Map(), at: replayAt }} history={[]}
      onSubmit={onSubmit} canControl={false} targets={[]} replayAt={replayAt}
    /></ThemeProvider>;
    const { rerender } = render(view(cursor));
    expect(screen.getByRole("heading", { name: "Scan reconstruction" })).toBeInTheDocument();
    await screen.findByRole("combobox", { name: "Recent scans" });
    expect(imageMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Load scan image at replay cursor" }));
    await screen.findByRole("img", { name: /Reconstructed scan/ });
    expect(imageMock).toHaveBeenCalledWith(scan.scanId, cursor, expect.any(AbortSignal));
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(view(earlier));
    expect(screen.queryByRole("img", { name: /Reconstructed scan/ })).not.toBeInTheDocument();
    expect(imageMock).toHaveBeenCalledTimes(1);
  });

  it("hides future and undated scans and never exposes the final lifecycle or image automatically", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([
      { ...scan, scanId: "future-scan", target: "Future target", startedAt: "2026-11-02T13:00:00Z" },
      { ...scan, scanId: "undated-scan", startedAt: null },
      { ...scan, state: "failed" }
    ]);
    imageMock.mockResolvedValue({ ...image, scan: { ...scan, target: "Future metadata", state: "failed" } });
    render(panel(cursor));
    const selector = await screen.findByRole("combobox", { name: "Recent scans" });
    expect(within(selector).getAllByRole("option")).toHaveLength(1);
    expect(screen.queryByText(/future-scan|Future target|undated-scan|failed|completed/)).not.toBeInTheDocument();
    expect(imageMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Load scan image at replay cursor" }));
    await screen.findByRole("img");
    expect(imageMock).toHaveBeenCalledWith(scan.scanId, cursor, expect.any(AbortSignal));
    expect(screen.queryByText(/Future metadata|failed|final snapshot/)).not.toBeInTheDocument();
  });

  it("clears a loaded image and metrics on every seek without fetching on playback ticks", async () => {
    const user = userEvent.setup();
    const { rerender } = render(panel(cursor));
    await screen.findByRole("combobox");
    await user.click(screen.getByRole("button", { name: "Load scan image at replay cursor" }));
    await screen.findByRole("img");
    rerender(panel(earlier));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("75.0%")).not.toBeInTheDocument();
    rerender(panel("2026-11-02T12:02:01.000Z"));
    expect(imageMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledTimes(1);
    rerender(panel("2026-11-02T11:59:59.999Z"));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(/No recent scans with a known start/)).toBeInTheDocument();
    expect(imageMock).toHaveBeenCalledTimes(1);
  });

  it("aborts a replay request when seeking and ignores its late final image", async () => {
    const user = userEvent.setup();
    const pending = deferred<ScanImageResponse>();
    imageMock.mockReturnValueOnce(pending.promise);
    const { rerender } = render(panel(cursor));
    await screen.findByRole("combobox");
    await user.click(screen.getByRole("button", { name: "Load scan image at replay cursor" }));
    const signal = imageMock.mock.calls[0][2]!;
    rerender(panel(earlier));
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(image));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(draw).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Load scan image at replay cursor" }));
    await screen.findByRole("img");
    expect(imageMock).toHaveBeenLastCalledWith(scan.scanId, earlier, expect.any(AbortSignal));
  });

  it("discards a loaded live image when entering replay", async () => {
    const { rerender } = render(panel());
    await screen.findByRole("img");
    rerender(panel(cursor));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText(/final snapshot/)).not.toBeInTheDocument();
    await screen.findByRole("combobox");
    expect(imageMock).toHaveBeenCalledTimes(1);
  });

  it("aborts a pending live image before entering replay and fetches anew when returning live", async () => {
    const pending = deferred<ScanImageResponse>();
    imageMock.mockReturnValueOnce(pending.promise);
    const { rerender } = render(panel());
    await waitFor(() => expect(imageMock).toHaveBeenCalledTimes(1));
    const signal = imageMock.mock.calls[0][2]!;
    rerender(panel(cursor));
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(image));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(imageMock).toHaveBeenCalledTimes(1);
    rerender(panel());
    await screen.findByRole("img");
    expect(imageMock).toHaveBeenCalledTimes(2);
  });

  it("does not load an image for an invalid replay cursor", async () => {
    render(panel("invalid"));
    await screen.findByText(/No recent scans with a known start/);
    expect(imageMock).not.toHaveBeenCalled();
  });
});
