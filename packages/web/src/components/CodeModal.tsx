import { useEffect, useRef, useState } from "react";
import { fetchResearcher, verifyResearcher, type ApiError } from "../api";
import { describeServices, refusalText, type ResearcherSession } from "../researcher";
import { useTheme } from "../theme-provider";
import { Btn } from "./ui";

/**
 * What the operator was trying to do when the console asked for a code.
 *
 * Kept as a description rather than a callback so the modal stays dumb: the
 * caller decides what happens once the code is accepted, which is what lets one
 * dialog serve controls, acknowledgements and resolutions.
 */
export interface GateRequest {
  service: string;
  label: string;
}

/**
 * The only interruption in the product.
 *
 * Nothing is hidden behind it - a researcher can read everything without ever
 * seeing this dialog - it appears exactly when someone asks the lab to do
 * something, and it says who is asking. The code is verified against the ARL
 * API for the specific service before the action is allowed through.
 */
export function CodeModal({
  request,
  initialCode = "",
  onCancel,
  onGranted
}: {
  request: GateRequest;
  /** Prefilled when the operator arrived from the researcher lookup screen. */
  initialCode?: string;
  onCancel: () => void;
  /**
   * A real code always yields a session - the card can then say who is at the
   * console - but `refusal` is set when that person is not assigned to the
   * service they were trying to touch, so the caller must not run the action.
   */
  onGranted: (researcher: ResearcherSession, refusal?: string) => void;
}) {
  const { theme: t } = useTheme();
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  /** Set when the code is real but not allowed here: it names the alternative. */
  const [known, setKnown] = useState<ResearcherSession | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    // Capture phase on the document: Escape must close the dialog no matter
    // which element holds focus, including nothing at all.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  async function submit() {
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Enter the code the ARL issued to you.");
      return;
    }

    setBusy(true);
    setError(null);
    setKnown(null);
    try {
      // Two questions, two endpoints: who is this, and may they touch this
      // service? The profile is what the card shows; the verify result is what
      // actually unlocks the command.
      let profile: ResearcherSession;
      try {
        profile = await fetchResearcher(trimmed);
      } catch (err) {
        const status = (err as ApiError).status;
        setError(status === 404 ? "The ARL API does not know that researcher code." : (err as Error).message);
        return;
      }

      const check = await verifyResearcher(trimmed, request.service);
      const session: ResearcherSession = { ...profile, code: profile.code || trimmed };

      // "Not permitted" is not the same as "not who you say you are": the code
      // is real, so the console still learns the name and records it. Only the
      // action is refused.
      if (!check.valid && check.reason === "not_permitted") {
        onGranted(session, refusalText(check.reason, request.service));
        return;
      }
      if (!check.valid) {
        setError(refusalText(check.reason, request.service));
        setKnown(profile);
        return;
      }

      onGranted(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-back"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onKeyDown={(event) => {
        // A second, local escape hatch: the window listener can miss the key
        // when the event is swallowed while the field has focus.
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="gate-title" style={{ background: t.panel, borderColor: t.line }}>
        <h3 id="gate-title" style={{ color: t.text }}>
          Researcher code required
        </h3>
        <p style={{ color: t.muted }}>
          <b style={{ color: t.text }}>{request.label}</b> changes the state of the lab, so the console records
          who asked for it. Reading data needs no code.
        </p>

        <input
          ref={input}
          aria-label="Researcher code"
          value={code}
          placeholder="arl-xxx"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
            // The dialog's own escape hatch: works even if the document-level
            // listener never sees the event.
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          style={{ background: t.panel3, borderColor: error ? t.critBorder : t.line, color: t.text }}
        />

        {error ? (
          <p role="alert" style={{ marginTop: 8, color: t.crit, fontSize: 12 }}>
            {error}
            {known ? (
              <span style={{ display: "block", marginTop: 4, color: t.muted }}>
                {known.name ?? known.code} is assigned to {describeServices(known)}.
              </span>
            ) : null}
          </p>
        ) : (
          <p style={{ marginTop: 8, fontSize: 11, color: t.muted2 }}>
            Checked against the ARL API for {request.service.toUpperCase()} before anything is published.
          </p>
        )}

        <div className="modal-actions">
          <Btn onClick={onCancel} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Checking…" : "Verify"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
