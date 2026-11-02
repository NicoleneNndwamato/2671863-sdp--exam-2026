import type { ParsedMessage } from "@sdp/shared";
import { db } from "../db/client";
import { rawMessages } from "../db/schema";
import type { IngestWriter } from "./ingest";
import { evaluateAlerts } from "../alerts/engine";

export const postgresWriter: IngestWriter = {
  async writeBatch(messages: ParsedMessage[]): Promise<void> {
    if (messages.length === 0) return;

    // Trigger alert evaluation for each message (non-blocking)
    messages.forEach((msg) => {
      evaluateAlerts(msg).catch((err) => {
        console.error("Alert evaluation failed:", err);
      });
    });

    await db.insert(rawMessages).values(
      messages.map((m) => ({
        service: m.service,
        device: m.device ?? null,
        topic: m.topic,
        observedAt: m.observedAt,
        payload: m.data as Record<string, unknown>
      }))
    );
  }
};
