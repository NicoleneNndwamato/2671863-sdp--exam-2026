import { applyAcknowledge, applyResolve, AlertTransitionError, canAcknowledge } from "../src/alerts/state";
import type { AuditedAlert } from "../src/alerts/state";

const raised: AuditedAlert = {
  status: "raised",
  acknowledgedAt: null,
  acknowledgedBy: null,
  resolvedAt: null,
  resolvedBy: null,
  resolution: null
};

describe("alert lifecycle", () => {
  it("records who acknowledged and when", () => {
    const at = new Date("2026-11-02T08:00:00Z");
    const acked = applyAcknowledge(raised, "RES-01", at);

    expect(acked.status).toBe("acknowledged");
    expect(acked.acknowledgedBy).toBe("RES-01");
    expect(acked.acknowledgedAt).toEqual(at);
  });

  it("refuses to acknowledge an alert twice", () => {
    const acked = applyAcknowledge(raised, "RES-01");
    expect(canAcknowledge(acked.status)).toBe(false);
    expect(() => applyAcknowledge(acked, "RES-02")).toThrow(AlertTransitionError);
  });

  it("refuses to resolve before acknowledgement", () => {
    expect(() => applyResolve(raised, "RES-01", "fixed")).toThrow(AlertTransitionError);
  });

  it("requires a resolution note", () => {
    const acked = applyAcknowledge(raised, "RES-01");
    expect(() => applyResolve(acked, "RES-01", "   ")).toThrow(AlertTransitionError);
  });

  it("captures the resolver, the note and the time", () => {
    const acked = applyAcknowledge(raised, "RES-01");
    const at = new Date("2026-11-02T09:30:00Z");
    const resolved = applyResolve(acked, "RES-02", "dish cooled below threshold", at);

    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedBy).toBe("RES-02");
    expect(resolved.resolution).toBe("dish cooled below threshold");
    expect(resolved.resolvedAt).toEqual(at);
    expect(resolved.acknowledgedBy).toBe("RES-01");
  });
});
