import { useTheme } from "../theme-provider";
import { describeServices, type ResearcherSession } from "../researcher";

/**
 * The researcher badge, top-right of the topbar.
 *
 * A solid red block, not a form: it answers "who is this console acting as?"
 * at a glance. The wording avoids "sign in" on purpose - there is no account
 * and no login page, only a code that has (or has not) been verified.
 */
export function ResearcherCard({
  researcher,
  service,
  busy,
  onAskCode,
  onSignOut
}: {
  researcher: ResearcherSession | null;
  service: string;
  busy?: boolean;
  onAskCode: () => void;
  onSignOut: () => void;
}) {
  const { theme: t } = useTheme();

  return (
    <div
      className="researcher-card"
      role="status"
      aria-label="Researcher session"
      style={{ background: t.primary, borderColor: t.primaryHi, color: t.onPrimary }}
    >
      {researcher ? (
        <>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.25 }}>
            <span className="rc-label">Verified researcher</span>
            <span className="rc-name">{researcher.name ?? researcher.code}</span>
            <span className="rc-code" title={describeServices(researcher)}>
              {researcher.code}
              {researcher.status === "defunct" ? " · defunct" : ""}
            </span>
          </span>
          <button type="button" onClick={onSignOut} title="Forget this code and return to read-only">
            Clear
          </button>
        </>
      ) : (
        <>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.25 }}>
            <span className="rc-label">Researcher code</span>
            <span className="rc-name">Not verified</span>
            <span className="rc-code">read-only · {service.toUpperCase()}</span>
          </span>
          <button type="button" onClick={onAskCode} disabled={busy} title="Verify a researcher code — there is no account to log into">
            Enter Code
          </button>
        </>
      )}
    </div>
  );
}
