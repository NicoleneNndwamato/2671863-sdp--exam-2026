import type { ServiceDefinition } from "@sdp/shared";
import { createStandardService } from "./base";

/**
 * On-demand Power Generation: `global`, `solar`, `batteries` and `diesel`
 * entities, each publishing `telemetry/power` once a minute with the fields
 * defined in `arl/opg/$topology`.
 */
export const opg: ServiceDefinition = createStandardService({
  id: "opg",
  displayName: "On-demand Power Generation",
  prefix: "arl/opg"
});
