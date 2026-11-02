import type { AlertLimits } from "../src/alerts/limits";
import { evaluate } from "../src/alerts/engine";
import type { ParsedMessage, ServiceId } from "@sdp/shared";

/**
 * Thresholds mirror `GET /v1/alert-limits/{service}` as it answered on the day
 * of the exam. The engine is tested against the API's vocabulary, not against
 * numbers invented in this repository.
 */
function limits(entries: Record<string, number>): AlertLimits {
  return new Map(Object.entries(entries));
}

const rtaLimits = limits({
  "dish_temperature.crit_k": 343,
  "dish_temperature.warn_k": 333,
  "dish_power.max_w": 5000,
  "scan.min_snr_db": 3
});

const lwmLimits = limits({
  "battery.min_v": 11.5,
  "high_wind.crit_ms": 20,
  "high_wind.warn_ms": 15,
  "lightning.max_km": 10,
  "pan.max_mm": 230,
  "pan.min_mm": 175,
  "rain.max_mm_h": 10,
  "soiling.min_ratio": 0.95,
  "storm.approach_km": 25,
  "temperature.max_k": 313,
  "temperature.min_k": 268
});

const opgLimits = limits({
  "battery.max_temp_k": 318,
  "battery.warn_pct": 30,
  "fuel.min_pct": 25
});

function message(service: ServiceId, device: string, data: Record<string, unknown>): ParsedMessage {
  return {
    service,
    device,
    topic: `arl/${service}/${device}/telemetry/x`,
    observedAt: new Date(),
    data
  };
}

describe("RTA alert rules", () => {
  it("does not fire on a healthy dish", () => {
    const decisions = evaluate(
      message("rta", "dish-001", {
        _kind: "telemetry",
        temperature_k: 300,
        power_w: 1200,
        fault_code: "none",
        status: true
      }),
      rtaLimits
    );

    expect(decisions).toEqual([]);
  });

  it("escalates dish temperature from warning to critical", () => {
    const warn = evaluate(message("rta", "dish-001", { temperature_k: 335 }), rtaLimits);
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ code: "dish_overtemp", severity: "warning" });

    const crit = evaluate(message("rta", "dish-001", { temperature_k: 350 }), rtaLimits);
    expect(crit[0]).toMatchObject({ code: "dish_overtemp", severity: "critical" });
  });

  it("fires on a non-none fault code and on excess power draw", () => {
    const decisions = evaluate(
      message("rta", "dish-042", { fault_code: "drive_stall", power_w: 6000 }),
      rtaLimits
    );

    expect(decisions.map((d) => d.code).sort()).toEqual(["dish_fault", "dish_power"]);
  });

  it("flags a scan whose SNR is below the API minimum", () => {
    const decisions = evaluate(message("rta", "dish-007", { snr_db: 1.4 }), rtaLimits);
    expect(decisions[0]).toMatchObject({ code: "scan_low_snr", severity: "warning" });
  });
});

describe("LWM alert rules", () => {
  it("uses gusts for the wind rule and escalates at the critical limit", () => {
    const warn = evaluate(message("lwm", "lwm-1", { wind_gust_ms: 16 }), lwmLimits);
    expect(warn[0]).toMatchObject({ code: "high_wind", severity: "warning" });

    const crit = evaluate(message("lwm", "lwm-1", { wind_gust_ms: 21 }), lwmLimits);
    expect(crit[0]).toMatchObject({ code: "high_wind", severity: "critical" });
  });

  it("distinguishes a nearby strike from an approaching storm", () => {
    const near = evaluate(message("lwm", "lwm-2", { nearest_strike_km: 4 }), lwmLimits);
    expect(near[0]).toMatchObject({ code: "lightning_near", severity: "critical" });

    const approach = evaluate(message("lwm", "lwm-2", { nearest_strike_km: 18 }), lwmLimits);
    expect(approach[0]).toMatchObject({ code: "storm_approach", severity: "warning" });
  });

  it("flags a low battery and a dirty reference cell", () => {
    const decisions = evaluate(
      message("lwm", "lwm-4", { battery_v: 11.2, soiling_ratio: 0.91 }),
      lwmLimits
    );

    expect(decisions.map((d) => d.code).sort()).toEqual(["battery_low", "soiling_high"]);
  });
});

describe("OPG alert rules", () => {
  it("fires on low reserve, low fuel and a generator fault together", () => {
    const decisions = evaluate(
      message("opg", "batteries", { state_of_charge_pct: 22, battery_temperature_k: 320 }),
      opgLimits
    );
    expect(decisions.map((d) => d.code).sort()).toEqual(["battery_low", "battery_overtemp"]);

    const fuel = evaluate(message("opg", "diesel", { fuel_level_pct: 18 }), opgLimits);
    expect(fuel[0]).toMatchObject({ code: "fuel_low", severity: "warning" });

    const fault = evaluate(message("opg", "diesel", { generator_status: "fault" }), opgLimits);
    expect(fault[0]).toMatchObject({ code: "generator_fault", severity: "critical" });
  });

  it("raises load shedding from a state message", () => {
    const decisions = evaluate(
      {
        service: "opg",
        device: "global",
        topic: "arl/opg/global/state/load_shed",
        observedAt: new Date(),
        data: { _kind: "state", item: "load_shed", value: true }
      },
      opgLimits
    );

    expect(decisions[0]).toMatchObject({ code: "load_shed", severity: "critical" });
  });
});
