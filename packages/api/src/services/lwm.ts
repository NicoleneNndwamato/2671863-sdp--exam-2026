import type { ServiceDefinition } from "@sdp/shared";
import { createStandardService } from "./base";

/**
 * Local Weather Monitoring: five sites (lwm-1..lwm-5) plus a `global` entity.
 * Every site publishes `telemetry/weather` once a minute; individual sites add
 * `telemetry/sonic`, `telemetry/soiling` and `telemetry/pan`. `global` adds
 * `telemetry/lightning`. Field lists come from `arl/lwm/$topology`.
 */
export const lwm: ServiceDefinition = createStandardService({
  id: "lwm",
  displayName: "Local Weather Monitoring",
  prefix: "arl/lwm"
});
