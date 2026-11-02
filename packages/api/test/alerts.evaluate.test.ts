import type { ParsedMessage } from "@sdp/shared";

/**
 * evaluateAlerts() is the half of the engine that touches the database: it
 * decides whether a firing rule becomes a new alert row. The rules themselves
 * are covered elsewhere; here the question is "one condition, one open alert".
 *
 * The database is replaced by a recorder so the tests run without Postgres.
 */
jest.mock("../src/db/client", () => {
  const db = {
    open: [] as Array<{ id: string }>,
    inserts: [] as Array<Record<string, unknown>>,
    selects: 0,
    failing: false,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            db.selects += 1;
            if (db.failing) throw new Error("connection terminated");
            return db.open;
          }
        })
      })
    }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        db.inserts.push(row);
      }
    })
  };
  return { db };
});
jest.mock("../src/db/audit", () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../src/alerts/limits", () => ({ getAlertLimits: jest.fn() }));

interface FakeDb {
  open: Array<{ id: string }>;
  inserts: Array<Record<string, unknown>>;
  selects: number;
  failing: boolean;
}

let evaluateAlerts: typeof import("../src/alerts/engine").evaluateAlerts;
let db: FakeDb;
let recordAudit: jest.Mock;
let getAlertLimits: jest.Mock;

beforeEach(() => {
  // Fresh modules: the engine's 60 s throttle is module state.
  jest.resetModules();
  evaluateAlerts = require("../src/alerts/engine").evaluateAlerts;
  db = require("../src/db/client").db;
  recordAudit = require("../src/db/audit").recordAudit;
  getAlertLimits = require("../src/alerts/limits").getAlertLimits;
  getAlertLimits.mockResolvedValue(new Map([["dish_temperature.crit_k", 343], ["dish_temperature.warn_k", 333]]));
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

/** `device: null` models a service-wide message with no entity. */
function hotDish(device: string | null = "dish-042", extra: Record<string, unknown> = {}): ParsedMessage {
  return {
    service: "rta",
    device: device ?? undefined,
    topic: `arl/rta/${device}/telemetry/normal`,
    observedAt: new Date(),
    data: { _kind: "telemetry", temperature_k: 345, ...extra }
  };
}

describe("evaluateAlerts", () => {
  it("opens an alert and writes the reason to the audit log", async () => {
    await evaluateAlerts(hotDish());

    expect(db.inserts).toEqual([
      {
        service: "rta",
        device: "dish-042",
        code: "dish_overtemp",
        severity: "critical",
        cause: expect.stringContaining("345.0 K"),
        status: "raised"
      }
    ]);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "system",
        action: "alert.dish_overtemp",
        result: "raised",
        topic: "arl/rta/dish-042/telemetry/normal"
      })
    );
  });

  it("does not duplicate an alert that is still open", async () => {
    db.open = [{ id: "existing" }];
    await evaluateAlerts(hotDish());
    expect(db.inserts).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("throttles the database check for a minute per condition", async () => {
    await evaluateAlerts(hotDish());
    await evaluateAlerts(hotDish());
    await evaluateAlerts(hotDish());
    expect(db.selects).toBe(1);

    // A different dish is a different condition.
    await evaluateAlerts(hotDish("dish-043"));
    expect(db.selects).toBe(2);
  });

  it("checks again once the throttle window has passed", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    db.open = [{ id: "existing" }];
    await evaluateAlerts(hotDish());

    now.mockReturnValue(1_000_000 + 61_000);
    await evaluateAlerts(hotDish());
    expect(db.selects).toBe(2);
  });

  it("ignores backfilled samples - they describe the past", async () => {
    await evaluateAlerts(hotDish("dish-042", { backfill: true }));
    expect(getAlertLimits).not.toHaveBeenCalled();
    expect(db.selects).toBe(0);
  });

  it("does nothing when no rule fires", async () => {
    await evaluateAlerts(hotDish("dish-001", { temperature_k: 300 }));
    expect(db.selects).toBe(0);
  });

  it("stores a service-wide alert with a null device", async () => {
    await evaluateAlerts(hotDish(null));
    expect(db.inserts[0]).toMatchObject({ device: null });
  });

  it("survives the limits lookup failing", async () => {
    getAlertLimits.mockRejectedValue(new Error("no limits"));
    await expect(evaluateAlerts(hotDish())).resolves.toBeUndefined();
    expect(db.selects).toBe(0);
  });

  it("never lets a database error escape into the ingest path", async () => {
    db.failing = true;
    await expect(evaluateAlerts(hotDish())).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to raise alert dish_overtemp"),
      expect.any(Error)
    );
  });
});
