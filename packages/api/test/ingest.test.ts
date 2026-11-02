import type { ParsedMessage } from "@sdp/shared";
import { IngestBuffer, type IngestWriter } from "../src/mqtt/ingest";

function message(n: number): ParsedMessage {
  return {
    service: "rta",
    device: `dish-${n}`,
    topic: `arl/rta/dish-${n}/telemetry`,
    observedAt: new Date(0),
    data: { n }
  };
}

function recordingWriter(): IngestWriter & { batches: ParsedMessage[][] } {
  const batches: ParsedMessage[][] = [];
  return {
    batches,
    async writeBatch(messages) {
      batches.push(messages);
    }
  };
}

describe("IngestBuffer", () => {
  it("writes in batches rather than one row per message", async () => {
    const writer = recordingWriter();
    const buffer = new IngestBuffer(writer, { maxBatch: 2, maxQueue: 100 });

    for (let i = 0; i < 5; i++) buffer.add(message(i));
    await buffer.flush();

    expect(writer.batches.map((b) => b.length)).toEqual([2, 2, 1]);
    expect(buffer.stats.written).toBe(5);
    expect(buffer.size).toBe(0);
  });

  it("drops the oldest message when the queue is full and counts the loss", async () => {
    const writer = recordingWriter();
    const buffer = new IngestBuffer(writer, { maxBatch: 10, maxQueue: 2 });

    buffer.add(message(1));
    buffer.add(message(2));
    buffer.add(message(3));

    expect(buffer.size).toBe(2);
    expect(buffer.stats.dropped).toBe(1);

    await buffer.flush();
    expect(writer.batches[0].map((m) => m.device)).toEqual(["dish-2", "dish-3"]);
  });

  it("ignores overlapping flushes instead of double-writing", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;

    const buffer = new IngestBuffer(
      {
        async writeBatch() {
          calls += 1;
          await gate;
        }
      },
      { maxBatch: 10, maxQueue: 100 }
    );

    buffer.add(message(1));
    const first = buffer.flush();
    const second = buffer.flush();
    release();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
  });
});
