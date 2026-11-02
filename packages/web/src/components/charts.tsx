import type { CSSProperties } from "react";
import { useTheme } from "../theme-provider";
import { fmt } from "../format";

export interface Point {
  x: number;
  y: number;
}

export interface Series {
  label: string;
  points: Point[];
  colour?: string;
  fill?: boolean;
  dashed?: boolean;
}

/**
 * A deliberately small SVG line chart.
 *
 * Charts here exist to answer "is it drifting?" at a glance, not to be a
 * plotting library: fixed viewBox, no animation, one gridline set, values in a
 * mono font. Colours come from the theme so light/dark stay legible.
 */
export function LineChart({
  series,
  height = 150,
  yDigits = 1,
  unit,
  emptyLabel = "No data in this window.",
  yMin,
  yMax
}: {
  series: Series[];
  height?: number;
  yDigits?: number;
  unit?: string;
  emptyLabel?: string;
  yMin?: number;
  yMax?: number;
}) {
  const { theme: t } = useTheme();

  const all = series.flatMap((s) => s.points);
  if (all.length === 0) {
    return (
      <div
        style={{
          height,
          display: "grid",
          placeItems: "center",
          fontSize: 11,
          color: t.muted,
          background: t.panelSunken,
          border: `1px dashed ${t.line}`
        }}
      >
        {emptyLabel}
      </div>
    );
  }

  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const lo = yMin ?? Math.min(...ys);
  const hi = yMax ?? Math.max(...ys);
  const spanY = hi - lo || 1;
  const spanX = x1 - x0 || 1;

  const W = 640;
  const H = 200;
  const pad = 4;

  const toX = (x: number) => pad + ((x - x0) / spanX) * (W - pad * 2);
  const toY = (y: number) => H - pad - ((y - lo) / spanY) * (H - pad * 2);

  // A stream that has not published in this window is normal - the array only
  // emits `scan` while scanning. Empty series are dropped here rather than
  // crashing the path builder.
  const drawable = series.filter((s) => s.points.length > 0);

  const paths = drawable.map((s, index) => {
    const colour = s.colour ?? [t.chartLine, t.ok, t.warn, t.crit, t.info][index % 5];
    const ordered = [...s.points].sort((a, b) => a.x - b.x);
    const d = ordered.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.x).toFixed(2)},${toY(p.y).toFixed(2)}`).join(" ");
    const area = `${d} L${toX(ordered[ordered.length - 1].x).toFixed(2)},${H - pad} L${toX(ordered[0].x).toFixed(2)},${H - pad} Z`;
    return { colour, d, area, fill: s.fill, dashed: s.dashed, label: s.label, single: ordered.length === 1, only: ordered[0] };
  });

  return (
    <div style={{ position: "relative" }}>
      {/* One range label, low to high, in reading order. Two labels at opposite
          ends of the same row read as "380 … 0" and look like a bug. */}
      <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 10, color: t.muted2, marginBottom: 2 }}>
        <span style={{ fontFamily: "var(--font-mono)" }}>
          {fmt(lo, yDigits)} – {fmt(hi, yDigits)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Time series: ${series.map((s) => s.label).join(", ")}`}
        style={{ width: "100%", height, background: t.panelSunken, border: `1px solid ${t.lineSoft}`, display: "block" }}
      >
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={0}
            x2={W}
            y1={H * fraction}
            y2={H * fraction}
            stroke={t.gridline}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {paths.map((path) =>
          path.fill ? <path key={`${path.label}-area`} d={path.area} fill={path.colour} opacity={0.12} /> : null
        )}
        {paths.map((path) =>
          path.single ? (
            <circle
              key={`${path.label}-dot`}
              cx={toX(path.only.x)}
              cy={toY(path.only.y)}
              r={2}
              fill={path.colour}
            />
          ) : null
        )}
        {paths.map((path) => (
          <path
            key={path.label}
            d={path.d}
            fill="none"
            stroke={path.colour}
            strokeWidth={1.6}
            strokeDasharray={path.dashed ? "4 3" : undefined}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }}>
        {paths.map((path) => (
          <span key={`${path.label}-key`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: t.muted }}>
            <span
              aria-hidden
              style={{
                width: 12,
                height: 0,
                borderTop: `2px ${path.dashed ? "dashed" : "solid"} ${path.colour}`,
                display: "inline-block"
              }}
            />
            {path.label}
          </span>
        ))}
        {series
          .filter((s) => s.points.length === 0)
          .map((s) => (
            <span key={`${s.label}-empty`} style={{ fontSize: 10, color: t.muted2 }}>
              {s.label} · no data
            </span>
          ))}
      </div>
    </div>
  );
}

