import { useMemo, useState } from "react";
import { useTheme } from "../theme-provider";
import { Badge, Btn, DetailRow, Dot, Empty, Kpi, Panel } from "../components/ui";
import { BarChart, Compass, Gauge, LineChart, Meter, SiteMap } from "../components/charts";
import { ControlList } from "../components/ControlPanel";
import { fmt, fmtInt, fmtTime, kelvinToCelsius, numOr } from "../format";
import { seriesFrom, topicsNamed } from "../snapshot";
import type { ViewProps } from "../view-types";

/**
 * Local Weather Monitoring.
 *
 * Five sites on the same site: weather stations, plus one sonic anemometer,
 * one soiling reference cell and one evaporation pan. The weather drives every
 * other decision at the ARL - wind parks the dishes, lightning stops observing,
 * soiling eats solar yield - hence the emphasis on wind, storms and cleanliness.
 */
export function WeatherView({ topology, snapshot, history, onSubmit, canControl, replayAt }: ViewProps) {
  const { theme: t } = useTheme();
  const [site, setSite] = useState("lwm-1");

  const weather = topicsNamed(snapshot, "telemetry", "weather");
  const pick = (entity: string) => weather.find((entry) => entry.entity === entity)?.item.payload ?? {};

  const primary = pick(site);
  const lightning = snapshot.topics.get("arl/lwm/global/telemetry/lightning")?.payload ?? {};
  const soiling = snapshot.topics.get("arl/lwm/lwm-4/telemetry/soiling")?.payload ?? {};
  const pan = snapshot.topics.get("arl/lwm/lwm-5/telemetry/pan")?.payload ?? {};

  // Only lwm-3 carries the sonic anemometer, so its directional statistics
  // belong to that site alone - showing them next to another station's vane
  // would be two instruments pretending to be one.
  const sonic = site === "lwm-3" ? (snapshot.topics.get("arl/lwm/lwm-3/telemetry/sonic")?.payload ?? {}) : {};
  const gustFactor =
    numOr(sonic.gust_factor) ??
    (numOr(primary.wind_speed_ms) && numOr(primary.wind_gust_ms)
      ? (primary.wind_gust_ms as number) / (primary.wind_speed_ms as number)
      : undefined);

  // Station positions come from retained state, not from the sample: a site
  // that has stopped reporting still belongs on the map, just in a different
  // colour.
  const siteLatLon = weather.flatMap((entry) => {
    const position = snapshot.topics.get(`arl/lwm/${entry.entity}/state/position`)?.payload.value as
      | { lat?: number; lon?: number }
      | undefined;
    return typeof position?.lat === "number" && typeof position?.lon === "number"
      ? [{ lat: position.lat, lon: position.lon }]
      : [];
  });
  // Diagonal of the survey area in kilometres: degrees of longitude are
  // shorter than degrees of latitude away from the equator.
  const siteSpanKm = (() => {
    if (siteLatLon.length < 2) return undefined;
    const lats = siteLatLon.map((p) => p.lat);
    const lons = siteLatLon.map((p) => p.lon);
    const midLat = (Math.max(...lats) + Math.min(...lats)) / 2;
    const dLat = (Math.max(...lats) - Math.min(...lats)) * 111;
    const dLon = (Math.max(...lons) - Math.min(...lons)) * 111 * Math.cos((midLat * Math.PI) / 180);
    return Math.hypot(dLat, dLon);
  })();

  const sitePoints = weather.flatMap((entry) => {
    const position = snapshot.topics.get(`arl/lwm/${entry.entity}/state/position`)?.payload.value as
      | { lat?: number; lon?: number }
      | undefined;
    if (typeof position?.lat !== "number" || typeof position?.lon !== "number") return [];
    return [
      {
        id: entry.entity,
        lat: position.lat,
        lon: position.lon,
        online: entry.item.payload.status !== false
      }
    ];
  });

  const nearestStrike = (() => {
    const raw = lightning.nearest_strike_km;
    // The service publishes null when there has been no strike; null compares
    // as 0 in JavaScript and would raise a false lightning warning.
    return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  })();

  const windSeries = useMemo(
    () => seriesFrom(history, { kind: "telemetry", name: "weather", field: "wind_speed_ms", entity: site }),
    [history, site]
  );
  const gustSeries = useMemo(
    () => seriesFrom(history, { kind: "telemetry", name: "weather", field: "wind_gust_ms", entity: site }),
    [history, site]
  );
  const tempSeries = useMemo(
    () =>
      seriesFrom(history, { kind: "telemetry", name: "weather", field: "temperature_k", entity: site }).map((p) => ({
        x: p.x,
        y: p.y - 273.15
      })),
    [history, site]
  );

  // Bars are in °C to match the column header; the wire format is kelvin.
  const siteBars = weather.map((entry) => {
    const kelvin = entry.item.payload.temperature_k;
    return {
      label: entry.entity,
      value: typeof kelvin === "number" ? kelvin - 273.15 : undefined,
      tone: "info" as const
    };
  });

  return (
    <>
      <div className="kpi-row">
        <Kpi label={`Temp · ${site}`} value={fmt(kelvinToCelsius(primary.temperature_k as number), 1)} unit="°C" />
        <Kpi label="Humidity" value={fmt(primary.humidity_pct as number, 0)} unit="%" />
        <Kpi label="Pressure" value={fmt(primary.pressure_hpa as number, 0)} unit="hPa" />
        <Kpi
          label="Wind"
          value={fmt(primary.wind_speed_ms as number, 1)}
          unit="m/s"
          tone={(primary.wind_gust_ms as number) >= 20 ? "crit" : (primary.wind_gust_ms as number) >= 15 ? "warn" : "ok"}
          hint={`gust ${fmt(primary.wind_gust_ms as number, 1)} m/s`}
        />
        <Kpi label="Rainfall" value={fmt(primary.rainfall_mm as number, 1)} unit="mm" hint="since last sample" />
        <Kpi
          label="Battery"
          value={fmt(primary.battery_v as number, 2)}
          unit="V"
          tone={(primary.battery_v as number) < 11.5 ? "crit" : "ok"}
          hint="site power"
        />
        <Kpi
          label="Nearest strike"
          value={nearestStrike === undefined ? "—" : fmt(nearestStrike, 1)}
          unit="km"
          tone={nearestStrike !== undefined && nearestStrike <= 10 ? "crit" : nearestStrike !== undefined && nearestStrike <= 25 ? "warn" : "ok"}
          hint={`${fmtInt(lightning.strikes_last_min as number)} in last minute`}
        />
      </div>

      {nearestStrike !== undefined && nearestStrike <= 25 ? (
        <div
          role="status"
          style={{
            padding: "8px 12px",
            background: nearestStrike <= 10 ? t.critBg : t.warnBg,
            border: `1px solid ${nearestStrike <= 10 ? t.critBorder : t.warnBorder}`,
            color: nearestStrike <= 10 ? t.crit : t.warn,
            fontSize: 12
          }}
        >
          <strong>{nearestStrike <= 10 ? "Lightning within 10 km." : "Storm approaching."}</strong>{" "}
          Nearest strike {fmt(nearestStrike, 1)} km away — the array should not be observing.
        </div>
      ) : null}

      <div className="stack">
        <Panel
          title={`Wind rose · ${site}`}
          subtitle="the bearing the wind arrives from, and how steady it is"
          actions={<Badge tone={(primary.wind_gust_ms as number) >= 20 ? "crit" : (primary.wind_gust_ms as number) >= 15 ? "warn" : "info"}>{fmt(primary.wind_speed_ms as number, 1)} m/s</Badge>}
        >
          {/* Two columns that fall to one when the card is narrow: the dial
              keeps its size and the readings reflow underneath it. */}
          <div className="split">
            <Compass directionRad={numOr(primary.wind_direction_rad)} spreadRad={numOr(sonic.direction_std_rad)} />
            <div style={{ minWidth: 0 }}>
              <DetailRow label="Sustained" value={`${fmt(primary.wind_speed_ms as number, 1)} m/s`} />
              <DetailRow
                label="Gust"
                value={`${fmt(primary.wind_gust_ms as number, 1)} m/s`}
              />
              <DetailRow label="Gust factor" value={gustFactor === undefined ? "—" : fmt(gustFactor, 2)} />
              <DetailRow
                label="Direction spread"
                value={numOr(sonic.direction_std_rad) === undefined ? "— (only lwm-3 has a sonic)" : `±${fmt(((sonic.direction_std_rad as number) * 180) / Math.PI, 0)}°`}
              />
              <DetailRow
                label="Turbulence"
                value={numOr(sonic.turbulence_intensity) === undefined ? "—" : fmt(sonic.turbulence_intensity as number, 2)}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Site map" subtitle="survey positions from retained state - click a site to inspect it">
          <SiteMap sites={sitePoints} selected={site} onSelect={setSite} />
          <p style={{ margin: "8px 0 0", fontSize: 10, color: t.muted2 }}>
            {sitePoints.length} of {weather.length} sites publish a position.
            {siteSpanKm === undefined
              ? ""
              : ` They sit within ≈ ${fmt(siteSpanKm, 1)} km of each other, so the same wind reaches all of them.`}
          </p>
        </Panel>

        <Panel
          title={`Wind · ${site}`}
          subtitle="sustained and gust"
          actions={
            <div style={{ display: "flex", gap: 4 }}>
              {["lwm-1", "lwm-2", "lwm-3", "lwm-4", "lwm-5"].map((id) => (
                <Btn key={id} active={id === site} onClick={() => setSite(id)}>
                  {id.replace("lwm-", "")}
                </Btn>
              ))}
            </div>
          }
        >
          <LineChart
            series={[
              { label: "wind (m/s)", points: windSeries, colour: t.chartLine, fill: true },
              { label: "gust (m/s)", points: gustSeries, colour: t.warn }
            ]}
            yDigits={1}
            unit="m/s"
            height={150}
          />
          <div style={{ marginTop: 10 }}>
            <LineChart series={[{ label: "temperature (°C)", points: tempSeries, colour: t.ok }]} yDigits={1} unit="°C" height={110} />
          </div>
        </Panel>

        <Panel title="Site conditions" subtitle="latest sample per station">
          {/* Six columns, not seven: at this card width the status has to live
              in the site cell as a dot rather than take a column of its own. */}
          <table className="data-table">
            <caption className="visually-hidden">Latest weather reading per site</caption>
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">°C</th>
                <th scope="col">RH</th>
                <th scope="col">Wind</th>
                <th scope="col">Gust</th>
                <th scope="col">Batt</th>
              </tr>
            </thead>
            <tbody>
              {weather.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <Empty>No weather telemetry yet.</Empty>
                  </td>
                </tr>
              ) : (
                weather.map((entry) => {
                  const payload = entry.item.payload;
                  const online = payload.status !== false;
                  return (
                    <tr
                      key={entry.entity}
                      onClick={() => setSite(entry.entity)}
                      className={entry.entity === site ? "is-current" : undefined}
                    >
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <Dot tone={online ? "ok" : "crit"} />
                          {entry.entity}
                          <span className="visually-hidden">{online ? "online" : "offline"}</span>
                        </span>
                      </td>
                      <td>{fmt(kelvinToCelsius(payload.temperature_k as number), 1)}</td>
                      <td style={{ color: t.muted }}>{fmt(payload.humidity_pct as number, 0)}</td>
                      <td>{fmt(payload.wind_speed_ms as number, 1)}</td>
                      <td style={{ color: (payload.wind_gust_ms as number) >= 15 ? t.warn : t.muted }}>{fmt(payload.wind_gust_ms as number, 1)}</td>
                      <td style={{ color: (payload.battery_v as number) < 11.5 ? t.crit : t.muted }}>{fmt(payload.battery_v as number, 1)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <p style={{ margin: "8px 0 0", fontSize: 10, color: t.muted2 }}>
            Timestamp of newest sample: {fmtTime(weather[0]?.item.observedAt ?? null)} UTC
          </p>
        </Panel>
      </div>

      <div className="stack">
        <Panel title="Temperature by site" subtitle="instantaneous comparison">
          <BarChart data={siteBars} digits={1} unit="°C" />
        </Panel>

        <Panel
          title="Soiling · lwm-4"
          subtitle="reference cell vs exposed cell"
          actions={<Badge tone={(soiling.soiling_ratio as number) < 0.95 ? "warn" : "ok"}>ratio {fmt(soiling.soiling_ratio as number, 3)}</Badge>}
        >
          <DetailRow label="Reference irradiance" value={`${fmtInt(soiling.reference_irradiance_wm2 as number)} W/m²`} />
          <DetailRow label="Exposed irradiance" value={`${fmtInt(soiling.exposed_irradiance_wm2 as number)} W/m²`} />
          <DetailRow label="Soiling ratio" value={fmt(soiling.soiling_ratio as number, 3)} />
          <div style={{ marginTop: 10 }}>
            <ControlList
              topology={topology}
              entity="lwm-4"
              onSubmit={onSubmit}
              disabled={Boolean(replayAt)}
              currentValues={{ clean_reference_cell: false }}
            />
          </div>
        </Panel>

        <Panel
          title="Evaporation pan · lwm-5"
          subtitle="pan level and refill workflow"
          actions={<Badge tone={(pan.pan_level_mm as number) < 175 ? "warn" : "ok"}>{fmt(pan.pan_level_mm as number, 1)} mm</Badge>}
        >
          <Gauge
            value={numOr(pan.pan_level_mm)}
            min={150}
            max={230}
            unit="mm"
            digits={1}
            label="Pan level - refill below 175 mm"
            tone={(pan.pan_level_mm as number) < 175 ? "warn" : "ok"}
          />
          <div style={{ marginTop: 8 }}>
            <Meter
              value={
                pan.pan_level_mm === undefined
                  ? undefined
                  : Math.max(0, Math.min(100, (((pan.pan_level_mm as number) - 175) / (230 - 175)) * 100))
              }
              label="Headroom inside the 175–230 mm band"
            />
          </div>
          <div style={{ marginTop: 8 }}>
            <DetailRow label="Evaporation" value={`${fmt(pan.evaporation_mm as number, 2)} mm`} />
            <DetailRow label="Last refill" value={fmtTime((snapshot.topics.get("arl/lwm/lwm-5/state/last_refill")?.payload.value as string) ?? null)} />
          </div>
          <div style={{ marginTop: 10 }}>
            <ControlList
              topology={topology}
              entity="lwm-5"
              onSubmit={onSubmit}
              disabled={Boolean(replayAt)}
              currentValues={{ refill_pan: false }}
            />
          </div>
        </Panel>
      </div>
    </>
  );
}
