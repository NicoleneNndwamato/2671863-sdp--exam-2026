import type { Reading, ServiceTopology } from "@sdp/shared";
import {
  buildSnapshot,
  entitiesOfKind,
  numOf,
  payloadOf,
  seriesFrom,
  snapshotAt,
  stateBool,
  stateNumber,
  stateOf,
  topicsNamed,
  windowOf
} from "./snapshot";

/**
 * The snapshot layer is the seam between "live polling" and "replay": both feed
 * the same views. These tests pin the shapes the views assume, including the
 * awkward ones (missing topics, unparseable timestamps, averages).
 */

const item = (topic: string, observedAt: string, payload: Record<string, unknown> = {}) => ({
  topic,
  device: topic.split("/")[2] ?? null,
  observedAt,
  payload
});

const reading = (topic: string, observedAt: string, payload: Record<string, unknown>): Reading => ({
  service: "rta",
  device: topic.split("/")[2] ?? null,
  topic,
  observedAt,
  receivedAt: observedAt,
  payload
});

const T = {
  normal: "arl/rta/dish-001/telemetry/normal",
  weather: "arl/lwm/lwm-1/telemetry/weather",
  temp: "arl/rta/dish-002/telemetry/normal",
  enabled: "arl/rta/dish-001/state/enabled"
};

describe("buildSnapshot", () => {
  it("keeps the newest item per topic and reports the latest timestamp", () => {
    const snapshot = buildSnapshot([
      item(T.normal, "2026-11-02T10:00:00Z", { temperature_k: 295 }),
      item(T.normal, "2026-11-02T10:00:10Z", { temperature_k: 296 }),
      item(T.enabled, "2026-11-02T10:00:05Z", { value: true })
    ]);

    expect(snapshot.topics.size).toBe(2);
    expect(numOf(snapshot, T.normal, "temperature_k")).toBe(296);
    expect(snapshot.at).toBe("2026-11-02T10:00:10.000Z");
  });

  it("ignores unparseable timestamps when picking the clock", () => {
    const snapshot = buildSnapshot([
      item(T.normal, "nonsense", { temperature_k: 1 }),
      item(T.enabled, "2026-11-02T10:00:00Z", { value: true })
    ]);
    expect(snapshot.at).toBe("2026-11-02T10:00:00.000Z");
  });

  it("reports a null clock for an empty feed", () => {
    expect(buildSnapshot([])).toEqual({ topics: new Map(), at: null });
    expect(buildSnapshot([item(T.normal, "nonsense")]).at).toBeNull();
  });
});

describe("field readers", () => {
  const snapshot = buildSnapshot([
    item(T.normal, "2026-11-02T10:00:00Z", { temperature_k: 295.2, label: "hot" }),
    item(T.enabled, "2026-11-02T10:00:00Z", { value: true }),
    item(T.temp, "2026-11-02T10:00:00Z", { value: 7 })
  ]);

  it("reads payloads and numbers, refusing anything that is not a finite number", () => {
    expect(payloadOf(snapshot, T.normal)).toMatchObject({ label: "hot" });
    expect(numOf(snapshot, T.normal, "temperature_k")).toBe(295.2);
    expect(numOf(snapshot, T.normal, "label")).toBeUndefined();
    expect(numOf(snapshot, "missing/topic", "temperature_k")).toBeUndefined();
    expect(payloadOf(snapshot, "missing/topic")).toBeUndefined();
  });

  it("reads state values with their type intact", () => {
    expect(stateOf(snapshot, T.enabled)).toBe(true);
    expect(stateBool(snapshot, T.enabled)).toBe(true);
    expect(stateBool(snapshot, T.temp)).toBeUndefined();
    expect(stateNumber(snapshot, T.temp)).toBe(7);
    expect(stateNumber(snapshot, T.enabled)).toBeUndefined();
    expect(stateOf(snapshot, "missing/topic")).toBeUndefined();
  });
});

describe("topicsNamed", () => {
  const snapshot = buildSnapshot([
    item(T.temp, "2026-11-02T10:00:00Z", { temperature_k: 300 }),
    item(T.normal, "2026-11-02T10:00:00Z", { temperature_k: 295 }),
    item(T.weather, "2026-11-02T10:00:00Z", { temperature_k: 290 })
  ]);

  it("selects by kind and stream, then sorts by entity", () => {
    const found = topicsNamed(snapshot, "telemetry", "normal");
    expect(found.map((entry) => entry.entity)).toEqual(["dish-001", "dish-002"]);
    expect(topicsNamed(snapshot, "telemetry", "weather").map((entry) => entry.entity)).toEqual(["lwm-1"]);
  });

  it("returns nothing for a stream nobody publishes", () => {
    expect(topicsNamed(snapshot, "telemetry", "sonic")).toEqual([]);
  });
});

