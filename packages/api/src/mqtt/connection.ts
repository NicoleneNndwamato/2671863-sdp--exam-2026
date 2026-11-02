/**
 * Broker reconnection.
 *
 * mqtt.js can reconnect on its own, but only on a fixed interval: with the
 * default one second, a broker that is down for maintenance gets hammered for
 * as long as it is down, and every client that lost the broker at the same
 * moment retries in lockstep. This supervisor turns the library's reconnect off
 * and drives it itself:
 *
 *  - exponential backoff (1 s, 2 s, 4 s ... capped at 30 s) with jitter, reset
 *    the moment a connection succeeds;
 *  - one pending retry at most, however many close/error events arrive;
 *  - the connection state is kept for /api/stats, so an outage is visible in
 *    the console rather than looking like a quiet feed.
 *
 * Re-subscribing and re-registering the command publisher are the caller's
 * job, done in `onConnect`, which runs on the first connection and every
 * reconnection alike.
 */

export type BrokerState = "connecting" | "connected" | "reconnecting" | "stopped";

export interface BrokerStatus {
  state: BrokerState;
  /** When the current state began. */
  since: string;
  /** Failed attempts since the last good connection. */
  attempts: number;
  /** Connections lost since start-up. */
  disconnects: number;
  lastConnectedAt: string | null;
  lastError: string | null;
  /** When the next attempt is due, while reconnecting. */
  nextRetryAt: string | null;
}

/** The slice of MqttClient the supervisor uses, so tests can drive it with an EventEmitter. */
export interface ReconnectableClient {
  on(event: "connect", listener: () => void): unknown;
  on(event: "close", listener: () => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  reconnect(): unknown;
  end(force?: boolean): unknown;
}

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** 0..1; injectable so tests are deterministic. */
  random?: () => number;
}

/**
 * Delay before retry number `attempt` (1-based): the exponential step, of which
 * the upper half is randomised ("equal jitter"), so a retry is never sooner than
 * half the step and clients that dropped together spread out.
 */
export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 1000;
  const max = options.maxMs ?? 30_000;
  const random = options.random ?? Math.random;
  const step = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(step / 2 + random() * (step / 2));
}

export interface SupervisorOptions extends BackoffOptions {
  onConnect: () => void;
  log: Pick<Console, "info" | "warn" | "error">;
  now?: () => number;
}

export class ReconnectSupervisor {
  private status: BrokerStatus;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private wasConnected = false;
  private readonly now: () => number;

  constructor(
    private readonly client: ReconnectableClient,
    private readonly options: SupervisorOptions
  ) {
    this.now = options.now ?? Date.now;
    this.status = {
      state: "connecting",
      since: this.iso(),
      attempts: 0,
      disconnects: 0,
      lastConnectedAt: null,
      lastError: null,
      nextRetryAt: null
    };

    client.on("connect", () => this.handleConnect());
    client.on("close", () => this.handleClose());
    client.on("error", (err) => {
      this.status = { ...this.status, lastError: err.message };
      options.log.error(`mqtt error: ${err.message}`);
    });
  }

  get snapshot(): BrokerStatus {
    return { ...this.status };
  }

  /** Stop retrying and close the connection; used on shutdown. */
  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.status = { ...this.status, state: "stopped", since: this.iso(), nextRetryAt: null };
    this.client.end(true);
  }

  private handleConnect(): void {
    this.clearTimer();
    const recovered = this.status.attempts;
    this.wasConnected = true;
    this.status = {
      ...this.status,
      state: "connected",
      since: this.iso(),
      attempts: 0,
      lastConnectedAt: this.iso(),
      nextRetryAt: null
    };
    if (recovered > 0) this.options.log.info(`mqtt reconnected after ${recovered} attempt(s)`);
    this.options.onConnect();
  }

  private handleClose(): void {
    if (this.stopped) return;
    // A close while a retry is already scheduled (the stream emits close after
    // error, for instance) must not schedule a second one.
    if (this.timer) return;

    if (this.status.state === "connected") {
      this.status = { ...this.status, disconnects: this.status.disconnects + 1 };
      this.options.log.warn("mqtt connection lost");
    }

    const attempts = this.status.attempts + 1;
    const delay = backoffDelay(attempts, this.options);
    this.status = {
      ...this.status,
      state: this.wasConnected ? "reconnecting" : "connecting",
      since: this.status.state === "connected" ? this.iso() : this.status.since,
      attempts,
      nextRetryAt: new Date(this.now() + delay).toISOString()
    };
    this.options.log.warn(`mqtt retry ${attempts} in ${delay} ms`);

    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.client.reconnect();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }
}
