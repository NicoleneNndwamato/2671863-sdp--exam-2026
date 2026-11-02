import { isTopologyTopic, toDate, createStandardService } from "../src/services/base";
import { parseMessage, serviceById } from "../src/services/registry";
import {
  allTopologies,
  entitiesOfKind,
  getTopology,
  recordTopology
} from "../src/services/topology";

/**
 * Message parsing beyond the happy paths in services.parse.test.ts: timestamp
 * formats, entity resolution, and the retained `$topology` documents that
 * everything downstream (subscriptions, the dish grid, control validation) is
 * derived from.
 */

describe("toDate", () => {
  it("reads epoch milliseconds, the live format", () => {
    expect(toDate(1793612040000).toISOString()).toBe("2026-11-02T09:34:00.000Z");
  });

  it("promotes epoch seconds to milliseconds", () => {
    expect(toDate(1793612040).toISOString()).toBe("2026-11-02T09:34:00.000Z");
  });

  it("accepts an ISO string", () => {
    expect(toDate("2026-11-02T09:34:00Z").getTime()).toBe(1793612040000);
  });

  it.each([["garbage"], [Number.NaN], [undefined], [{}]])("falls back to now for %p", (ts) => {
    const before = Date.now();
    const at = toDate(ts).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});

describe("entity resolution", () => {
  it("prefers the payload's entity over the topic segment", () => {
    const msg = parseMessage("arl/rta/array/telemetry/scan", { ts: 1, entity: "dish-007" });
    expect(msg?.device).toBe("dish-007");
  });

  it("falls back to the topic segment when entity is empty", () => {
    const msg = parseMessage("arl/rta/dish-008/telemetry/normal", { ts: 1, entity: "" });
    expect(msg?.device).toBe("dish-008");
  });

  it("names service-wide events after the payload entity, or global", () => {
    expect(parseMessage("arl/opg/events/load_shed", { ts: 1 })?.device).toBe("global");
    expect(parseMessage("arl/opg/events/load_shed", { ts: 1, entity: "batteries" })?.device).toBe(
      "batteries"
    );
  });

  it("tags every message with its kind and name so rules can tell state from telemetry", () => {
    const msg = parseMessage("arl/lwm/lwm-3/state/online", { ts: 1, item: "online", value: true });
    expect(msg?.data).toMatchObject({ _kind: "state", _name: "online", item: "online", value: true });
  });

  it("keeps the backfill flag so the engine can skip historical samples", () => {
    const msg = parseMessage("arl/lwm/lwm-2/telemetry/sonic", { ts: 1, backfill: true });
    expect(msg?.data.backfill).toBe(true);
  });
});

describe("routing", () => {
  it("returns null for a service nobody registered", () => {
    expect(parseMessage("arl/xrt/thing/telemetry/x", { ts: 1 })).toBeNull();
  });

  it("rejects a topic too short to carry a kind", () => {
    expect(parseMessage("arl/rta/dish-001", { ts: 1 })).toBeNull();
  });

  it("treats the legacy arl/services topic as discovery", () => {
    expect(isTopologyTopic("arl/services")).toBe(true);
    expect(isTopologyTopic("arl/rta/dish-001/telemetry/normal")).toBe(false);
  });

  it("looks services up by id", () => {
    expect(serviceById("lwm")?.displayName).toBeDefined();
    expect(serviceById("nope")).toBeUndefined();
  });

  it("tolerates a trailing slash on a service prefix", () => {
    const svc = createStandardService({ id: "owt" as never, displayName: "OWT", prefix: "arl/owt/" });
    expect(svc.topicPrefixes).toEqual(["arl/owt"]);
    expect(svc.parseMessage("arl/owt/treatment/telemetry/flow", { ts: 1 })?.device).toBe("treatment");
  });
});

describe("$topology store", () => {
  // Shapes copied from the retained arl/<service>/$topology documents.
  const rtaTopology = {
    v: 1,
    service: "rta",
    version: "0.1.0",
    entities: [
      { id: "dish-001", kind: "dish", row: 0, col: 0 },
      { id: "dish-002", kind: "dish", row: 0, col: 1 },
      { id: "array", kind: "service" },
      { kind: "dish" },
      "dish-999",
      null
    ],
    streams: [{ topic: "arl/rta/+/telemetry/normal", fields: [] }],
    controls: [{ topic: "arl/rta/cmd/+/start_scan", entity_kinds: ["subarray"], value: { type: "bool" } }]
  };

  it("stores a topology and drops entities without an id", () => {
    recordTopology("arl/rta/$topology", rtaTopology);
    const topo = getTopology("rta");

    expect(topo?.entities.map((e) => e.id)).toEqual(["dish-001", "dish-002", "array"]);
    expect(topo?.controls).toHaveLength(1);
    expect(topo?.version).toBe("0.1.0");
    expect(entitiesOfKind("rta", "dish").map((e) => e.id)).toEqual(["dish-001", "dish-002"]);
  });

  it("fills sensible defaults for a sparse document", () => {
    recordTopology("arl/mhe/$topology", { entities: "not-a-list" });
    expect(getTopology("mhe")).toMatchObject({
      v: 1,
      service: "mhe",
      version: "0.0.0",
      entities: [],
      streams: [],
      state: [],
      events: [],
      controls: []
    });
  });

  it.each([
    ["a non-$topology topic", "arl/zz1/thing/telemetry/x", {}],
    ["a string payload", "arl/zz2/$topology", "hello"],
    ["an array payload", "arl/zz3/$topology", []],
    ["a null payload", "arl/zz4/$topology", null]
  ])("ignores %s", (_label, topic, payload) => {
    recordTopology(topic, payload);
    expect(getTopology(topic.split("/")[1])).toBeUndefined();
  });

  it("replaces a service's topology when a new one is retained", () => {
    recordTopology("arl/lwm/$topology", { version: "1", entities: [{ id: "lwm-1", kind: "site" }] });
    recordTopology("arl/lwm/$topology", { version: "2", entities: [{ id: "lwm-1", kind: "site" }, { id: "lwm-2", kind: "site" }] });

    expect(getTopology("lwm")?.version).toBe("2");
    expect(entitiesOfKind("lwm", "site")).toHaveLength(2);
    expect(allTopologies().filter((t) => t.service === "lwm")).toHaveLength(1);
  });

  it("answers an empty list for a service it has not seen", () => {
    expect(entitiesOfKind("never-seen", "dish")).toEqual([]);
  });
});