describe("seriesFrom", () => {
  const history: Reading[] = [
    reading(T.normal, "2026-11-02T10:00:20Z", { temperature_k: 296 }),
    reading(T.normal, "2026-11-02T10:00:00Z", { temperature_k: 295 }),
    reading(T.temp, "2026-11-02T10:00:00Z", { temperature_k: 297 }),
    reading(T.temp, "2026-11-02T10:00:20Z", { temperature_k: 299 }),
    reading(T.normal, "2026-11-02T10:00:10Z", { temperature_k: Number.NaN }),
    reading(T.normal, "bogus", { temperature_k: 1 }),
    reading(T.weather, "2026-11-02T10:00:00Z", { temperature_k: 280 })
  ];

  it("plots a single entity in time order", () => {
    const series = seriesFrom(history, { kind: "telemetry", name: "normal", field: "temperature_k", entity: "dish-001" });
    expect(series).toEqual([
      { x: Date.parse("2026-11-02T10:00:00Z"), y: 295 },
      { x: Date.parse("2026-11-02T10:00:20Z"), y: 296 }
    ]);
  });

  it("averages every entity per timestamp for the array view", () => {
    const series = seriesFrom(history, {
      kind: "telemetry",
      name: "normal",
      field: "temperature_k",
      entity: "*",
      average: true
    });
    // 295 & 297 at :00, 296 & 299 at :20 - weather and NaN are excluded.
    expect(series).toEqual([
      { x: Date.parse("2026-11-02T10:00:00Z"), y: 296 },
      { x: Date.parse("2026-11-02T10:00:20Z"), y: 297.5 }
    ]);
  });

  it("skips readings whose field is not a number", () => {
    const series = seriesFrom(history, {
      kind: "telemetry",
      name: "normal",
      field: "irradiance_wm2",
      entity: "dish-001"
    });
    expect(series).toEqual([]);
  });
});

describe("topology helpers", () => {
  const topology = {
    v: 1,
    service: "rta",
    version: "1",
    updatedAt: "2026-11-02T10:00:00Z",
    entities: [
      { id: "dish-002", kind: "dish", row: 0, col: 1 },
      { id: "dish-001", kind: "dish", row: 0, col: 0 },
      { id: "dish-003", kind: "dish", row: 1, col: 0 },
      { id: "receiver", kind: "receiver" }
    ],
    streams: []
  } as unknown as ServiceTopology;

  it("returns devices in grid order", () => {
    expect(entitiesOfKind(topology, "dish").map((entity) => entity.id)).toEqual(["dish-001", "dish-002", "dish-003"]);
  });

  it("tolerates a missing topology", () => {
    expect(entitiesOfKind(null, "dish")).toEqual([]);
  });
});

describe("windowOf", () => {
  it("reports the first and last usable instant", () => {
    expect(
      windowOf([
        reading(T.normal, "2026-11-02T10:00:20Z", {}),
        reading(T.normal, "2026-11-02T10:00:00Z", {}),
        reading(T.normal, "bogus", {})
      ])
    ).toEqual({ start: Date.parse("2026-11-02T10:00:00Z"), end: Date.parse("2026-11-02T10:00:20Z") });
  });

  it("returns null when nothing can be dated", () => {
    expect(windowOf([])).toBeNull();
    expect(windowOf([reading(T.normal, "bogus", {})])).toBeNull();
  });
});

describe("snapshotAt", () => {
  const history = [
    reading(T.normal, "2026-11-02T10:00:00Z", { temperature_k: 295 }),
    reading(T.normal, "2026-11-02T10:00:20Z", { temperature_k: 296 }),
    reading(T.enabled, "2026-11-02T10:00:05Z", { value: true }),
    reading(T.normal, "bogus", { temperature_k: 1 })
  ];

  it("shows the newest value at or before the cursor", () => {
    const snapshot = snapshotAt(history, Date.parse("2026-11-02T10:00:10Z"));
    expect(numOf(snapshot, T.normal, "temperature_k")).toBe(295);
    expect(stateBool(snapshot, T.enabled)).toBe(true);
    expect(snapshot.at).toBe("2026-11-02T10:00:10.000Z");
  });

  it("does not go backwards when an older reading arrives late", () => {
    const snapshot = snapshotAt(
      [
        reading(T.normal, "2026-11-02T10:00:20Z", { temperature_k: 296 }),
        reading(T.normal, "2026-11-02T10:00:00Z", { temperature_k: 295 })
      ],
      Date.parse("2026-11-02T10:00:30Z")
    );
    expect(numOf(snapshot, T.normal, "temperature_k")).toBe(296);
  });

  it("is empty before the first reading", () => {
    const snapshot = snapshotAt(history, Date.parse("2026-11-02T09:00:00Z"));
    expect(snapshot.topics.size).toBe(0);
  });
});
