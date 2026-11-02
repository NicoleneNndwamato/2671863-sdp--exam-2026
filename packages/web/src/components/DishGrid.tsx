import type { ServiceTopology } from "@sdp/shared";
import { useTheme } from "../theme-provider";
import { entitiesOfKind, numOf, stateBool, type Snapshot } from "../snapshot";
import { fmt } from "../format";

/**
 * The 100-dish array, laid out exactly as the service publishes it: each entity
 * in `$topology` carries `row` and `col`, so the grid is data, not markup.
 *
 * Colour is an absolute temperature band, not a rank. Ranking was tempting -
 * every dish sits within a degree of its neighbours - but a rank ramp paints
 * the whole array one flat colour, which is exactly the information an operator
 * needs to see. Bands are fixed, so a hot dish looks hot at any time of day:
 * blue when cool, green when normal, amber when warm, red when too hot, and a
 * dark outlined square when the dish is switched off or has stopped reporting.
 */

/** Drive-temperature bands in °C, aligned with the alert thresholds. */
const BANDS = {
  cool: 40,
  normal: 60,
  warm: 70
} as const;

type Band = "cool" | "normal" | "warm" | "hot" | "offline" | "unknown";
export function DishGrid({
  topology,
  snapshot,
  selected,
  onSelect
}: {
  topology: ServiceTopology | null;
  snapshot: Snapshot;
  selected: string | null;
  onSelect: (entity: string) => void;
}) {
  const { theme: t } = useTheme();
  const dishes = entitiesOfKind(topology, "dish");

  if (dishes.length === 0) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: t.muted, border: `1px dashed ${t.line}`, textAlign: "center" }}>
        Waiting for the RTA <code>$topology</code> document…
      </div>
    );
  }

  const cols = Math.max(...dishes.map((d) => (d.col ?? 0) + 1));

  const bandOf = (celsius: number | undefined, online: boolean): Band => {
    if (!online) return "offline";
    if (celsius === undefined || !Number.isFinite(celsius)) return "unknown";
    if (celsius < BANDS.cool) return "cool";
    if (celsius < BANDS.normal) return "normal";
    if (celsius < BANDS.warm) return "warm";
    return "hot";
  };

  const colourOf = (band: Band): string =>
    band === "cool"
      ? t.heatCool
      : band === "normal"
        ? t.ok
        : band === "warm"
          ? t.heatHot
          : band === "hot"
            ? t.crit
            : band === "offline"
              ? t.dishOfflineBg
              : t.heatMid;

  const inkOf = (band: Band): string => (band === "offline" ? t.muted : band === "unknown" ? t.text : "#fff");

  // Legend counts. Same lookups as a cell, kept here so the legend can say how
  // many dishes are in each band without a second render pass.
  const counts = dishes.reduce(
    (acc, dish) => {
      const normalTopic = `arl/rta/${dish.id}/telemetry/normal`;
      const scanTopic = `arl/rta/${dish.id}/telemetry/scan`;
      const kelvin = numOf(snapshot, normalTopic, "temperature_k") ?? numOf(snapshot, scanTopic, "temperature_k");
      const sample = snapshot.topics.get(normalTopic)?.payload ?? snapshot.topics.get(scanTopic)?.payload;
      const online = stateBool(snapshot, `arl/rta/${dish.id}/state/enabled`) !== false && sample?.status !== false;
      acc[bandOf(kelvin === undefined ? undefined : kelvin - 273.15, online)] += 1;
      return acc;
    },
    { cool: 0, normal: 0, warm: 0, hot: 0, offline: 0, unknown: 0 } as Record<Band, number>
  );

  const legend: Array<{ band: Band; label: string }> = [
    { band: "cool", label: `cool < ${BANDS.cool}°C` },
    { band: "normal", label: `normal ${BANDS.cool}–${BANDS.normal}` },
    { band: "warm", label: `warm ${BANDS.normal}–${BANDS.warm}` },
    { band: "hot", label: `hot ≥ ${BANDS.warm}` },
    { band: "offline", label: "offline" },
    { band: "unknown", label: "no data" }
  ];

  return (
    <div
      role="group"
      aria-label="Dish array"
      style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 3 }}
    >
      {dishes.map((dish) => {
        const normalTopic = `arl/rta/${dish.id}/telemetry/normal`;
        const scanTopic = `arl/rta/${dish.id}/telemetry/scan`;
        const temperature = numOf(snapshot, normalTopic, "temperature_k") ?? numOf(snapshot, scanTopic, "temperature_k");
        const fault = (snapshot.topics.get(normalTopic)?.payload.fault_code ??
          snapshot.topics.get(scanTopic)?.payload.fault_code) as string | undefined;
        const enabled = stateBool(snapshot, `arl/rta/${dish.id}/state/enabled`);
        const stowed = stateBool(snapshot, `arl/rta/${dish.id}/state/stowed`);
        const isSelected = selected === dish.id;
        const hasFault = fault !== undefined && fault !== "none";

        // The service publishes "enabled" as state and "status" on the sample;
        // either saying off means the dish is dark, which is itself information.
        const sample = snapshot.topics.get(normalTopic)?.payload ?? snapshot.topics.get(scanTopic)?.payload;
        const online = enabled !== false && sample?.status !== false;
        const celsius = temperature === undefined ? undefined : temperature - 273.15;
        const band = bandOf(celsius, online);
        const background = colourOf(band);
        const ink = inkOf(band);
        const label = dish.id.replace("dish-", "");

        return (
          <button
            key={dish.id}
            onClick={() => onSelect(dish.id)}
            aria-pressed={isSelected}
            aria-label={`${dish.id}${temperature !== undefined ? `, ${fmt(temperature, 1)} K` : ""}${
              hasFault ? `, fault ${fault}` : ""
            }`}
            title={`${dish.id}\n${fault ? `fault: ${fault}\n` : ""}${stowed ? "stowed" : enabled === false ? "disabled" : "enabled"}`}
            style={{
              position: "relative",
              aspectRatio: "1 / 1",
              borderRadius: 0,
              borderWidth: 1,
              borderStyle: band === "offline" ? "dashed" : "solid",
              borderColor: hasFault ? t.crit : isSelected ? t.text : band === "offline" ? t.dishOfflineBorder : "transparent",
              boxShadow: hasFault ? `0 0 0 1px ${t.crit}` : undefined,
              background,
              cursor: "pointer",
              padding: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: ink,
              textShadow: band === "offline" || band === "unknown" ? undefined : "0 1px 1px rgba(0,0,0,0.45)",
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              lineHeight: 1.1,
              overflow: "hidden"
            }}
          >
            <span style={{ fontWeight: 600 }}>{label}</span>
            <span style={{ fontSize: 8, opacity: 0.9 }}>{celsius === undefined ? "··" : fmt(celsius, 0)}</span>
            {stowed ? (
              <span aria-hidden style={{ position: "absolute", top: 0, right: 0, fontSize: 7, padding: "0 2px", background: "rgba(0,0,0,0.45)" }}>
                S
              </span>
            ) : null}
          </button>
        );
      })}
      <div
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "6px 14px",
          fontSize: 10,
          color: t.muted,
          marginTop: 4
        }}
      >
        {legend.map((entry) => (
          <span key={entry.band} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                background: colourOf(entry.band),
                borderWidth: 1,
                borderStyle: entry.band === "offline" ? "dashed" : "solid",
                borderColor: entry.band === "offline" ? t.dishOfflineBorder : t.lineSoft
              }}
            />
            {entry.label}
            <span style={{ fontFamily: "var(--font-mono)", color: t.muted2 }}>{counts[entry.band]}</span>
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", color: t.muted2 }}>
          {counts.cool + counts.normal + counts.warm + counts.hot} reporting
        </span>
      </div>
      <span className="visually-hidden">
        Dish colour shows drive temperature: blue below {BANDS.cool} degrees, green to {BANDS.normal}, amber to{" "}
        {BANDS.warm}, red above that; a dashed outline means the dish is offline.
      </span>
    </div>
  );
}
