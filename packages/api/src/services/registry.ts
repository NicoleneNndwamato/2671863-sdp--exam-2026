import type { ParsedMessage, ServiceDefinition } from "@sdp/shared";
import { rta } from "./rta";

/**
 * The registry is the only place that knows the list of services.
 * Adding LWM/MHE/OPG/OWT means implementing ServiceDefinition and adding it
 * here - nothing else in the ingest path changes.
 */
export const services: ServiceDefinition[] = [rta];

export function serviceById(id: string): ServiceDefinition | undefined {
  return services.find((s) => s.id === id);
}

/** Route one broker message to the service that owns it. */
export function parseMessage(topic: string, payload: unknown): ParsedMessage | null {
  for (const service of services) {
    const message = service.parseMessage(topic, payload);
    if (message) return message;
  }
  return null;
}
