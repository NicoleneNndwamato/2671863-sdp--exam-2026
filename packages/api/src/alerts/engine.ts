import type { AlertSeverity, ParsedMessage } from "@sdp/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "../db/client";
import { alerts } from "../db/schema";
import { recordAudit } from "../db/audit";
import { getAlertLimits, type AlertLimits } from "./limits";

/**
 * Alert engine.
 *
 * Thresholds are read from the ARL API (`/v1/alert-limits/{service}`) and every
 * comparison below names a field the service actually publishes - the field
 * lists come from the retained `$topology` documents, so a threshold key and a
 * telemetry key are the same vocabulary.
 *
 * Evaluation is split from persistence on purpose: `evaluate()` is pure and
 * cheap, so it can be unit-tested against captured payloads, and the database is
 * only touched when a rule actually fires.
 */

export interface AlertDecision {
  /** Stable identifier stored on the alert row, e.g. `dish_overtemp`. */
  code: string;
  severity: AlertSeverity;
  cause: string;
}

function limit(limits: AlertLimits, key: string, fallback: number): number {
  const value = limits.get(key);
  return typeof value === "number" ? value : fallback;
}

function num(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" ? value : undefined;
}

function fixed(value: number, digits = 1): string {
  return value.toFixed(digits);
}

/**
 * Pure rule evaluation for one message. Exported so tests can assert against
 * the captured telemetry without a broker or a database.
 */
