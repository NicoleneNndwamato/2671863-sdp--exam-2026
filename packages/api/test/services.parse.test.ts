import { isTopologyTopic } from "../src/services/base";
import { parseMessage } from "../src/services/registry";
import { rta } from "../src/services/rta";
import { lwm } from "../src/services/lwm";
import { opg } from "../src/services/opg";

/**
 * These payloads are copied from a live capture of `wmc.ms.wits.ac.za:1883`
 * so the tests fail if the documented topic shape and the real one drift apart.
 */
const telemetry = {
  v: 1,
  ts: 1793612040000,
  seq: 35,
  entity: "lwm-1",
  backfill: false,
  battery_v: 12.91,
  temperature_k: 292.66,
  wind_gust_ms: 4.2
};

describe("shared topic parser", () => {
  it("decodes arl/<svc>/<entity>/telemetry/<stream>", () => {
    const message = parseMessage("arl/lwm/lwm-1/telemetry/weather", telemetry);

    expect(message).not.toBeNull();
    expect(message!.service).toBe("lwm");
    expect(message!.device).toBe("lwm-1");
    expect(message!.observedAt.getTime()).toBe(1793612040000);
    expect(message!.data._kind).toBe("telemetry");
    expect(message!.data._name).toBe("weather");
    // The original fields survive untouched - nothing is renamed on the way in.
    expect(message!.data.temperature_k).toBe(292.66);
  });

  it("decodes state items with the entity from the payload", () => {
    const message = parseMessage("arl/lwm/lwm-1/state/enabled", {
      v: 1,
      ts: 1793609924411,
      entity: "lwm-1",
      item: "enabled",
      value: true
    });

    expect(message!.data._kind).toBe("state");
    expect(message!.data.item).toBe("enabled");
    expect(message!.data.value).toBe(true);
  });

  it("decodes service-wide events with one fewer segment", () => {
    const message = parseMessage("arl/rta/events/alert", { v: 1, ts: 1793612040000, kind: "wind_stow" });

    expect(message).not.toBeNull();
    expect(message!.data._kind).toBe("events");
    expect(message!.data._name).toBe("alert");
  });

  it("treats $topology as discovery, not telemetry", () => {
    expect(isTopologyTopic("arl/rta/$topology")).toBe(true);
    expect(parseMessage("arl/rta/$topology", { v: 1 })).toBeNull();
  });

  it("ignores topics that are not telemetry, state or events", () => {
    expect(parseMessage("arl/rta/cmd/dish-001/start_scan", { v: 1 })).toBeNull();
    expect(parseMessage("other/rta/dish-001/telemetry/normal", telemetry)).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(rta.parseMessage("arl/rta/dish-001/telemetry/normal", "not json")).toBeNull();
    expect(lwm.parseMessage("arl/lwm/lwm-1/telemetry/weather", [1, 2, 3])).toBeNull();
    expect(opg.parseMessage("arl/opg/global/telemetry/power", null)).toBeNull();
  });

  it("only claims topics under its own prefix", () => {
    expect(rta.parseMessage("arl/lwm/lwm-1/telemetry/weather", telemetry)).toBeNull();
    expect(lwm.parseMessage("arl/lwm/lwm-1/telemetry/weather", telemetry)).not.toBeNull();
    expect(lwm.parseMessage("arl/opg/global/telemetry/power", { v: 1 })).toBeNull();
    expect(opg.parseMessage("arl/rta/dish-001/telemetry/normal", { v: 1 })).toBeNull();
  });
});
