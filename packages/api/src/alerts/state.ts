import type { AlertStatus } from "@sdp/shared";

export class AlertTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertTransitionError";
  }
}

export function canAcknowledge(status: AlertStatus): boolean {
  return status === "raised";
}

export function canResolve(status: AlertStatus): boolean {
  return status === "acknowledged";
}

export interface AuditedAlert {
  status: AlertStatus;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolution: string | null;
}

/**
 * Alert lifecycle: raised -> acknowledged -> resolved.
 *
 * No skipping straight to resolved: the brief requires an explicit
 * acknowledgement, and the audit trail must show who saw it before who fixed it.
 */
export function applyAcknowledge<T extends AuditedAlert>(
  alert: T,
  researcherCode: string,
  at: Date = new Date()
): T {
  if (!canAcknowledge(alert.status)) {
    throw new AlertTransitionError(`cannot acknowledge an alert that is ${alert.status}`);
  }
  return { ...alert, status: "acknowledged", acknowledgedAt: at, acknowledgedBy: researcherCode };
}

export function applyResolve<T extends AuditedAlert>(
  alert: T,
  researcherCode: string,
  resolution: string,
  at: Date = new Date()
): T {
  if (!canResolve(alert.status)) {
    throw new AlertTransitionError(`cannot resolve an alert that is ${alert.status}`);
  }
  const note = resolution.trim();
  if (note.length === 0) {
    throw new AlertTransitionError("a resolution note is required");
  }
  return {
    ...alert,
    status: "resolved",
    resolvedAt: at,
    resolvedBy: researcherCode,
    resolution: note
  };
}