export function evaluate(message: ParsedMessage, limits: AlertLimits): AlertDecision[] {
  const decisions: AlertDecision[] = [];
  const { data, device, service } = message;
  const label = device ?? "service";

  // A `state` message carries a single item: `{ item, value }`.
  const isState = data._kind === "state";
  const stateItem = str(data, "item");
  const stateValue = data.value;

  if (service === "rta") {
    const temperature = num(data, "temperature_k");
    if (temperature !== undefined) {
      const crit = limit(limits, "dish_temperature.crit_k", 343);
      const warn = limit(limits, "dish_temperature.warn_k", 333);
      if (temperature >= crit) {
        decisions.push({
          code: "dish_overtemp",
          severity: "critical",
          cause: `${label} drive temperature ${fixed(temperature)} K is at or above the ${fixed(crit)} K critical limit`
        });
      } else if (temperature >= warn) {
        decisions.push({
          code: "dish_overtemp",
          severity: "warning",
          cause: `${label} drive temperature ${fixed(temperature)} K exceeds the ${fixed(warn)} K warning limit`
        });
      }
    }

    const power = num(data, "power_w");
    const maxPower = limit(limits, "dish_power.max_w", 5000);
    if (power !== undefined && power > maxPower) {
      decisions.push({
        code: "dish_power",
        severity: "warning",
        cause: `${label} drawing ${fixed(power, 0)} W, above the ${fixed(maxPower, 0)} W limit`
      });
    }

    const fault = str(data, "fault_code");
    if (fault !== undefined && fault !== "none") {
      decisions.push({
        code: "dish_fault",
        severity: "critical",
        cause: `${label} reported fault code "${fault}"`
      });
    }

    const snr = num(data, "snr_db");
    const minSnr = limit(limits, "scan.min_snr_db", 3);
    if (snr !== undefined && snr < minSnr) {
      decisions.push({
        code: "scan_low_snr",
        severity: "warning",
        cause: `${label} scan SNR ${fixed(snr)} dB is below the ${fixed(minSnr)} dB minimum`
      });
    }

    if (isState && stateItem === "wind_stow" && stateValue === true) {
      decisions.push({
        code: "wind_stow",
        severity: "warning",
        cause: "Array is in wind-stow: dishes were parked because gusts exceeded the stow limit"
      });
    }
  }

  if (service === "lwm") {
    // Gusts are what actually parks the dishes, so they lead the wind rule.
    const gust = num(data, "wind_gust_ms") ?? num(data, "wind_speed_ms");
    if (gust !== undefined) {
      const crit = limit(limits, "high_wind.crit_ms", 20);
      const warn = limit(limits, "high_wind.warn_ms", 15);
      if (gust >= crit) {
        decisions.push({
          code: "high_wind",
          severity: "critical",
          cause: `${label} gusting ${fixed(gust)} m/s, at or above the ${fixed(crit)} m/s critical limit`
        });
      } else if (gust >= warn) {
        decisions.push({
          code: "high_wind",
          severity: "warning",
          cause: `${label} gusting ${fixed(gust)} m/s, above the ${fixed(warn)} m/s warning limit`
        });
      }
    }

    const battery = num(data, "battery_v");
    const minBattery = limit(limits, "battery.min_v", 11.5);
    if (battery !== undefined && battery < minBattery) {
      decisions.push({
        code: "battery_low",
        severity: "warning",
        cause: `${label} battery at ${fixed(battery, 2)} V, below the ${fixed(minBattery, 2)} V limit`
      });
    }

    const temperature = num(data, "temperature_k");
    if (temperature !== undefined) {
      const max = limit(limits, "temperature.max_k", 313);
      const min = limit(limits, "temperature.min_k", 268);
      if (temperature > max) {
        decisions.push({
          code: "temperature_high",
          severity: "warning",
          cause: `${label} air temperature ${fixed(temperature)} K exceeds the ${fixed(max)} K limit`
        });
      } else if (temperature < min) {
        decisions.push({
          code: "temperature_low",
          severity: "warning",
          cause: `${label} air temperature ${fixed(temperature)} K is below the ${fixed(min)} K limit`
        });
      }
    }

    const soiling = num(data, "soiling_ratio");
    const minSoiling = limit(limits, "soiling.min_ratio", 0.95);
    if (soiling !== undefined && soiling < minSoiling) {
      decisions.push({
        code: "soiling_high",
        severity: "info",
        cause: `${label} reference cell reads ${fixed(soiling, 3)} of the exposed cell - cleaning recommended (limit ${fixed(minSoiling, 3)})`
      });
    }

    const rain = num(data, "rainfall_mm");
    const maxRain = limit(limits, "rain.max_mm_h", 10);
    if (rain !== undefined && rain > maxRain) {
      decisions.push({
        code: "heavy_rain",
        severity: "warning",
        cause: `${label} recorded ${fixed(rain)} mm of rain in the sampling interval (limit ${fixed(maxRain)} mm/h)`
      });
    }

    const nearest = num(data, "nearest_strike_km");
    if (nearest !== undefined) {
      const maxLightning = limit(limits, "lightning.max_km", 10);
      const approach = limit(limits, "storm.approach_km", 25);
      if (nearest <= maxLightning) {
        decisions.push({
          code: "lightning_near",
          severity: "critical",
          cause: `Lightning strike ${fixed(nearest)} km from ${label}, inside the ${fixed(maxLightning)} km limit`
        });
      } else if (nearest <= approach) {
        decisions.push({
          code: "storm_approach",
          severity: "warning",
          cause: `Storm cell ${fixed(nearest)} km from ${label}, within the ${fixed(approach)} km approach radius`
        });
      }
    }

    const pan = num(data, "pan_level_mm");
    if (pan !== undefined) {
      const maxPan = limit(limits, "pan.max_mm", 230);
      const minPan = limit(limits, "pan.min_mm", 175);
      if (pan > maxPan) {
        decisions.push({
          code: "pan_level",
          severity: "info",
          cause: `${label} evaporation pan at ${fixed(pan)} mm, above the ${fixed(maxPan)} mm limit`
        });
      } else if (pan < minPan) {
        decisions.push({
          code: "pan_level",
          severity: "warning",
          cause: `${label} evaporation pan at ${fixed(pan)} mm, below the ${fixed(minPan)} mm limit - refill required`
        });
      }
    }
  }

  if (service === "opg") {
    const soc = num(data, "state_of_charge_pct");
    const warnSoc = limit(limits, "battery.warn_pct", 30);
    if (soc !== undefined && soc < warnSoc) {
      decisions.push({
        code: "battery_low",
        severity: "warning",
        cause: `Battery bank at ${fixed(soc)}% state of charge, below the ${fixed(warnSoc)}% reserve`
      });
    }

    const batteryTemp = num(data, "battery_temperature_k");
    const maxBatteryTemp = limit(limits, "battery.max_temp_k", 318);
    if (batteryTemp !== undefined && batteryTemp > maxBatteryTemp) {
      decisions.push({
        code: "battery_overtemp",
        severity: "critical",
        cause: `Battery bank at ${fixed(batteryTemp)} K, above the ${fixed(maxBatteryTemp)} K limit`
      });
    }

    const fuel = num(data, "fuel_level_pct");
    const minFuel = limit(limits, "fuel.min_pct", 25);
    if (fuel !== undefined && fuel < minFuel) {
      decisions.push({
        code: "fuel_low",
        severity: "warning",
        cause: `Diesel at ${fixed(fuel)}%, below the ${fixed(minFuel)}% reserve - refuel required`
      });
    }

    if (str(data, "generator_status") === "fault") {
      decisions.push({
        code: "generator_fault",
        severity: "critical",
        cause: "Diesel generator reported a fault while in the supply chain"
      });
    }

    if (str(data, "inverter_status") === "fault") {
      decisions.push({
        code: "inverter_fault",
        severity: "critical",
        cause: "Solar inverter reported a fault - array output is unavailable"
      });
    }

    if (isState && stateItem === "load_shed" && stateValue === true) {
      decisions.push({
        code: "load_shed",
        severity: "critical",
        cause: "Load shedding active: demand exceeds generation and non-critical loads were dropped"
      });
    }
  }

  return decisions;
}

