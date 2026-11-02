import {
  ago,
  clamp,
  fmt,
  fmtDateTime,
  fmtInt,
  fmtSpace,
  fmtTime,
  heatColour,
  heatRamp,
  kelvinToCelsius,
  numOr,
  splitTopic
} from "./format";

/**
 * Formatting is where "—" comes from. Every panel leans on these helpers, so a
 * regression here shows up as blank or `NaN` cells all over the console.
 */

describe("numbers and units", () => {
  it("converts kelvin and passes undefined straight through", () => {
    expect(kelvinToCelsius(273.15)).toBeCloseTo(0, 5);
    expect(kelvinToCelsius(295.15)).toBeCloseTo(22, 5);
    expect(kelvinToCelsius(undefined)).toBeUndefined();
  });

  it("formats with a fixed number of digits and dashes the unusable values", () => {
    expect(fmt(22.94)).toBe("22.9");
    expect(fmt(22.94, 0)).toBe("23");
    expect(fmt(undefined)).toBe("—");
    expect(fmt(Number.NaN)).toBe("—");
    expect(fmt(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("groups integers the South African way", () => {
    // ICU picks the en-ZA separator (a narrow no-break space), so match loosely.
    expect(fmtInt(1234.6)).toMatch(/^1\s?235$/);
    expect(fmtInt(0)).toBe("0");
    expect(fmtInt(undefined)).toBe("—");
    expect(fmtInt(Number.NaN)).toBe("—");
  });

  it("groups with spaces for dense tables", () => {
    expect(fmtSpace(1234567)).toBe("1 234 567");
    expect(fmtSpace(42.5, 1)).toBe("42.5");
    expect(fmtSpace(undefined)).toBe("—");
    expect(fmtSpace(Number.NaN)).toBe("—");
  });
});

describe("times", () => {
  it("prints bare clock time in UTC", () => {
    expect(fmtTime("2026-11-02T13:45:09.123Z")).toBe("13:45:09");
    expect(fmtTime(null)).toBe("—");
    expect(fmtTime(undefined)).toBe("—");
    expect(fmtTime("not a date")).toBe("—");
  });

  it("prints date and clock time together", () => {
    expect(fmtDateTime("2026-11-02T13:45:09.123Z")).toBe("2026-11-02 13:45:09");
    expect(fmtDateTime(undefined)).toBe("—");
    expect(fmtDateTime("bogus")).toBe("—");
  });

  it("expresses age in the largest sensible unit", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();

    expect(ago(undefined, now)).toBe("never");
    expect(ago("bogus", now)).toBe("never");
    expect(ago(at(2), now)).toBe("just now");
    expect(ago(at(19), now)).toBe("19s ago");
    expect(ago(at(120), now)).toBe("2m ago");
    expect(ago(at(3 * 3600), now)).toBe("3h ago");
    expect(ago(at(2 * 86_400), now)).toBe("2d ago");
  });

  it("never reports a negative age when the clock runs backwards", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    expect(ago(new Date(now + 5000).toISOString(), now)).toBe("just now");
  });
});

describe("heat ramp", () => {
  const ramp = { heatCool: "#000000", heatMid: "#808080", heatHot: "#ffffff" };

  it("falls back to the mid tone for values it cannot plot", () => {
    expect(heatColour(undefined, ramp)).toBe("#808080");
    expect(heatColour(Number.NaN, ramp)).toBe("#808080");
  });

  it("maps the default 280–320 K domain across the ramp", () => {
    expect(heatColour(280, ramp)).toBe("rgb(0, 0, 0)");
    expect(heatColour(300, ramp)).toBe("rgb(128, 128, 128)");
    expect(heatColour(320, ramp)).toBe("rgb(255, 255, 255)");
    expect(heatColour(400, ramp)).toBe("rgb(255, 255, 255)");
  });

  it("honours a caller-supplied domain so a half-degree spread is visible", () => {
    expect(heatColour(294.9, ramp, 294.8, 295.2)).not.toBe("rgb(128, 128, 128)");
  });

  it("clamps the fraction and treats garbage as the middle", () => {
    expect(heatRamp(-1, ramp)).toBe("rgb(0, 0, 0)");
    expect(heatRamp(2, ramp)).toBe("rgb(255, 255, 255)");
    expect(heatRamp(Number.NaN, ramp)).toBe("rgb(128, 128, 128)");
  });
});

describe("topic parsing and guards", () => {
  it("splits a topic into entity, kind and stream", () => {
    expect(splitTopic("arl/rta/dish-001/telemetry/normal")).toEqual({
      entity: "dish-001",
      kind: "telemetry",
      name: "normal"
    });
  });

  it("returns empty segments for a short topic rather than undefined", () => {
    expect(splitTopic("arl/rta")).toEqual({ entity: "", kind: "", name: "" });
  });

  it("accepts only finite numbers", () => {
    expect(numOr(4.2)).toBe(4.2);
    expect(numOr("4.2")).toBeUndefined();
    expect(numOr(Number.NaN)).toBeUndefined();
    expect(numOr(null)).toBeUndefined();
  });

  it("clamps into range", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});
