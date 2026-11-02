import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchScanImage, fetchScans, type ScanImageResponse, type ScanSummary } from "../api";
import { fmt, fmtInt } from "../format";
import { useTheme } from "../theme-provider";
import { Badge, Btn, DetailRow, Empty, Field, Panel, Select } from "./ui";

interface ScanImageProps {
  replayAt?: string | null;
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : "Request failed";
const dateLabel = (at: string | null) => at && Number.isFinite(Date.parse(at))
  ? new Date(at).toISOString().replace("T", " ").replace(".000Z", " UTC")
  : "start unknown";

/** Switching modes discards all live state before a replay frame can render. */
export function ScanImage({ replayAt }: ScanImageProps) {
  return <ScanPanel key={replayAt == null ? "live" : "replay"} replayAt={replayAt ?? null} />;
}

function ScanPanel({ replayAt }: { replayAt: string | null }) {
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const replay = replayAt !== null;

  // The recent list is refreshed on demand, never on every replay tick.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setScans([]);
    async function load() {
      try {
        const rows = await fetchScans(controller.signal);
        if (!controller.signal.aborted) setScans(rows);
      } catch (err) {
        if (!controller.signal.aborted) setError(messageOf(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  // This endpoint can return today's lifecycle even in replay. An unknown start
  // cannot establish that a scan existed at the cursor, so fail closed for it.
  const visible = scans.filter((scan) => !replay || (
    scan.startedAt !== null && Date.parse(scan.startedAt) <= Date.parse(replayAt)
  ));
  const selected = visible.find((scan) => scan.scanId === selectedId) ?? visible[0];

  return (
    <Panel title="Scan reconstruction" subtitle="Cleaned mean signal per sky pixel · read-only · manual refresh">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end", marginBottom: 10 }}>
        {selected ? (
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <Field label="Recent scans" htmlFor="rta-scan-selector">
              <Select
                id="rta-scan-selector"
                value={selected.scanId}
                onChange={setSelectedId}
                options={visible.map((scan) => ({
                  value: scan.scanId,
                  // Do not display the list's final lifecycle state in replay.
                  label: `${scan.scanId} · ${scan.target ?? "unknown target"} · ${dateLabel(scan.startedAt)}${replay ? "" : ` · ${scan.state}`}`
                }))}
              />
            </Field>
          </div>
        ) : null}
        <Btn onClick={() => setRevision((value) => value + 1)} disabled={loading}>Refresh scans</Btn>
      </div>
      {loading ? <div role="status"><Empty>Loading recent scans…</Empty></div> : null}
      {error ? <ScanError>Could not load recent scans: {error}. Try Refresh scans.</ScanError> : null}
      {!loading && !error && !selected ? (
        <Empty>{replay
          ? "No recent scans with a known start at or before the replay cursor. Future and undated scans are hidden."
          : "No recent scans available. Refresh scans after the array starts a scan."}</Empty>
      ) : null}
      {selected ? (
        <SelectedScan
          // A cursor change removes the old canvas synchronously and aborts its
          // request. No image or metrics survive seeking backward (or forward).
          key={`${selected.scanId}:${replayAt ?? "live"}`}
          scan={selected}
          replayAt={replayAt}
        />
      ) : null}
    </Panel>
  );
}

function SelectedScan({ scan, replayAt }: { scan: ScanSummary; replayAt: string | null }) {
  const { theme: t } = useTheme();
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ image: ScanImageResponse; to: string } | null>(null);
  const [loading, setLoading] = useState(replayAt === null);
  const [error, setError] = useState<string | null>(null);
  const replay = replayAt !== null;
  const scanId = scan.scanId;

  useEffect(() => {
    if (replayAt !== null && revision === 0) return;
    const controller = new AbortController();
    const to = replayAt ?? new Date().toISOString();
    setLoading(true);
    setError(null);
    setLoaded(null);
    async function load() {
      try {
        const image = await fetchScanImage(scanId, to, controller.signal);
        if (controller.signal.aborted) return;
        if (image.scanId !== scanId || !Number.isInteger(image.gridSize) || image.gridSize < 1 ||
          image.gridSize > 2048 || image.pixels.length !== image.gridSize * image.gridSize) {
          throw new Error("Invalid scan image response");
        }
        setLoaded({ image, to });
      } catch (err) {
        if (!controller.signal.aborted) setError(messageOf(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [scanId, replayAt, revision]);

  // In replay, metadata comes only from the known start, not an image response
  // whose lifecycle summary might include an end event after the cursor.
  const summary = replay ? scan : loaded?.image.scan ?? scan;
  const image = loaded?.image;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Btn variant="primary" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          {replay ? "Load scan image at replay cursor" : "Refresh scan image"}
        </Btn>
        <Badge tone={!replay && summary.state === "failed" ? "crit" : "neutral"}>
          {replay ? "replay snapshot" : summary.state}
        </Badge>
      </div>
      <div style={{ color: t.muted, fontSize: 11.5, overflowWrap: "anywhere" }}>
        {replay
          ? `Replay cursor: ${dateLabel(replayAt)}. Only samples at or before this instant are requested. Moving the cursor clears the image.`
          : "Images do not update automatically. Refresh to include newly received samples."}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0 16px" }}>
        <DetailRow label="Scan target" value={<span style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{summary.target ?? "unknown"}</span>} />
        <DetailRow label="Observing band" value={summary.bandHz == null ? "unknown" : `${fmt(summary.bandHz / 1e6, 3)} MHz`} />
      </div>
      {loading ? <div role="status"><Empty>Loading scan image…</Empty></div> : null}
      {error ? <ScanError>Could not load scan image: {error}. Use the image button to retry.</ScanError> : null}
      {!loading && !loaded && !error && replay ? <Empty>Load a reconstruction at the replay cursor. No final image is shown automatically.</Empty> : null}
      {image && loaded ? (
        <>
          <div style={{ color: t.muted, fontSize: 11.5 }}>Samples through {dateLabel(loaded.to)}{replay ? " · replay snapshot" : image.complete ? " · final snapshot" : " · partial snapshot"}</div>
          <ScanCanvas image={image} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0 16px" }}>
            <DetailRow label="Pixel coverage" value={`${fmt(image.coverage * 100, 1)}%`} />
            <DetailRow label="Grid" value={`${image.gridSize} × ${image.gridSize} pixels`} />
            <DetailRow label="Field of view" value={`${fmt(image.fovRad, 6)} rad`} />
            <DetailRow label="Samples used / received" value={`${fmtInt(image.cleaning.used)} / ${fmtInt(image.cleaning.total)}`} />
          </div>
          {image.cleaning.used === 0 ? <Empty>No usable samples at this instant. Blue cells are missing data, not zero signal.</Empty> : null}
          <details style={{ fontSize: 12, color: t.text }}>
            <summary style={{ cursor: "pointer", color: t.muted }}>
              Cleaning: {fmtInt(image.cleaning.total - image.cleaning.used)} samples removed or skipped
            </summary>
            <DetailRow label="Missing offsets or signal" value={fmtInt(image.cleaning.empty)} />
            <DetailRow label="Outside field of view" value={fmtInt(image.cleaning.outOfField)} />
            <DetailRow label="Fault-flagged samples" value={fmtInt(image.cleaning.faulty)} />
            <DetailRow label="Pixel outliers" value={fmtInt(image.cleaning.outliers)} />
            <DetailRow label="Samples from excluded dishes" value={fmtInt(image.cleaning.excluded)} />
            <p style={{ overflowWrap: "anywhere" }}>Excluded dishes: {image.cleaning.excludedDishes.join(", ") || "none"}</p>
          </details>
        </>
      ) : null}
    </div>
  );
}

function ScanCanvas({ image }: { image: ScanImageResponse }) {
  const { theme: t } = useTheme();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const low = image.low ?? image.min ?? 0;
  const high = image.high ?? image.max ?? low;
  const holeColor = t.info;

  useEffect(() => {
    try {
      const context = canvas.current?.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      const frame = context.createImageData(image.gridSize, image.gridSize);
      const hole = [1, 3, 5].map((offset) => parseInt(holeColor.slice(offset, offset + 2), 16));
      image.pixels.forEach((value, index) => {
        const missing = value === null || !Number.isFinite(value);
        const gray = missing ? 0 : high > low
          ? Math.round(Math.max(0, Math.min(1, (value - low) / (high - low))) * 255)
          : 128;
        const offset = index * 4;
        frame.data[offset] = missing ? hole[0] : gray;
        frame.data[offset + 1] = missing ? hole[1] : gray;
        frame.data[offset + 2] = missing ? hole[2] : gray;
        frame.data[offset + 3] = 255;
      });
      context.putImageData(frame, 0, 0);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  }, [image, low, high, holeColor]);

  return (
    <figure style={{ margin: 0, width: "100%", maxWidth: 420, justifySelf: "center" }}>
      {unavailable ? <ScanError>Canvas rendering is unavailable in this browser. Scan metrics are still shown below.</ScanError> : null}
      <canvas
        ref={canvas}
        width={image.gridSize}
        height={image.gridSize}
        role="img"
        aria-label={`Reconstructed scan ${image.scanId}, ${image.gridSize} by ${image.gridSize} pixels, ${fmt(image.coverage * 100, 1)}% coverage. Grayscale is signal; blue is missing data.`}
        style={{ display: unavailable ? "none" : "block", width: "100%", height: "auto", aspectRatio: "1", imageRendering: "pixelated", border: `1px solid ${t.line}` }}
      >Reconstructed scan. Grayscale is signal strength; blue cells have no samples.</canvas>
      <figcaption style={{ display: "grid", gap: 5, fontSize: 11, color: t.muted, marginTop: 6 }}>
        <span>North (+Dec) ↑ · RA increases → · full field {fmt(image.fovRad, 6)} rad</span>
        <strong>Display scale: signal strength (relative units)</strong>
        <div aria-hidden="true" style={{ height: 10, background: "linear-gradient(to right, #000, #fff)", border: `1px solid ${t.line}` }} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>Black: {fmt(image.low ?? undefined, 3)} (2nd percentile)</span>
          <span>White: {fmt(image.high ?? undefined, 3)} (98th percentile)</span>
        </div>
        <span>{image.low === null ? "No measured signal range yet." : high > low
          ? "Linear grayscale; values outside the display range are clipped."
          : "Uniform signal: measured pixels are mid-gray."}</span>
        <span>Measured range: {fmt(image.min ?? undefined, 3)} to {fmt(image.max ?? undefined, 3)} (relative units)</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span aria-hidden="true" style={{ width: 12, height: 12, background: holeColor, display: "inline-block" }} />
          Blue = no samples / hole (not zero signal)
        </span>
      </figcaption>
    </figure>
  );
}

function ScanError({ children }: { children: ReactNode }) {
  const { theme: t } = useTheme();
  return <div role="alert" style={{ padding: "8px 10px", fontSize: 12, color: t.crit, background: t.critBg, border: `1px solid ${t.critBorder}`, overflowWrap: "anywhere" }}>{children}</div>;
}