/**
 * Per-service+device+code throttle. The RTA firehose is ~100 messages/second
 * during a scan; without this every message would trigger a database round trip
 * to check whether an identical alert is already open.
 */
const THROTTLE_MS = 60_000;
const lastRaised = new Map<string, number>();

function recentlyRaised(key: string): boolean {
  const at = lastRaised.get(key);
  return at !== undefined && Date.now() - at < THROTTLE_MS;
}

/**
 * Evaluate a message and persist any firing rules. Fire-and-forget: an alert
 * failure must never stall or drop the ingest pipeline.
 */
export async function evaluateAlerts(message: ParsedMessage): Promise<void> {
  // Backfilled samples describe the past. Raising live alerts from them would
  // page an operator about a temperature that has long since recovered.
  if (message.data.backfill === true) return;

  let limits: AlertLimits;
  try {
    limits = await getAlertLimits(message.service);
  } catch (err) {
    console.error(`Alert limits unavailable for ${message.service}:`, err);
    return;
  }

  let decisions: AlertDecision[];
  try {
    decisions = evaluate(message, limits);
  } catch (err) {
    console.error("Alert rule evaluation failed:", err);
    return;
  }

  for (const decision of decisions) {
    const key = `${message.service}|${message.device ?? ""}|${decision.code}`;
    if (recentlyRaised(key)) continue;

    try {
      const deviceFilter = message.device
        ? eq(alerts.device, message.device)
        : isNull(alerts.device);

      // An open alert for this exact condition already tells the operator
      // everything a duplicate would; only status changes create new rows.
      const open = await db
        .select({ id: alerts.id })
        .from(alerts)
        .where(
          and(
            eq(alerts.service, message.service),
            deviceFilter,
            eq(alerts.code, decision.code),
            ne(alerts.status, "resolved")
          )
        )
        .limit(1);

      if (open.length > 0) {
        lastRaised.set(key, Date.now());
        continue;
      }

      await db.insert(alerts).values({
        service: message.service,
        device: message.device ?? null,
        code: decision.code,
        severity: decision.severity,
        cause: decision.cause,
        status: "raised"
      });

      // Raising an alert is an event on the record too, not just an in-memory
      // side effect: the audit trail has to explain why the annunciator lit up.
      await recordAudit({
        actor: "system",
        action: `alert.${decision.code}`,
        service: message.service,
        entity: message.device ?? null,
        detail: decision.cause,
        result: "raised",
        topic: message.topic,
        value: message.data
      });

      lastRaised.set(key, Date.now());
      console.log(`[ALERT] ${decision.severity.toUpperCase()} ${message.service}: ${decision.cause}`);
    } catch (err) {
      console.error(`Failed to raise alert ${decision.code}:`, err);
    }
  }
}
