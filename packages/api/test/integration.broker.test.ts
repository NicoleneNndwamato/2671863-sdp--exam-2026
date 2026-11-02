import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import mqtt, { type MqttClient } from "mqtt";
import { createBroker } from "aedes";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { startBroker, type BrokerConnection } from "../src/mqtt/broker";
import { IngestBuffer } from "../src/mqtt/ingest";
import { postgresWriter } from "../src/mqtt/writer";
import { setIngestStatsProvider } from "../src/state";
import { getTopology } from "../src/services/topology";
import { alerts, rawMessages } from "../src/db/schema";
import { fakeArlFetch } from "./fakeArl";

/**
 * End to end, with only Postgres and the ARL HTTP API stood in for:
 *
 *   simulator publish -> in-process MQTT broker (aedes) -> our real client
 *   (startBroker) -> parser -> ingest buffer -> writer -> alert engine
 *   -> HTTP API (/api/stats, /api/services/:id/control) -> command on the broker.
 *
 * The broker is real MQTT over TCP on a random local port, so subscriptions,
 * retained `$topology`, and the reconnect path all run exactly as they do
 * against the ARL broker - including the broker going away and coming back.
 */
jest.mock("../src/db/client", () => {
  const db = {
    inserts: [] as Array<{ table: unknown; rows: unknown }>,
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: (table: unknown) => ({
      values: async (rows: unknown) => {
        db.inserts.push({ table, rows });
      }
    })
  };
  return { db };
});
jest.mock("../src/db/audit", () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));

const { db } = jest.requireMock("../src/db/client") as {
  db: { inserts: Array<{ table: unknown; rows: unknown }> };
};
const { recordAudit } = jest.requireMock("../src/db/audit") as { recordAudit: jest.Mock };

const quiet = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const realFetch = global.fetch;

const topology = {
  service: "rta",
  entities: [
    { id: "sub-1", kind: "subarray" },
    { id: "dish-042", kind: "dish" }
  ],
  controls: [{ topic: "arl/rta/cmd/+/start_scan", value: { type: "bool" } }]
};

let aedes: ReturnType<typeof createBroker>;
let server: Server;
let sockets = new Set<Socket>();
let port: number;
let buffer: IngestBuffer;
let connection: BrokerConnection;
let app: FastifyInstance;
const simulators: MqttClient[] = [];

function listen(onPort: number): Promise<number> {
  server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    aedes.handle(socket);
  });
  return new Promise((resolve) =>
    server.listen(onPort, "127.0.0.1", () => resolve((server.address() as AddressInfo).port))
  );
}

/** The broker vanishing: listener closed and every live connection cut. */
function dropBroker(): Promise<void> {
  for (const socket of sockets) socket.destroy();
  sockets = new Set();
  return new Promise((resolve) => server.close(() => resolve()));
}

/** A stand-in for the ARL simulator: a second, independent MQTT client. */
async function simulator(): Promise<MqttClient> {
  const client = await mqtt.connectAsync({ host: "127.0.0.1", port, reconnectPeriod: 0 });
  simulators.push(client);
  return client;
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const insertsInto = (table: unknown) => db.inserts.filter((insert) => insert.table === table);
const stats = async () => (await app.inject({ method: "GET", url: "/api/stats" })).json();

beforeAll(async () => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  // The fake register has no alert limits, so the engine warns and uses its defaults.
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  global.fetch = fakeArlFetch() as unknown as typeof fetch;

  aedes = createBroker();
  port = await listen(0);

  buffer = new IngestBuffer(postgresWriter, { maxBatch: 100, maxQueue: 1000 });
  setIngestStatsProvider(() => buffer.stats);
  connection = startBroker(buffer, quiet, { host: "127.0.0.1", port }, { baseMs: 50, maxMs: 200 });
  app = await buildApp();

  await waitFor(() => connection.supervisor.snapshot.state === "connected", "the first connection");
});

