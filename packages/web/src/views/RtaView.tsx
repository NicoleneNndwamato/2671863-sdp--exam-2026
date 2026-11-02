import { useEffect, useMemo, useState } from "react";
import { useTheme } from "../theme-provider";
import { Badge, Btn, DetailRow, Empty, Field, Kpi, Panel } from "../components/ui";
import { LineChart } from "../components/charts";
import { DishGrid } from "../components/DishGrid";
import { ScanImage } from "../components/ScanImage";
import { ControlList } from "../components/ControlPanel";
import { fmt, fmtInt, fmtTime, kelvinToCelsius } from "../format";
import { entitiesOfKind, numOf, seriesFrom, stateBool, stateNumber, stateOf } from "../snapshot";
import type { ViewProps } from "../view-types";

/**
 * Radio Telescope Array.
 *
 * The array is the biggest thing on site and the busiest thing on the broker
 * (~100 messages/second during a scan), so this panel is organised around two
 * questions an operator actually asks: "is any dish unhappy?" (the grid) and
 * "is the current scan producing signal?" (the scan viewer).
 */
export function RtaView({ topology, snapshot, history, onSubmit, canControl, actHint, targets, replayAt }: ViewProps) {
  const { theme: t } = useTheme();
  const [selected, setSelected] = useState<string | null>(null);

  const dishes = entitiesOfKind(topology, "dish");
  const dishId = selected ?? dishes[0]?.id ?? "dish-001";

  const stats = useMemo(() => {
    const temps: number[] = [];
    const powers: number[] = [];
    let faults = 0;
    let enabled = 0;

    for (const dish of dishes) {
      const normal = `arl/rta/${dish.id}/telemetry/normal`;
      const scan = `arl/rta/${dish.id}/telemetry/scan`;
      const temp = numOf(snapshot, normal, "temperature_k") ?? numOf(snapshot, scan, "temperature_k");
      const power = numOf(snapshot, normal, "power_w") ?? numOf(snapshot, scan, "power_w");
      const fault = (snapshot.topics.get(normal)?.payload.fault_code ?? snapshot.topics.get(scan)?.payload.fault_code) as
        | string
        | undefined;
      if (temp !== undefined) temps.push(temp);
      if (power !== undefined) powers.push(power);
      if (fault !== undefined && fault !== "none") faults += 1;
      if (stateBool(snapshot, `arl/rta/${dish.id}/state/enabled`) !== false) enabled += 1;
    }

    const avg = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : undefined;
    const max = temps.length > 0 ? Math.max(...temps) : undefined;
    const totalPower = powers.length > 0 ? powers.reduce((a, b) => a + b, 0) : undefined;
    return { avg, max, totalPower, faults, enabled };
  }, [dishes, snapshot]);

  const normalTopic = `arl/rta/${dishId}/telemetry/normal`;
  const scanTopic = `arl/rta/${dishId}/telemetry/scan`;
  const dishPayload = snapshot.topics.get(scanTopic)?.payload ?? snapshot.topics.get(normalTopic)?.payload;
  const dishObservedAt = snapshot.topics.get(scanTopic)?.observedAt ?? snapshot.topics.get(normalTopic)?.observedAt ?? null;

  const windStow = stateBool(snapshot, "arl/rta/global/state/wind_stow");
  const activeDishes = stateNumber(snapshot, "arl/rta/global/state/active_dishes");
  const scanState = stateOf(snapshot, "arl/rta/main/state/scan_state");
  const scanId = stateOf(snapshot, `arl/rta/${dishId}/state/scan_id`) ?? stateOf(snapshot, "arl/rta/main/state/scan_id");
  const target = stateOf(snapshot, "arl/rta/main/state/target") as
    | { ra_rad?: number; dec_rad?: number; fov_rad?: number; name?: string }
    | undefined;

  // The charts are read in Celsius because that is what an operator thinks in;
  // the wire format is kelvin. Empty streams stay empty - the array only emits
  // `scan` while a scan is running.
  const toCelsius = (points: Array<{ x: number; y: number }>) => points.map((p) => ({ x: p.x, y: p.y - 273.15 }));

  const temperatureSeries = useMemo(
    () => toCelsius(seriesFrom(history, { kind: "telemetry", name: "scan", field: "temperature_k", entity: dishId })),
    [history, dishId]
  );
  const normalSeries = useMemo(
    () => toCelsius(seriesFrom(history, { kind: "telemetry", name: "normal", field: "temperature_k", entity: dishId })),
    [history, dishId]
  );
  const snrSeries = useMemo(
    () => seriesFrom(history, { kind: "telemetry", name: "scan", field: "snr_db", entity: dishId }),
    [history, dishId]
  );

  const faultCode = (dishPayload?.fault_code as string | undefined) ?? "none";
  const hasFault = faultCode !== "none";

  /**
   * Picking a dish should have a visible result at any window height. The detail
   * and controls cards sit under the 100-cell grid, so a selection brings them
   * into view. This runs in an effect rather than a click handler because the
   * card has to exist before it can be scrolled to, and because scroll animation
   * frames are suspended in a background tab.
   */
  useEffect(() => {
    if (!selected) return;
    document.getElementById("rta-dish-detail")?.scrollIntoView({ block: "start" });
  }, [selected]);

  return (
    <>
      <div className="kpi-row">
        <Kpi
          label="Active dishes"
          value={activeDishes !== undefined ? fmtInt(activeDishes) : fmtInt(stats.enabled)}
          unit={`/ ${dishes.length || 100}`}
          tone={activeDishes !== undefined && activeDishes < 80 ? "warn" : "neutral"}
          hint={replayAt ? undefined : "from global/state"}
        />
        <Kpi label="Scan state" value={typeof scanState === "string" ? scanState : "—"} hint={typeof scanId === "string" ? scanId : undefined} />
        <Kpi
          label="Wind stow"
          value={windStow === undefined ? "—" : windStow ? "STOWED" : "clear"}
          tone={windStow ? "crit" : "ok"}
          hint={windStow ? "array parked" : "gusts below limit"}
        />
        <Kpi
          label="Mean dish temp"
          value={stats.avg !== undefined ? fmt(kelvinToCelsius(stats.avg), 1) : "—"}
          unit="°C"
          tone={stats.max !== undefined && stats.max >= 343 ? "crit" : stats.max !== undefined && stats.max >= 333 ? "warn" : "neutral"}
          hint={`max ${stats.max !== undefined ? fmt(kelvinToCelsius(stats.max), 1) : "—"} °C`}
        />
        <Kpi label="Array power" value={stats.totalPower !== undefined ? fmt(stats.totalPower / 1000, 1) : "—"} unit="kW" hint="sum of dish draws" />
        <Kpi label="Faults" value={fmtInt(stats.faults)} tone={stats.faults > 0 ? "crit" : "ok"} hint="non-none fault codes" />
        <Kpi
          label="Target"
          value={target?.name ?? (target?.ra_rad !== undefined ? "custom" : "—")}
          hint={target?.ra_rad !== undefined ? `ra ${fmt(target.ra_rad, 3)} / dec ${fmt(target.dec_rad, 3)}` : "no target set"}
        />
      </div>

      <div className="stack">
        <Panel
          title="Dish array"
          subtitle={`${dishes.length} dishes · colour = drive temperature band, red = fault`}
          actions={<Badge tone={hasFault ? "crit" : "ok"}>{hasFault ? `${faultCode}` : "all clear"}</Badge>}
        >
          <DishGrid topology={topology} snapshot={snapshot} selected={selected} onSelect={setSelected} />
        </Panel>

        <div id="rta-dish-detail" style={{ display: "flex", flexDirection: "column", gap: 8, scrollMarginTop: 12 }}>
          <Panel
            title={`Dish ${dishId.replace("dish-", "")}`}
            subtitle={dishObservedAt ? `last sample ${fmtTime(dishObservedAt)} UTC` : "no sample yet"}
            actions={
              <Btn variant="ghost" onClick={() => setSelected(null)} title="Back to the whole array">
                Reset
              </Btn>
            }
          >
            {dishPayload ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                <DetailRow label="Drive temp" value={`${fmt(kelvinToCelsius(dishPayload.temperature_k as number), 1)} °C`} />
                <DetailRow
                  label="System temp"
                  value={
                    dishPayload.system_temperature_k === undefined
                      ? "—"
                      : `${fmt(dishPayload.system_temperature_k as number, 1)} °C`
                  }
                />
                <DetailRow label="Power" value={`${fmtInt(dishPayload.power_w as number)} W`} />
                <DetailRow label="Elevation" value={`${fmt(dishPayload.elevation_rad as number, 3)} rad`} />
                <DetailRow label="Azimuth" value={`${fmt(dishPayload.azimuth_rad as number, 3)} rad`} />
                <DetailRow label="Status" value={dishPayload.status === false ? "offline" : "online"} />
                <DetailRow label="SNR" value={dishPayload.snr_db !== undefined ? `${fmt(dishPayload.snr_db as number, 1)} dB` : "—"} />
                <DetailRow
                  label="Scan progress"
                  value={dishPayload.scan_progress !== undefined ? `${fmt((dishPayload.scan_progress as number) * 100, 0)}%` : "—"}
                />
                <DetailRow
                  label="Pointing offset"
                  value={
                    dishPayload.pointing_offset_ra_rad !== undefined
                      ? `${fmt(dishPayload.pointing_offset_ra_rad as number, 4)} / ${fmt(dishPayload.pointing_offset_dec_rad as number, 4)}`
                      : "—"
                  }
                />
                <DetailRow label="Fault" value={hasFault ? faultCode : "none"} />
              </div>
            ) : (
              <Empty>No telemetry received for this dish yet.</Empty>
            )}

            {hasFault ? (
              <div
                role="status"
                style={{
                  marginTop: 8,
                  padding: "6px 8px",
                  background: t.critBg,
                  border: `1px solid ${t.critBorder}`,
                  color: t.crit,
                  fontSize: 11
                }}
              >
                Fault <strong>{faultCode}</strong> reported. Stow the dish and dispatch maintenance.
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Dish controls"
            subtitle={canControl ? "actions are recorded against your code" : (actHint ?? "a researcher code is asked for when you send one")}
          >
            <ControlList
              topology={topology}
              entity={dishId}
              onSubmit={onSubmit}
              disabled={Boolean(replayAt)}
              currentValues={{
                enable_dish: stateBool(snapshot, `arl/rta/${dishId}/state/enabled`),
                stow_dish: stateBool(snapshot, `arl/rta/${dishId}/state/stowed`)
              }}
            />
          </Panel>
        </div>
      </div>

      <div className="stack">
        <ScanImage replayAt={replayAt} />
        <Panel title="Scan view" subtitle={`${dishId} signal-to-noise`}>
          <LineChart series={[{ label: "SNR (dB)", points: snrSeries, colour: t.chart2, fill: true }]} yDigits={1} unit="dB" height={140} />
        </Panel>
        <Panel title="Drive temperature" subtitle="drive sensor and normal stream, in °C">
          <LineChart
            series={[
              { label: "dish", points: temperatureSeries, colour: t.chart4 },
              { label: "dish (normal)", points: normalSeries, colour: t.chart6, dashed: true }
            ]}
            yDigits={1}
            unit="°C"
            height={140}
          />
        </Panel>
        <Panel title="Array control" subtitle="commands are published to arl/rta/cmd/…">
          <ControlList
            topology={topology}
            entity="main"
            onSubmit={onSubmit}
            disabled={Boolean(replayAt)}
            currentValues={{ start_scan: stateOf(snapshot, "arl/rta/main/state/scan_state") }}
          />
          {targets.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <Field label="Quick target" hint="sends set_target with the published field of view">
                <div style={{ display: "flex", gap: 6 }}>
                  <select
                    id="rta-quick-target"
                    onChange={(event) => {
                      const chosen = targets.find((candidate) => candidate.id === event.target.value);
                      if (chosen) {
                        void onSubmit("main", "set_target", { ra_rad: chosen.ra_rad, dec_rad: chosen.dec_rad, fov_rad: chosen.fov_rad });
                      }
                    }}
                    defaultValue=""
                    style={{
                      background: t.panelSunken,
                      border: `1px solid ${t.lineSoft}`,
                      color: t.text,
                      padding: "5px 8px",
                      flex: 1
                    }}
                  >
                    <option value="" disabled>
                      Select a target…
                    </option>
                    {targets.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
            </div>
          ) : null}
        </Panel>
      </div>
    </>
  );
}
