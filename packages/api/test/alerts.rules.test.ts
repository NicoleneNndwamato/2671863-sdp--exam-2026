import type { ParsedMessage, ServiceId } from "@sdp/shared";
import { evaluate } from "../src/alerts/engine";
import type { AlertLimits } from "../src/alerts/limits";

/**
 * The rules alerts.engine.test.ts does not reach: the lower bounds, the
 * state-driven alerts, and the guards that stop malformed telemetry from
 * raising anything. Limits are the seed values from the ARL API
 * (seed/alert_limits.toml), so a test here reads like the spec sheet.
 */
const seed: Record<string, AlertLimits> = {
  rta: new Map(Object.entries({ "dish_temperature.warn_k": 333, "dish_temperature.crit_k": 343 })),
  lwm: new Map(
    Object.entries({
      "high_wind.warn_ms": 15,
      "high_wind.crit_ms": 20,
      "temperature.min_k": 268,
      "temperature.max_k": 313,
      "rain.max_mm_h": 10,
      "pan.min_mm": 175,
      "pan.max_mm": 230
    })
  ),
  opg: new Map(Object.entries({ "battery.warn_pct": 30, "battery.max_temp_k": 318, "fuel.min_pct": 25 }))
};

function telemetry(service: ServiceId, device: string | undefined, data: Record<string, unknown>): ParsedMessage {
  return {
    service,
    device,
    topic: `arl/${service}/${device ?? "global"}/telemetry/x`,
    observedAt: new Date(),
    data: { _kind: "telemetry", ...data }
  };
}

function state(service: ServiceId, device: string, item: string, value: unknown): ParsedMessage {
  return {
    service,
    device,
    topic: `arl/${service}/${device}/state/${item}`,
    observedAt: new Date(),
    data: { _kind: "state", item, value }
  };
}

const codes = (m: ParsedMessage, l: AlertLimits = seed[m.service]) => evaluate(m, l).map((d) => d.code);

describe("thresholds are boundaries, not approximations", () => {
  it.each([
    [332.9, []],
    [333, ["warning"]],
    [342.9, ["warning"]],
    [343, ["critical"]]
  ])("dish at %s K -> %j", (k, severities) => {
    const decisions = evaluate(telemetry("rta", "dish-042", { temperature_k: k }), seed.rta);
    expect(decisions.map((d) => d.severity)).toEqual(severities);
  });

  it.each([
    [14.9, []],
    [15, ["warning"]],
    [20, ["critical"]]
  ])("gust of %s m/s -> %j", (gust, severities) => {
    const decisions = evaluate(telemetry("lwm", "lwm-1", { wind_gust_ms: gust }), seed.lwm);
    expect(decisions.map((d) => d.severity)).toEqual(severities);
  });
});

describe("RTA", () => {
  it("raises wind-stow from the array's state item", () => {
    const [decision] = evaluate(state("rta", "array", "wind_stow", true), seed.rta);
    expect(decision).toMatchObject({ code: "wind_stow", severity: "warning" });
  });

  it("stays quiet when wind-stow is released", () => {
    expect(codes(state("rta", "array", "wind_stow", false))).toEqual([]);
  });

  it("ignores a telemetry field that merely happens to be called item", () => {
    expect(codes(telemetry("rta", "array", { item: "wind_stow", value: true }))).toEqual([]);
  });

  it("uses the baked-in limits when the API sent none", () => {
    const [decision] = evaluate(telemetry("rta", "dish-001", { temperature_k: 343 }), new Map());
    expect(decision.severity).toBe("critical");
    expect(decision.cause).toContain("343.0 K critical limit");
  });

  it("does not treat a fault code of none as a fault", () => {
    expect(codes(telemetry("rta", "dish-001", { fault_code: "none" }))).toEqual([]);
  });
});

describe("LWM", () => {
  it("falls back to sustained wind speed when no gust is reported", () => {
    expect(codes(telemetry("lwm", "lwm-2", { wind_speed_ms: 16 }))).toEqual(["high_wind"]);
  });

  it("flags heat and cold separately", () => {
    expect(evaluate(telemetry("lwm", "lwm-1", { temperature_k: 314 }), seed.lwm)[0]).toMatchObject({
      code: "temperature_high",
      severity: "warning"
    });
    expect(evaluate(telemetry("lwm", "lwm-1", { temperature_k: 267 }), seed.lwm)[0]).toMatchObject({
      code: "temperature_low",
      severity: "warning"
    });
    expect(codes(telemetry("lwm", "lwm-1", { temperature_k: 290 }))).toEqual([]);
  });

  it("raises heavy rain above the rate limit", () => {
    const [decision] = evaluate(telemetry("lwm", "lwm-4", { rainfall_mm: 12.5 }), seed.lwm);
    expect(decision).toMatchObject({ code: "heavy_rain", severity: "warning" });
    expect(decision.cause).toContain("12.5 mm");
  });

  it("treats an overfull pan as information and an empty one as work to do", () => {
    expect(evaluate(telemetry("lwm", "lwm-3", { pan_level_mm: 231 }), seed.lwm)[0]).toMatchObject({
      code: "pan_level",
      severity: "info"
    });
    const [low] = evaluate(telemetry("lwm", "lwm-3", { pan_level_mm: 170 }), seed.lwm);
    expect(low).toMatchObject({ code: "pan_level", severity: "warning" });
    expect(low.cause).toContain("refill required");
    expect(codes(telemetry("lwm", "lwm-3", { pan_level_mm: 200 }))).toEqual([]);
  });

  it("can raise several alerts from one sample", () => {
    expect(
      codes(telemetry("lwm", "lwm-5", { wind_gust_ms: 22, temperature_k: 320, rainfall_mm: 30 }))
    ).toEqual(["high_wind", "temperature_high", "heavy_rain"]);
  });
});

describe("OPG", () => {
  it("raises a battery over-temperature as critical", () => {
    expect(evaluate(telemetry("opg", "batteries", { battery_temperature_k: 320 }), seed.opg)[0]).toMatchObject({
      code: "battery_overtemp",
      severity: "critical"
    });
  });

  it("raises an inverter fault", () => {
    expect(codes(telemetry("opg", "solar", { inverter_status: "fault" }))).toEqual(["inverter_fault"]);
    expect(codes(telemetry("opg", "solar", { inverter_status: "ok" }))).toEqual([]);
  });

  it("does not raise load shedding when it ends", () => {
    expect(codes(state("opg", "global", "load_shed", false))).toEqual([]);
  });

  it("matches the 25% scenario event (battery bank set to 25% charge)", () => {
    // scenarios/example.toml: opg batteries set_state soc_pct = 25.0
    expect(codes(telemetry("opg", "batteries", { state_of_charge_pct: 25 }))).toEqual(["battery_low"]);
  });
});

describe("malformed telemetry raises nothing", () => {
  it.each([
    ["a string", "345"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["null", null]
  ])("temperature given as %s", (_label, value) => {
    expect(codes(telemetry("rta", "dish-001", { temperature_k: value }))).toEqual([]);
  });

  it("ignores services it has no rules for", () => {
    expect(evaluate(telemetry("mhe" as ServiceId, "common", { temperature_k: 400 }), new Map())).toEqual([]);
  });

  it("labels service-wide messages as the service rather than undefined", () => {
    const [decision] = evaluate(telemetry("lwm", undefined, { wind_gust_ms: 25 }), seed.lwm);
    expect(decision.cause.startsWith("service gusting")).toBe(true);
  });
});
