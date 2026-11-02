import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { recordTopology } from "../src/services/topology";
import { fakeArlFetch } from "./fakeArl";

/**
 * The researcher gate as an operator meets it: real HTTP requests through the
 * Fastify route, with the ARL API replaced by the seed register. No MQTT client
 * is connected in tests, so an accepted command is audited but never reaches a
 * broker.
 */
jest.mock("../src/db/audit", () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));

const { recordAudit } = jest.requireMock("../src/db/audit") as { recordAudit: jest.Mock };
const realFetch = global.fetch;
let app: FastifyInstance;

beforeAll(async () => {
  recordTopology("arl/rta/$topology", {
    service: "rta",
    entities: [{ id: "sub-1", kind: "subarray" }],
    controls: [
      { topic: "arl/rta/cmd/+/start_scan", value: { type: "bool" } },
      { topic: "arl/rta/cmd/+/set_gain", value: { type: "integer", min: 0, max: 10 } },
      { topic: "arl/rta/cmd/+/mode", value: { type: "enum", values: ["normal", "scan"] } }
    ]
  });
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  global.fetch = fakeArlFetch() as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

function send(code: string | undefined, body: unknown, service = "rta") {
  return app.inject({
    method: "POST",
    url: `/api/services/${service}/control`,
    headers: code ? { "x-researcher-code": code } : {},
    payload: body as Record<string, unknown>
  });
}

const scan = { entity: "sub-1", control: "start_scan", value: true };

describe("POST /api/services/:id/control", () => {
  it.each([
    ["no code", undefined, "rta", 401, "missing_researcher_code"],
    ["an unknown code", "arl-nope", "rta", 403, "invalid_researcher_code"],
    ["a defunct researcher on a listed experiment (arl-k9q on opg)", "arl-k9q", "opg", 403, "service_access_denied"],
    ["a researcher off the experiment (arl-f2l on lwm)", "arl-f2l", "lwm", 403, "service_access_denied"]
  ])("refuses %s", async (_label, code, service, status, error) => {
    const res = await send(code, scan, service);
    expect(res.statusCode).toBe(status);
    expect(res.json().error).toBe(error);
  });

  it("accepts an active researcher on their own experiment and audits who did it", async () => {
    const res = await send("arl-b7m", scan);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: true, published: false, topic: "arl/rta/cmd/sub-1/start_scan" });
    expect(recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({ actor: "arl-b7m", action: "control.start_scan", result: "accepted" })
    );
  });

  it("refuses a control the topology does not advertise", async () => {
    const res = await send("arl-as3", { entity: "sub-1", control: "self_destruct", value: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("unknown_control");
  });

  it.each([
    [{ entity: "sub-1", control: "start_scan", value: "yes" }, "expected a boolean"],
    [{ entity: "sub-1", control: "set_gain", value: 11 }, "above the maximum 10"],
    [{ entity: "sub-1", control: "set_gain", value: 1.5 }, "expected an integer"],
    [{ entity: "sub-1", control: "mode", value: "turbo" }, "expected one of: normal, scan"]
  ])("rejects a value that breaks the published spec: %j", async (body, detail) => {
    const res = await send("arl-as3", body);
    expect(res.statusCode).toBe(422);
    expect(res.json().detail).toContain(detail);
  });

  it("rejects a malformed request body before looking at the topology", async () => {
    const res = await send("arl-as3", { entity: "sub 1; rm -rf", control: "start_scan" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_command");
  });
});
