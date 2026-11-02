/** Small formatting helpers shared by every panel. */

export function kelvinToCelsius(k: number | undefined): number | undefined {
  return k === undefined ? undefined : k - 273.15;
}

export function fmt(value: number | undefined, digits = 1): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function fmtInt(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-ZA");
}

/** 1234 -> "1 234" with a thin space, for dense telemetry tables. */
export function fmtSpace(value: number | undefined, digits = 0): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(11, 19);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)}`;
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "never";
  const seconds = Math.max(0, Math.round((now - d) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

/**
 * Temperature colour ramp: cool blue -> neutral -> hot amber.
 *
 * The domain is a parameter because a fixed one hides the interesting thing:
 * when 100 dishes all sit within half a degree, an absolute 280-320 K scale
 * paints them one flat colour and the array looks like a single block.
 */
export function heatColour(
  kelvin: number | undefined,
  theme: { heatCool: string; heatMid: string; heatHot: string },
  lo = 280,
  hi = 320
): string {
  if (kelvin === undefined || !Number.isFinite(kelvin)) return theme.heatMid;
  return heatRamp((kelvin - lo) / (hi - lo || 1), theme);
}

/** The ramp itself, for callers that colour by rank rather than by value. */
export function heatRamp(fraction: number, theme: { heatCool: string; heatMid: string; heatHot: string }): string {
  const t = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0.5));
  return t < 0.5 ? mix(theme.heatCool, theme.heatMid, t * 2) : mix(theme.heatMid, theme.heatHot, (t - 0.5) * 2);
}

function mix(a: string, b: string, t: number): string {
  const pa = parse(a);
  const pb = parse(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function parse(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** `arl/rta/dish-001/telemetry/normal` -> { entity, kind, name }. */
export function splitTopic(topic: string): { entity: string; kind: string; name: string } {
  const parts = topic.split("/");
  return {
    entity: parts[2] ?? "",
    kind: parts[3] ?? "",
    name: parts[4] ?? ""
  };
}

/** A payload field is `unknown` until proven otherwise; this proves it. */
export function numOr(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
