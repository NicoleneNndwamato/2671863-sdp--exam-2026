import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { fakeArlFetch } from "./fakeArl";

/**
 * Acknowledging and resolving an alert are researcher actions, so they go
 * through the same ARL verification as device controls - but the service being
 * checked is taken from the alert row, never from the request. These tests
 * drive the real routes over HTTP with the database replaced by a stub.
 */
jest.mock("../src/db/audit", () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../src/db/client", () => {
  const db = {
    rows: [] as Array<Record<string, unknown>>,
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: async () => db.rows
      };
      return chain;
    },
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({ returning: async () => [{ ...db.rows[0], ...patch }] })
      })
    })
  };
  return { db, pool: { query: jest.fn() } };
});

const { recordAudit } = jest.requireMock("../src/db/audit") as { recordAudit: jest.Mock };
const { db } = jest.requireMock("../src/db/client") as { db: { rows: Array<Record<string, unknown>> } };
const realFetch = global.fetch;
let app: FastifyInstance;

const ID = "6f1c1d3e-2b7a-4c39-9a51-0c6a7e1f2d40";

function alertRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    service: "lwm",
    device: "lwm-4",
    code: "high_wind",
    severity: "warning",
    cause: "lwm-4 gusting 15.0 m/s, above the 15.0 m/s warning limit",
    status: "raised",
    raisedAt: new Date("2026-11-02T13:23:02Z"),
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
    ...overrides
  };
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  global.fetch = fakeArlFetch() as unknown as typeof fetch;
  db.rows = [alertRow()];
});

afterEach(() => {
  global.fetch = realFetch;
});

function act(action: "acknowledge" | "resolve", code?: string, body?: Record<string, unknown>, id = ID) {
  return app.inject({
    method: "POST",
    url: `/api/alerts/${id}/${action}`,
    headers: code ? { "x-researcher-code": code } : {},
    payload: body ?? {}
  });
}

describe("GET /api/alerts", () => {
  it("lists alerts with ISO timestamps", async () => {
    const res = await app.inject({ method: "GET", url: "/api/alerts?status=open&service=lwm" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      count: 1,
      alerts: [{ id: ID, status: "raised", raisedAt: "2026-11-02T13:23:02.000Z", acknowledgedBy: null }]
    });
  });

  it("rejects an unknown status filter", async () => {
    const res = await app.inject({ method: "GET", url: "/api/alerts?status=bogus" });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/alerts/:id/acknowledge", () => {
  it("records who acknowledged the alert", async () => {
    const res = await act("acknowledge", "arl-as3");

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "acknowledged", acknowledgedBy: "arl-as3" });
    expect(recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({ actor: "arl-as3", action: "alert.acknowledge", result: "accepted" })
    );
  });

  it("checks the alert's service, not one the caller has access to", async () => {
    // arl-f2l works on rta and opg; this alert belongs to lwm.
    const res = await act("acknowledge", "arl-f2l");

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "service_access_denied", detail: "not_permitted" });
    expect(recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actor: "arl-f2l",
        service: "lwm",
        detail: "not permitted on lwm (not_permitted)",
        result: "rejected"
      })
    );
  });

  it.each([
    ["no code", undefined, 401, "missing_researcher_code"],
    ["an unknown code", "arl-nope", 403, "invalid_researcher_code"]
  ])("refuses %s", async (_label, code, status, error) => {
    const res = await act("acknowledge", code);
    expect(res.statusCode).toBe(status);
    expect(res.json().error).toBe(error);
    expect(recordAudit).toHaveBeenLastCalledWith(expect.objectContaining({ result: "rejected" }));
  });

  it("refuses a defunct researcher", async () => {
    db.rows = [alertRow({ service: "opg", device: "batteries", code: "battery_low" })];
    const res = await act("acknowledge", "arl-k9q");
    expect(res.statusCode).toBe(403);
    expect(res.json().detail).toBe("defunct");
  });

  it("will not acknowledge twice", async () => {
    db.rows = [alertRow({ status: "acknowledged", acknowledgedBy: "arl-as3" })];
    const res = await act("acknowledge", "arl-as3");
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("invalid_transition");
  });

  it("answers 400 for a malformed id and 404 for a missing alert", async () => {
    expect((await act("acknowledge", "arl-as3", {}, "not-a-uuid")).statusCode).toBe(400);
    db.rows = [];
    expect((await act("acknowledge", "arl-as3")).statusCode).toBe(404);
  });
});

describe("POST /api/alerts/:id/resolve", () => {
  it("requires an acknowledgement first", async () => {
    const res = await act("resolve", "arl-as3", { resolution: "wind dropped" });
    expect(res.statusCode).toBe(409);
    expect(res.json().detail).toContain("cannot resolve an alert that is raised");
  });

  it("records who resolved it and how", async () => {
    db.rows = [alertRow({ status: "acknowledged", acknowledgedBy: "arl-as3", acknowledgedAt: new Date() })];
    const res = await act("resolve", "arl-c2p", { resolution: "Gust front passed; readings back under 10 m/s" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "resolved",
      resolvedBy: "arl-c2p",
      resolution: "Gust front passed; readings back under 10 m/s"
    });
  });

  it("insists on a resolution note", async () => {
    const res = await act("resolve", "arl-as3", {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("resolution_required");
  });
});
