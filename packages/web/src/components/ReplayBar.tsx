import { useTheme } from "../theme-provider";
import { fmtDateTime, fmtTime } from "../format";
import { Btn } from "./ui";
import type { ReplaySession } from "../views/ReplayView";

/**
 * The bottom rail.
 *
 * It is mounted whether or not a replay is running, because "you are looking at
 * live data" is information the operator should be able to check without
 * leaving the panel they are reading. When a replay is loaded the same rail
 * becomes the transport: step, scrub, speed, and a way back to live.
 *
 * Every button is a discrete cursor move rather than a video control, so an
 * incident can be reviewed one minute at a time.
 */
export function ReplayBar({
  session,
  onTogglePlay,
  onSeek,
  onStep,
  onSpeed,
  onLive,
  onOpenReplay
}: {
  session: ReplaySession | null;
  onTogglePlay: () => void;
  onSeek: (cursor: number) => void;
  onStep: (seconds: number) => void;
  onSpeed: (speed: number) => void;
  onLive: () => void;
  onOpenReplay: () => void;
}) {
  const { theme: t } = useTheme();

  const live = session === null;
  const start = session ? (session.readings.length > 0 ? Date.parse(session.readings[0].observedAt) : Date.parse(session.from)) : 0;
  const end = session
    ? session.readings.length > 0
      ? Date.parse(session.readings[session.readings.length - 1].observedAt)
      : Date.parse(session.to)
    : 1;
  const span = Math.max(end - start, 1);
  const toPercent = (value: number) => `${Math.min(100, Math.max(0, ((value - start) / span) * 100))}%`;

  const cursorPercent = live ? "100%" : toPercent(session!.cursor);
  const pastPercent = live ? "100%" : toPercent(session!.cursor);

  return (
    <footer className="replay" aria-label="Replay transport">
      <div className={live ? "replay-state live" : "replay-state"}>
        <b>{live ? "Live" : "Replay"}</b>
        <span className="between" style={{ color: live ? t.muted : t.text }}>
          {live ? "following telemetry" : `${fmtTime(session!.from)} – ${fmtTime(session!.to)} UTC`}
        </span>
      </div>

      <div className="transport">
        <button className="tbtn" type="button" title="Jump back 15 minutes" disabled={live} onClick={() => onStep(-900)}>
          −15
        </button>
        <button className="tbtn" type="button" title="Step back one minute" disabled={live} onClick={() => onStep(-60)}>
          ◀◀
        </button>
        <button
          className="tbtn play"
          type="button"
          title={session?.playing ? "Pause" : "Play"}
          disabled={live}
          onClick={onTogglePlay}
        >
          {session?.playing ? "❚❚" : "▶"}
        </button>
        <button className="tbtn" type="button" title="Step forward one minute" disabled={live} onClick={() => onStep(60)}>
          ▶▶
        </button>
        <button className="tbtn" type="button" title="Jump forward 15 minutes" disabled={live} onClick={() => onStep(900)}>
          +15
        </button>
      </div>

      <div className="timeline">
        <div className="tl-track">
          <div className="tl-rail" style={{ background: t.rail }} />
          <div className="tl-past" style={{ background: t.railPast, width: pastPercent }} />
          <div className="tl-window" style={{ left: "0%", width: "100%", background: t.tlWindowBg, borderColor: t.tlWindowBorder }} />
          <div className="tl-cursor" style={{ left: cursorPercent, background: t.cursor }} />
          {!live ? (
            <input
              className="tl-input"
              type="range"
              min={start}
              max={Math.max(end, start + 1)}
              value={session!.cursor}
              onChange={(event) => onSeek(Number(event.target.value))}
              aria-label="Replay timeline"
            />
          ) : null}
        </div>
        <div className="tl-marks">
          {live ? (
            <>
              <span>live</span>
              <span style={{ color: t.muted2 }}>
                last 30 min captured · {new Date().toISOString().slice(11, 16)} UTC
              </span>
            </>
          ) : (
            <>
              <span>{fmtTime(session!.from)}</span>
              <span>{fmtDateTime(new Date(session!.cursor).toISOString())}</span>
              <span>{fmtTime(session!.to)}</span>
            </>
          )}
        </div>
      </div>

      <div className="speed">
        {[0.5, 1, 4, 16].map((speed) => (
          <button
            key={speed}
            type="button"
            className={!live && session!.speed === speed ? "on" : undefined}
            disabled={live}
            onClick={() => onSpeed(speed)}
          >
            {speed}×
          </button>
        ))}
        {live ? (
          <button type="button" className="on" onClick={onOpenReplay} title="Pick a window to replay">
            Open replay
          </button>
        ) : (
          <button type="button" onClick={onLive} title="Return to live telemetry">
            Live
          </button>
        )}
      </div>

      {live ? null : (
        <Btn onClick={onLive} title="Leave the replay and follow telemetry again">
          Exit
        </Btn>
      )}
    </footer>
  );
}
