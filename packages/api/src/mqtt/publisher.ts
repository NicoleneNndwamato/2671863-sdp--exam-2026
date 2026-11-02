import type { MqttClient } from "mqtt";

/**
 * Outbound command channel.
 *
 * The broker connection is created by startBroker(); control routes need to
 * publish on it, so the client is registered here rather than passed through
 * every layer. The live broker has controls disabled - a publish is accepted by
 * the broker but the simulator ignores it. We still publish and audit the
 * attempt so the control surface is real and observable.
 */
let client: MqttClient | null = null;

export function setCommandPublisher(mqtt: MqttClient | null): void {
  client = mqtt;
}

export interface CommandResult {
  published: boolean;
  topic: string;
}

export function publishCommand(
  service: string,
  entity: string,
  control: string,
  value: unknown
): CommandResult {
  const topic = `arl/${service}/cmd/${entity}/${control}`;
  if (!client || !client.connected) return { published: false, topic };

  client.publish(
    topic,
    JSON.stringify({ v: 1, ts: Date.now(), entity, control, value }),
    { qos: 0 }
  );
  return { published: true, topic };
}
