import { useMemo } from "react";
import { useTheme } from "../theme-provider";
import { Badge, DetailRow, Kpi, Panel } from "../components/ui";
import { BarChart, Gauge, LineChart, Meter, StackedBar } from "../components/charts";
import { ControlList } from "../components/ControlPanel";
import { fmt, fmtInt } from "../format";
import { numOf, seriesFrom, stateBool, stateNumber, stateOf } from "../snapshot";
import type { ViewProps } from "../view-types";

/**
 * On-demand Power Generation.
 *
 * Four entities publish the same `telemetry/power` stream with different field
 * sets: global (totals), solar (array), batteries (bank) and diesel (generator).
 * The panel reads each from the topic, so a field the service stops publishing
 * simply renders as a dash rather than breaking the page.
 */
export function PowerView({ topology, snapshot, history, onSubmit, canControl, replayAt }: ViewProps) {
  const { theme: t } = useTheme();

  const globalTopic = "arl/opg/global/telemetry/power";
  const solarTopic = "arl/opg/solar/telemetry/power";
  const batteryTopic = "arl/opg/batteries/telemetry/power";
  const dieselTopic = "arl/opg/diesel/telemetry/power";

  const generation = numOf(snapshot, globalTopic, "total_generation_w");
  const load = numOf(snapshot, globalTopic, "total_load_w");
  const mode = snapshot.topics.get(globalTopic)?.payload.supply_mode as string | undefined;

  const soc = numOf(snapshot, batteryTopic, "state_of_charge_pct");
  const batteryTemp = numOf(snapshot, batteryTopic, "battery_temperature_k");
  const batteryHealth = numOf(snapshot, batteryTopic, "battery_health_pct");
  const batteryFlow = numOf(snapshot, batteryTopic, "battery_power_w");

  const fuel = numOf(snapshot, dieselTopic, "fuel_level_pct");
  const dieselOutput = numOf(snapshot, dieselTopic, "power_output_w");
  const generatorStatus = snapshot.topics.get(dieselTopic)?.payload.generator_status as string | undefined;
  const runtime = numOf(snapshot, dieselTopic, "runtime_h");

  const solarOutput = numOf(snapshot, solarTopic, "power_output_w");
  const inverterStatus = snapshot.topics.get(solarTopic)?.payload.inverter_status as string | undefined;
  const irradiance = numOf(snapshot, solarTopic, "irradiance_wm2");

  const loadShed = stateBool(snapshot, "arl/opg/global/state/load_shed");
  const priority = stateOf(snapshot, "arl/opg/global/state/generation_priority");
  const reserve = stateNumber(snapshot, "arl/opg/batteries/state/reserve_pct");

  // Everything on this panel is read in kW; the wire format is watts.
  const toKw = (points: Array<{ x: number; y: number }>) => points.map((p) => ({ x: p.x, y: p.y / 1000 }));

  const solarSeries = useMemo(
    () => toKw(seriesFrom(history, { kind: "telemetry", name: "power", field: "power_output_w", entity: "solar" })),
    [history]
  );
  const dieselSeries = useMemo(
    () => toKw(seriesFrom(history, { kind: "telemetry", name: "power", field: "power_output_w", entity: "diesel" })),
    [history]
  );
  const loadSeries = useMemo(
    () => toKw(seriesFrom(history, { kind: "telemetry", name: "power", field: "total_load_w", entity: "global" })),
    [history]
  );
  const socSeries = useMemo(
    () => seriesFrom(history, { kind: "telemetry", name: "power", field: "state_of_charge_pct", entity: "batteries" }),
    [history]
  );

  return (
    <>
      <div className="kpi-row">
        <Kpi label="Generation" value={generation !== undefined ? fmt(generation / 1000, 1) : "—"} unit="kW" hint="all sources" />
        <Kpi
          label="Load"
          value={load !== undefined ? fmt(load / 1000, 1) : "—"}
          unit="kW"
          tone={generation !== undefined && load !== undefined && load > generation ? "crit" : "neutral"}
          hint={generation !== undefined && load !== undefined ? `${load > generation ? "deficit" : "surplus"} ${fmt(Math.abs(load - generation) / 1000, 1)} kW` : undefined}
        />
        <Kpi label="Supply mode" value={mode ?? "—"} tone={mode === "diesel" ? "warn" : "ok"} hint={typeof priority === "string" ? `priority ${priority}` : undefined} />
        <Kpi
          label="Battery"
          value={fmt(soc, 1)}
          unit="%"
          tone={soc !== undefined && soc < 30 ? "crit" : soc !== undefined && soc < 50 ? "warn" : "ok"}
          hint={
            batteryFlow !== undefined
              ? `${batteryFlow >= 0 ? "charging" : "discharging"} ${fmt(Math.abs(batteryFlow) / 1000, 1)} kW`
              : undefined
          }
        />
        <Kpi label="Diesel" value={fmt(fuel, 1)} unit="%" tone={fuel !== undefined && fuel < 25 ? "crit" : "ok"} hint={`${fmt(runtime, 1)} h runtime`} />
        <Kpi
          label="Generator"
          value={generatorStatus ?? "—"}
          tone={generatorStatus === "fault" ? "crit" : generatorStatus === "running" ? "warn" : "ok"}
          hint={dieselOutput !== undefined ? `${fmt(dieselOutput / 1000, 1)} kW` : undefined}
        />
        <Kpi
          label="Solar"
          value={solarOutput !== undefined ? fmt(solarOutput / 1000, 1) : "—"}
          unit="kW"
          tone={inverterStatus === "fault" ? "crit" : "ok"}
          hint={inverterStatus ? `inverter ${inverterStatus}` : `${fmtInt(irradiance)} W/m²`}
        />
      </div>

      {loadShed ? (
        <div
          role="status"
          style={{ padding: "8px 12px", background: t.critBg, border: `1px solid ${t.critBorder}`, color: t.crit, fontSize: 12 }}
        >
          <strong>Load shedding active.</strong> Non-critical loads have been dropped to protect the reserve.
        </div>
      ) : null}

      <div className="stack">
        {/* Where the generation went. Load plus a charging battery plus a
            running generator is the whole energy story in one bar. */}
        <Panel
          title="Energy flow"
          subtitle="generation split between the load and the battery bank"
          actions={<Badge tone={mode === "diesel" ? "warn" : "ok"}>{mode ?? "unknown"}</Badge>}
        >
          <StackedBar
            segments={[
              { label: "Load", value: (load ?? 0) / 1000, colour: t.chartLine },
              { label: "Charging", value: Math.max(0, (batteryFlow ?? 0) / 1000), colour: t.chart2 },
              { label: "Diesel", value: (dieselOutput ?? 0) / 1000, colour: t.chart5 }
            ]}
          />
          <div className="split" style={{ marginTop: 14 }}>
            <Gauge
              value={soc}
              min={0}
              max={100}
              label="Battery state of charge"
              tone={soc !== undefined && soc < 30 ? "crit" : soc !== undefined && soc < 50 ? "warn" : "ok"}
            />
            <Gauge
              value={fuel}
              min={0}
              max={100}
              label="Diesel reserve"
              tone={fuel !== undefined && fuel < 25 ? "crit" : fuel !== undefined && fuel < 50 ? "warn" : "ok"}
            />
          </div>
        </Panel>

        <Panel title="Output by source" subtitle="instantaneous, in kW">
          <BarChart
            data={[
              { label: "solar", value: solarOutput !== undefined ? solarOutput / 1000 : undefined, colour: t.chart5 },
              { label: "battery", value: batteryFlow !== undefined ? Math.abs(batteryFlow) / 1000 : undefined, colour: t.chart2 },
              { label: "diesel", value: dieselOutput !== undefined ? dieselOutput / 1000 : undefined, colour: t.chart8 },
              { label: "load", value: load !== undefined ? load / 1000 : undefined, colour: t.chartLine }
            ]}
            digits={0}
            unit="kW"
            height={140}
          />
          <p style={{ margin: "8px 0 0", fontSize: 10, color: t.muted2 }}>
            Battery is shown as magnitude; the bank is currently{" "}
            {batteryFlow !== undefined && batteryFlow >= 0 ? "charging" : "discharging"}.
          </p>
        </Panel>

        <Panel
          title="Generation vs load"
          subtitle="solar array, diesel generator and total demand"
          actions={<Badge tone={mode === "diesel" ? "warn" : "info"}>{mode ?? "unknown"}</Badge>}
        >
          <LineChart
            series={[
              { label: "solar (kW)", points: solarSeries, colour: t.chart5, fill: true },
              { label: "diesel (kW)", points: dieselSeries, colour: t.chart8, dashed: true },
              { label: "total load (kW)", points: loadSeries, colour: t.chartLine }
            ]}
            yDigits={0}
            unit="kW"
            height={170}
          />
          <div style={{ marginTop: 10 }}>
            <LineChart series={[{ label: "battery state of charge (%)", points: socSeries, colour: t.chart2 }]} yDigits={1} unit="%" height={110} />
          </div>
        </Panel>

        <Panel title="Storage & supply" subtitle="battery bank and generator detail">
          <Meter value={batteryHealth} label="Battery health" tone="info" />
          <div style={{ height: 8 }} />
          <Meter
            value={reserve !== undefined && soc !== undefined && reserve > 0 ? Math.min(100, (soc / reserve) * 100) : undefined}
            label="Headroom above the reserve floor"
            tone={soc !== undefined && reserve !== undefined && soc < reserve + 10 ? "crit" : "ok"}
          />
          <div style={{ marginTop: 10 }}>
            <DetailRow label="Battery flow" value={batteryFlow !== undefined ? `${fmt(batteryFlow / 1000, 1)} kW` : "—"} />
            <DetailRow label="Battery temperature" value={`${fmt(batteryTemp !== undefined ? batteryTemp - 273.15 : undefined, 1)} °C`} />
            <DetailRow label="Reserve floor" value={reserve !== undefined ? `${fmt(reserve, 0)}%` : "—"} />
            <DetailRow label="Solar enabled" value={stateBool(snapshot, "arl/opg/solar/state/enabled") === false ? "no" : "yes"} />
            <DetailRow label="Irradiance" value={`${fmtInt(irradiance)} W/m²`} />
            <DetailRow label="Generator runtime" value={`${fmt(runtime, 1)} h`} />
          </div>
        </Panel>
      </div>

      <div className="stack">
        <Panel title="Supply policy" subtitle="global controls">
          <ControlList
            topology={topology}
            entity="global"
            onSubmit={onSubmit}
            disabled={Boolean(replayAt)}
            currentValues={{ load_shed: loadShed, generation_priority: priority }}
          />
        </Panel>
        <Panel title="Solar array" subtitle="arl/opg/cmd/solar/…">
          <ControlList
            topology={topology}
            entity="solar"
            onSubmit={onSubmit}
            disabled={Boolean(replayAt)}
            currentValues={{ enable_solar_array: stateBool(snapshot, "arl/opg/solar/state/enabled") }}
          />
        </Panel>
        <Panel title="Generator & reserve" subtitle="diesel and bank controls">
          <ControlList
            topology={topology}
            entity="diesel"
            onSubmit={onSubmit}
            disabled={Boolean(replayAt)}
          />
          <div style={{ height: 10 }} />
          <ControlList topology={topology} entity="batteries" onSubmit={onSubmit} disabled={Boolean(replayAt)} />
        </Panel>
      </div>
    </>
  );
}
