import { EventEmitter } from "node:events";
import { backoffDelay, ReconnectSupervisor } from "../src/mqtt/connection";

/**
 * Reconnection policy, driven with a stand-in client and fake timers so every
 * retry is observable. The end-to-end version - a real broker going away and
 * coming back - is in integration.broker.test.ts.
 */

class FakeClient extends EventEmitter {
  reconnect = jest.fn();
  end = jest.fn();
}

const quiet = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function supervise(options: Partial<ConstructorParameters<typeof ReconnectSupervisor>[1]> = {}) {
  const client = new FakeClient();
  const onConnect = jest.fn();
  const supervisor = new ReconnectSupervisor(client, {
    onConnect,
    log: quiet,
    random: () => 1, // always the top of the jitter range: deterministic delays
    ...options
  });
  return { client, supervisor, onConnect };
}

describe("backoffDelay", () => {
  it("doubles from one second and caps at thirty", () => {
    const top = (attempt: number) => backoffDelay(attempt, { random: () => 1 });
    expect([1, 2, 3, 4, 5, 6, 7, 12].map(top)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it("never retries sooner than half the step, so jitter cannot collapse to zero", () => {
    expect(backoffDelay(3, { random: () => 0 })).toBe(2000);
    expect(backoffDelay(3, { random: () => 0.5 })).toBe(3000);
  });

  it("honours a custom base and cap", () => {
    expect(backoffDelay(4, { baseMs: 50, maxMs: 200, random: () => 1 })).toBe(200);
  });

  it("treats attempt 0 or below as the first step", () => {
    expect(backoffDelay(0, { random: () => 1 })).toBe(1000);
  });
});

describe("ReconnectSupervisor", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("starts as connecting and runs onConnect (resubscribe) on every connection", () => {
    const { client, supervisor, onConnect } = supervise();
    expect(supervisor.snapshot.state).toBe("connecting");

    client.emit("connect");
    expect(supervisor.snapshot).toMatchObject({ state: "connected", attempts: 0, disconnects: 0 });
    expect(supervisor.snapshot.lastConnectedAt).not.toBeNull();

    client.emit("close");
    jest.advanceTimersByTime(1000);
    client.emit("connect");
    expect(onConnect).toHaveBeenCalledTimes(2);
  });

  it("backs off exponentially while the broker stays down", () => {
    const { client, supervisor } = supervise();
    client.emit("connect");
    client.emit("close");

    expect(supervisor.snapshot).toMatchObject({ state: "reconnecting", attempts: 1, disconnects: 1 });
    expect(supervisor.snapshot.nextRetryAt).not.toBeNull();

    jest.advanceTimersByTime(999);
    expect(client.reconnect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(client.reconnect).toHaveBeenCalledTimes(1);

    // That attempt fails too: the next wait is twice as long.
    client.emit("close");
    expect(supervisor.snapshot.attempts).toBe(2);
    jest.advanceTimersByTime(1999);
    expect(client.reconnect).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(client.reconnect).toHaveBeenCalledTimes(2);
  });

  it("resets the backoff once a connection succeeds", () => {
    const { client, supervisor } = supervise();
    client.emit("connect");
    for (let i = 0; i < 4; i += 1) {
      client.emit("close");
      jest.runOnlyPendingTimers();
    }
    expect(supervisor.snapshot.attempts).toBe(4);

    client.emit("connect");
    expect(supervisor.snapshot.attempts).toBe(0);
    expect(quiet.info).toHaveBeenCalledWith("mqtt reconnected after 4 attempt(s)");

    client.emit("close");
    jest.advanceTimersByTime(1000);
    expect(client.reconnect).toHaveBeenCalledTimes(5);
    expect(supervisor.snapshot.disconnects).toBe(2);
  });

  it("keeps a single pending retry however many close events arrive", () => {
    const { client } = supervise();
    client.emit("close");
    client.emit("close");
    client.emit("close");
    jest.advanceTimersByTime(60_000);
    expect(client.reconnect).toHaveBeenCalledTimes(1);
  });

  it("reports connecting, not reconnecting, if the first connection never came up", () => {
    const { client, supervisor } = supervise();
    client.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:1883"));
    client.emit("close");
    expect(supervisor.snapshot).toMatchObject({
      state: "connecting",
      attempts: 1,
      disconnects: 0,
      lastError: "connect ECONNREFUSED 127.0.0.1:1883"
    });
  });

  it("stops retrying after stop(), even with a retry already scheduled", () => {
    const { client, supervisor } = supervise();
    client.emit("connect");
    client.emit("close");
    supervisor.stop();

    jest.advanceTimersByTime(60_000);
    client.emit("close");
    jest.advanceTimersByTime(60_000);

    expect(client.reconnect).not.toHaveBeenCalled();
    expect(client.end).toHaveBeenCalledWith(true);
    expect(supervisor.snapshot).toMatchObject({ state: "stopped", nextRetryAt: null });
  });

  it("hands out copies of its status, not the live object", () => {
    const { supervisor } = supervise();
    const snap = supervisor.snapshot;
    snap.state = "connected";
    expect(supervisor.snapshot.state).toBe("connecting");
  });
});