/** Horizontal percentage bar, used for state of charge and fuel. */
export function Meter({
  value,
  max = 100,
  tone,
  label,
  style
}: {
  value: number | undefined;
  max?: number;
  tone?: "ok" | "warn" | "crit" | "info";
  label?: string;
  style?: CSSProperties;
}) {
  const { theme: t } = useTheme();
  const pct = value === undefined ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const colour = tone === "crit" ? t.crit : tone === "warn" ? t.warn : tone === "info" ? t.info : t.ok;

  return (
    <div style={style}>
      {label ? (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.muted, marginBottom: 4 }}>
          <span>{label}</span>
          <span style={{ fontFamily: "var(--font-mono)", color: t.text }}>{value === undefined ? "—" : `${fmt(value, 0)}%`}</span>
        </div>
      ) : null}
      <div
        style={{ height: 8, background: t.panel2, border: `1px solid ${t.lineSoft}`, overflow: "hidden" }}
        role="progressbar"
        aria-valuenow={value === undefined ? 0 : Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: colour, transition: "width 400ms ease" }} />
      </div>
    </div>
  );
}

/** Vertical bar column chart, used for per-site comparisons. */
export function BarChart({
  data,
  height = 130,
  unit,
  digits = 1
}: {
  data: Array<{ label: string; value: number | undefined; tone?: "ok" | "warn" | "crit" | "info" }>;
  height?: number;
  unit?: string;
  digits?: number;
}) {
  const { theme: t } = useTheme();
  const values = data.map((d) => d.value).filter((v): v is number => v !== undefined);
  const hi = values.length > 0 ? Math.max(...values) : 1;
  const lo = values.length > 0 ? Math.min(0, Math.min(...values)) : 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height, padding: "0 2px" }}>
        {data.map((entry) => {
          const fraction = entry.value === undefined ? 0 : Math.max(0, (entry.value - lo) / (hi - lo || 1));
          const colour =
            entry.tone === "crit" ? t.crit : entry.tone === "warn" ? t.warn : entry.tone === "info" ? t.info : t.chartLine;
          return (
            <div key={entry.label} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", gap: 4 }}>
              <span style={{ fontSize: 10, color: t.text, fontFamily: "var(--font-mono)", textAlign: "center" }}>
                {fmt(entry.value, digits)}
              </span>
              <div
                title={`${entry.label}: ${entry.value ?? "no data"}${unit ?? ""}`}
                style={{ height: `${Math.max(2, fraction * 100)}%`, background: colour, opacity: entry.value === undefined ? 0.25 : 1 }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        {data.map((entry) => (
          <span key={entry.label} style={{ flex: 1, textAlign: "center", fontSize: 10, color: t.muted, overflow: "hidden", textOverflow: "ellipsis" }}>
            {entry.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * A wind-direction dial.
 *
 * Weather stations publish `wind_direction_rad` in the meteorological
 * convention - the bearing the wind blows *from*, clockwise from north - so the
 * needle is drawn pointing back along the wind. The optional `spreadRad` is the
 * standard deviation of the direction, drawn as a shaded sector: a tight sector
 * is a steady wind, a wide one means the vanes disagree with each other.
 */
export function Compass({
  directionRad,
  spreadRad,
  height = 172
}: {
  directionRad: number | undefined;
  spreadRad?: number;
  height?: number;
}) {
  const { theme: t } = useTheme();
  const S = 200;
  const c = S / 2;
  const r = 80;

  const toDeg = (radians: number | undefined) =>
    radians === undefined || !Number.isFinite(radians) ? undefined : (((radians * 180) / Math.PI) % 360 + 360) % 360;

  const degrees = toDeg(directionRad);
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const cardinal = degrees === undefined ? "—" : points[Math.round(degrees / 22.5) % 16];

  const at = (angle: number, radius: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return [c + radius * Math.cos(rad), c + radius * Math.sin(rad)] as const;
  };

  // Sector path around the mean bearing, half-width = one standard deviation.
  const spread = spreadRad !== undefined && Number.isFinite(spreadRad) ? Math.min(Math.max((spreadRad * 180) / Math.PI, 3), 60) : undefined;
  let sector: string | undefined;
  if (degrees !== undefined && spread !== undefined) {
    const [x0, y0] = at(degrees - spread, r - 8);
    const [x1, y1] = at(degrees + spread, r - 8);
    sector = `M${c},${c} L${x0.toFixed(2)},${y0.toFixed(2)} A${r - 8},${r - 8} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
  }

  return (
    <figure style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Wind from ${cardinal}${degrees !== undefined ? `, ${Math.round(degrees)} degrees` : ""}`} style={{ width: height, height, flexShrink: 0 }}>
        <circle cx={c} cy={c} r={r} fill={t.panelSunken} stroke={t.lineSoft} strokeWidth={1} />
        <circle cx={c} cy={c} r={r * 0.62} fill="none" stroke={t.gridline} strokeWidth={1} />
        {sector ? <path d={sector} fill={t.chartLine} opacity={0.16} /> : null}
        {Array.from({ length: 36 }, (_, index) => {
          const angle = index * 10;
          const major = angle % 90 === 0;
          const [x0, y0] = at(angle, r);
          const [x1, y1] = at(angle, r - (major ? 11 : 5));
          return <line key={angle} x1={x0} y1={y0} x2={x1} y2={y1} stroke={major ? t.axis : t.gridline} strokeWidth={major ? 1.4 : 1} />;
        })}
        {["N", "E", "S", "W"].map((label) => {
          const angle = { N: 0, E: 90, S: 180, W: 270 }[label] as number;
          const [x, y] = at(angle, r - 22);
          return (
            <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600} fill={label === "N" ? t.crit : t.muted}>
              {label}
            </text>
          );
        })}
        {degrees !== undefined ? (
          <g transform={`rotate(${degrees} ${c} ${c})`}>
            <polygon points={`${c},${c - r + 14} ${c - 6},${c + 12} ${c},${c + 6} ${c + 6},${c + 12}`} fill={t.chartLine} />
            <circle cx={c} cy={c} r={4} fill={t.panel} stroke={t.chartLine} strokeWidth={1.6} />
          </g>
        ) : (
          <text x={c} y={c} textAnchor="middle" dominantBaseline="central" fontSize={11} fill={t.muted}>
            no data
          </text>
        )}
      </svg>
      <figcaption style={{ minWidth: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: t.text, fontFamily: "var(--font-mono)", lineHeight: 1.1 }}>
          {degrees === undefined ? "—" : `${Math.round(degrees)}°`}
        </div>
        <div style={{ fontSize: 11.5, color: t.muted, marginTop: 2 }}>from {cardinal}</div>
        {spread !== undefined ? (
          <div style={{ fontSize: 10.5, color: t.muted2, marginTop: 6 }}>±{spread.toFixed(0)}° spread</div>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * A radial gauge for a single bounded reading - state of charge, fuel, pan
 * level. The arc is the value; the tick marks are the operating band, so an
 * operator can see at a glance whether a number is inside it.
 */
export function Gauge({
  value,
  min = 0,
  max = 100,
  unit = "%",
  label,
  digits = 0,
  tone,
  height = 120
}: {
  value: number | undefined;
  min?: number;
  max?: number;
  unit?: string;
  label?: string;
  digits?: number;
  tone?: "ok" | "warn" | "crit" | "info";
  height?: number;
}) {
  const { theme: t } = useTheme();
  const cx = 100;
  const cy = 100;
  const r = 74;
  const span = max - min || 1;
  const fraction = value === undefined ? 0 : Math.max(0, Math.min(1, (value - min) / span));
  const colour = tone === "crit" ? t.crit : tone === "warn" ? t.warn : tone === "info" ? t.info : t.ok;

  const point = (f: number) => {
    const angle = Math.PI * (1 + f);
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x0, y0] = point(from);
    const [x1, y1] = point(to);
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox="0 0 200 112" role="img" aria-label={`${label ?? "Gauge"}: ${value === undefined ? "no data" : `${fmt(value, digits)}${unit}`}`} style={{ width: "100%", height, display: "block" }}>
        <path d={arc(0, 1)} fill="none" stroke={t.panel2} strokeWidth={12} strokeLinecap="butt" />
        {fraction > 0.001 ? <path d={arc(0, fraction)} fill="none" stroke={colour} strokeWidth={12} strokeLinecap="butt" /> : null}
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const [x0, y0] = point(tick);
          return (
            <line
              key={tick}
              x1={x0}
              y1={y0}
              x2={x0 + (cx - x0) * 0.13}
              y2={y0 + (cy - y0) * 0.13}
              stroke={t.lineSoft}
              strokeWidth={1}
            />
          );
        })}
        <text x={cx} y={cy - 16} textAnchor="middle" fontSize={26} fontWeight={600} fontFamily="var(--font-mono)" fill={value === undefined ? t.muted : t.text}>
          {value === undefined ? "—" : fmt(value, digits)}
        </text>
        <text x={cx} y={cy + 2} textAnchor="middle" fontSize={10.5} fill={t.muted}>
          {unit}
        </text>
        <text x={cx - r} y={cy + 14} textAnchor="middle" fontSize={9.5} fill={t.muted2}>
          {min}
        </text>
        <text x={cx + r} y={cy + 14} textAnchor="middle" fontSize={9.5} fill={t.muted2}>
          {max}
        </text>
      </svg>
      {label ? <figcaption style={{ fontSize: 11, color: t.muted, textAlign: "center", marginTop: 2 }}>{label}</figcaption> : null}
    </figure>
  );
}

/**
 * A tiny site map.
 *
 * Five weather stations sit within a couple of kilometres of each other, so
 * this is a survey plot rather than a geographic map: the bounding box is
 * scaled to the frame and an approximate scale bar is derived from the latitude
 * extent (1° of latitude is ~111 km). Dots are buttons, so picking a site from
 * the map is the same action as picking it from the table.
 */
export function SiteMap({
  sites,
  selected,
  onSelect,
  height = 210
}: {
  sites: Array<{ id: string; lat: number; lon: number; online: boolean }>;
  selected: string;
  onSelect: (id: string) => void;
  height?: number;
}) {
  const { theme: t } = useTheme();
  const W = 400;
  const H = 240;
  const pad = 34;

  if (sites.length === 0) {
    return (
      <div style={{ height, display: "grid", placeItems: "center", fontSize: 11, color: t.muted, border: `1px dashed ${t.line}` }}>
        No positions published.
      </div>
    );
  }

  const lats = sites.map((s) => s.lat);
  const lons = sites.map((s) => s.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const spanLat = maxLat - minLat || 0.001;
  const spanLon = maxLon - minLon || 0.001;

  // Equal metres on both axes: a degree of longitude is shorter than a degree
  // of latitude at this latitude, so longitude is scaled by cos(lat) before
  // fitting. Without it the site cluster looks stretched east-west.
  const cosLat = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const spanX = spanLon * cosLat;
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanLat);
  const x = (lon: number) => (W - spanX * scale) / 2 + (lon - minLon) * cosLat * scale;
  const y = (lat: number) => (H - spanLat * scale) / 2 + (maxLat - lat) * scale;

  const metresPerPx = 111000 / scale;
  const barPx = Math.min(120, (W - pad * 2) * 0.4);
  const barMetres = barPx * metresPerPx;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Map of the weather sites" style={{ width: "100%", height, background: t.panelSunken, border: `1px solid ${t.lineSoft}`, display: "block" }}>
      {Array.from({ length: 7 }, (_, index) => (
        <line key={`v${index}`} x1={pad + (index * (W - pad * 2)) / 6} y1={0} x2={pad + (index * (W - pad * 2)) / 6} y2={H} stroke={t.gridline} strokeWidth={1} />
      ))}
      {Array.from({ length: 5 }, (_, index) => (
        <line key={`h${index}`} x1={0} y1={pad + (index * (H - pad * 2)) / 4} x2={W} y2={pad + (index * (H - pad * 2)) / 4} stroke={t.gridline} strokeWidth={1} />
      ))}
      {sites.map((site) => {
        const active = site.id === selected;
        return (
          <g key={site.id} onClick={() => onSelect(site.id)} style={{ cursor: "pointer" }} role="button" aria-label={`Select ${site.id}`}>
            <circle cx={x(site.lon)} cy={y(site.lat)} r={active ? 9 : 6} fill={site.online ? (active ? t.primary : t.chartLine) : t.crit} opacity={site.online ? 0.9 : 0.7} />
            {active ? <circle cx={x(site.lon)} cy={y(site.lat)} r={14} fill="none" stroke={t.primary} strokeWidth={1.2} opacity={0.5} /> : null}
            <text x={x(site.lon)} y={y(site.lat) - 14} textAnchor="middle" fontSize={10} fontFamily="var(--font-mono)" fill={active ? t.text : t.muted}>
              {site.id}
            </text>
          </g>
        );
      })}
      <g transform={`translate(${pad}, ${H - 16})`}>
        <line x1={0} y1={0} x2={barPx} y2={0} stroke={t.muted2} strokeWidth={1.5} />
        <line x1={0} y1={-4} x2={0} y2={4} stroke={t.muted2} strokeWidth={1.5} />
        <line x1={barPx} y1={-4} x2={barPx} y2={4} stroke={t.muted2} strokeWidth={1.5} />
        <text x={barPx + 8} y={3.5} fontSize={9.5} fill={t.muted2} fontFamily="var(--font-mono)">
          ≈ {barMetres >= 1000 ? `${(barMetres / 1000).toFixed(1)} km` : `${Math.round(barMetres)} m`}
        </text>
      </g>
    </svg>
  );
}

/**
 * A single stacked bar showing where the energy went.
 *
 * Power is the one reading at the ARL where the parts must add up, so this is
 * deliberately one bar rather than a set of tiles: the proportions are the
 * message and a stack makes them comparable at a glance.
 */
export function StackedBar({
  segments,
  height = 26,
  unit = "kW"
}: {
  segments: Array<{ label: string; value: number; colour: string }>;
  height?: number;
  unit?: string;
}) {
  const { theme: t } = useTheme();
  const shown = segments.filter((segment) => Number.isFinite(segment.value) && segment.value > 0);
  const total = shown.reduce((sum, segment) => sum + segment.value, 0);

  if (shown.length === 0 || total <= 0) {
    return (
      <div style={{ height, display: "grid", placeItems: "center", fontSize: 11, color: t.muted, background: t.panelSunken, border: `1px dashed ${t.line}` }}>
        Nothing is flowing.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", height, background: t.panel2, border: `1px solid ${t.lineSoft}`, overflow: "hidden" }} role="img" aria-label={shown.map((s) => `${s.label} ${fmt(s.value, 1)} ${unit}`).join(", ")}>
        {shown.map((segment) => (
          <div
            key={segment.label}
            title={`${segment.label}: ${fmt(segment.value, 1)} ${unit} (${fmt((segment.value / total) * 100, 0)}%)`}
            style={{ width: `${(segment.value / total) * 100}%`, background: segment.colour, height: "100%" }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 7 }}>
        {shown.map((segment) => (
          <span key={`${segment.label}-key`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, color: t.muted }}>
            <span aria-hidden style={{ width: 9, height: 9, background: segment.colour, display: "inline-block" }} />
            {segment.label}{" "}
            <span style={{ fontFamily: "var(--font-mono)", color: t.text }}>
              {fmt(segment.value, 1)} {unit}
            </span>
            <span style={{ color: t.muted2 }}>({fmt((segment.value / total) * 100, 0)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Tiny inline trend line for KPI cards. */
export function Sparkline({ values, tone }: { values: number[]; tone?: "ok" | "warn" | "crit" | "info" }) {
  const { theme: t } = useTheme();
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const points = values
    .map((value, index) => `${(index / (values.length - 1)) * 100},${28 - ((value - lo) / span) * 24}`)
    .join(" ");
  const colour = tone === "crit" ? t.crit : tone === "warn" ? t.warn : tone === "info" ? t.info : t.ok;

  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: "100%", height: 26 }} aria-hidden>
      <polyline points={points} fill="none" stroke={colour} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