afterAll(async () => {
  connection.stop();
  for (const client of simulators) await client.endAsync(true).catch(() => undefined);
  await app.close();
  await dropBroker().catch(() => undefined);
  await new Promise<void>((resolve) => aedes.close(() => resolve()));
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe("broker -> ingest -> alerts -> API", () => {
  it("learns the topology from the retained $topology message", async () => {
    const sim = await simulator();
    await sim.publishAsync("arl/rta/$topology", JSON.stringify(topology), { retain: true, qos: 1 });

    // The broker forwards it to us a moment after the publish is acknowledged.
    await waitFor(() => getTopology("rta") !== undefined, "the topology");
    const controls = await app.inject({ method: "GET", url: "/api/services/rta/controls" });
    expect(controls.statusCode).toBe(200);
    expect(controls.json().controls).toEqual(topology.controls);
  });

  it("stores telemetry and raises a critical alert for an overheating dish", async () => {
    const sim = await simulator();
    await sim.publishAsync(
      "arl/rta/dish-042/telemetry/normal",
      JSON.stringify({ temperature_k: 345, wind_speed_ms: 4 }),
      { qos: 1 }
    );

    await waitFor(() => buffer.stats.queued > 0, "the message to reach the ingest buffer");
    await buffer.flush();

    const stored = insertsInto(rawMessages).flatMap((insert) => insert.rows as Array<Record<string, unknown>>);
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          service: "rta",
          device: "dish-042",
          topic: "arl/rta/dish-042/telemetry/normal"
        })
      ])
    );

    await waitFor(() => insertsInto(alerts).length > 0, "the alert engine");
    expect(insertsInto(alerts)[0].rows).toMatchObject({
      service: "rta",
      device: "dish-042",
      severity: "critical",
      status: "raised"
    });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ actor: "system", result: "raised" }));

    const body = await stats();
    expect(body.broker).toMatchObject({ state: "connected", attempts: 0 });
    expect(body.ingest.written).toBeGreaterThan(0);
    expect(body.services.find((s: { id: string }) => s.id === "rta")).toMatchObject({
      online: true,
      hasTopology: true
    });
  });

  it("publishes an authorised control onto the broker", async () => {
    const sim = await simulator();
    await sim.subscribeAsync("arl/rta/cmd/#");
    const received = new Promise<{ topic: string; payload: string }>((resolve) =>
      sim.on("message", (topic, payload) => resolve({ topic, payload: payload.toString() }))
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/services/rta/control",
      headers: { "x-researcher-code": "arl-b7m" },
      payload: { entity: "sub-1", control: "start_scan", value: true }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: true, published: true, topic: "arl/rta/cmd/sub-1/start_scan" });
    const command = await received;
    expect(command.topic).toBe("arl/rta/cmd/sub-1/start_scan");
    expect(JSON.parse(command.payload)).toMatchObject({ entity: "sub-1", control: "start_scan", value: true });
  });

  it("survives the broker going away: backs off, reconnects, resubscribes, keeps ingesting", async () => {
    for (const client of simulators.splice(0)) await client.endAsync(true).catch(() => undefined);
    await dropBroker();

    await waitFor(() => connection.supervisor.snapshot.state === "reconnecting", "the outage to be noticed");
    expect((await stats()).broker).toMatchObject({ state: "reconnecting", disconnects: 1 });

    // While the link is down a control is accepted and audited but not sent.
    const offline = await app.inject({
      method: "POST",
      url: "/api/services/rta/control",
      headers: { "x-researcher-code": "arl-b7m" },
      payload: { entity: "sub-1", control: "start_scan", value: false }
    });
    expect(offline.json()).toMatchObject({ accepted: true, published: false });

    // Let at least one retry fail against the closed port before restoring it.
    await waitFor(() => connection.supervisor.snapshot.attempts >= 2, "a failed retry");
    quiet.info.mockClear();
    await listen(port);
    await waitFor(() => connection.supervisor.snapshot.state === "connected", "the reconnection");
    expect(quiet.info).toHaveBeenCalledWith(expect.stringMatching(/^mqtt reconnected after \d+ attempt\(s\)$/));

    // aedes forgot our subscriptions with the old session; data only arrives
    // again if onConnect resubscribed.
    const before = insertsInto(rawMessages).length;
    const sim = await simulator();
    await waitFor(() => quiet.info.mock.calls.some(([line]) => line === "subscribed arl/rta/#"), "resubscribe");
    await sim.publishAsync("arl/rta/dish-007/telemetry/normal", JSON.stringify({ temperature_k: 300 }), { qos: 1 });

    await waitFor(() => buffer.stats.queued > 0, "post-reconnect telemetry");
    await buffer.flush();
    expect(insertsInto(rawMessages).length).toBe(before + 1);
    expect((await stats()).broker).toMatchObject({ state: "connected", attempts: 0, disconnects: 1 });
  });
});
