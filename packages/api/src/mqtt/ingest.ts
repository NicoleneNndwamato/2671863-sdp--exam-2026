import type { ParsedMessage } from "@sdp/shared";

export interface IngestWriter {
  writeBatch(messages: ParsedMessage[]): Promise<void>;
}

export interface IngestOptions {
  /** Rows per INSERT. Postgres handles this far better than one row at a time. */
  maxBatch: number;
  /** Hard cap on buffered rows before we start dropping the oldest. */
  maxQueue: number;
}

/**
 * Buffers decoded messages and writes them in batches.
 *
 * At 100 dishes each emitting once per second during a scan, a row-per-message
 * writer melts both the network and the database. Dropping the oldest message
 * under sustained overload is deliberate: live data is worth more than backlog
 * for a monitoring tool, and the drop count is exposed so it is visible rather
 * than silent.
 */
export class IngestBuffer {
  private queue: ParsedMessage[] = [];
  private flushing = false;
  private dropped = 0;
  private written = 0;

  constructor(
    private readonly writer: IngestWriter,
    private readonly options: IngestOptions
  ) {}

  add(message: ParsedMessage): void {
    if (this.queue.length >= this.options.maxQueue) {
      this.queue.shift();
      this.dropped += 1;
    }
    this.queue.push(message);
  }

  get size(): number {
    return this.queue.length;
  }

  get stats(): { queued: number; dropped: number; written: number } {
    return { queued: this.queue.length, dropped: this.dropped, written: this.written };
  }

  /** Drain the queue. Safe to call on a timer: overlapping calls are ignored. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.options.maxBatch);
        await this.writer.writeBatch(batch);
        this.written += batch.length;
      }
    } finally {
      this.flushing = false;
    }
  }
}
