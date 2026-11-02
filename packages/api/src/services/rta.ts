import type { ServiceDefinition } from "@sdp/shared";
import { createStandardService } from "./base";

/**
 * Radio Telescope Array: 100 dishes in a 10x10 grid plus a `main` sub-array and
 * a `global` entity. Dishes publish `telemetry/normal` every 120 s and
 * `telemetry/scan` once per second while scanning. The dish grid layout and
 * field lists come from `arl/rta/$topology`.
 */
export const rta: ServiceDefinition = createStandardService({
  id: "rta",
  displayName: "Radio Telescope Array",
  prefix: "arl/rta"
});
