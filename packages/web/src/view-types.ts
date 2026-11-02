import type { Reading, ServiceTopology } from "@sdp/shared";
import type { Target } from "./api";
import type { ControlSubmit } from "./components/ControlPanel";
import type { Snapshot } from "./snapshot";

/**
 * The contract every service panel implements.
 *
 * A panel receives "the current state of every topic", "recent history" and a
 * submit callback. It knows nothing about polling, replay, or authentication -
 * which is what lets the same RTA panel render a live array and a 14:32 replay
 * of the same event without a second implementation.
 */
export interface ViewProps {
  service: string;
  displayName: string;
  topology: ServiceTopology | null;
  snapshot: Snapshot;
  history: Reading[];
  onSubmit: ControlSubmit;
  canControl: boolean;
  /** Why control is unavailable, when it is: replay, no code, or wrong experiment. */
  actHint?: string;
  targets: Target[];
  /** Present only in replay: the instant being rendered. */
  replayAt?: string | null;
}
