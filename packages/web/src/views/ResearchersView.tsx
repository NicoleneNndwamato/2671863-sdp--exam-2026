import { useState } from "react";
import { fetchResearcher, verifyResearcher, type ResearcherProfile } from "../api";
import { useTheme } from "../theme-provider";
import { Badge, Btn, DetailRow, Empty, Field, Panel, TextInput } from "../components/ui";
import { canOperate, describeServices, type ResearcherSession } from "../researcher";

/**
 * Active researchers.
 *
 * There is no sign-in to build: a researcher is identified by a code issued by
 * the ARL, and the API is the only authority on what that code may do. This
 * screen says who this tab is currently acting as, and lets an operator check a
 * code before handing it over, so the reviewer can see that the check is real
 * rather than cosmetic.
 */
export function ResearchersView({
  researcher,
  activeCode,
  onUseCode,
  onSignOut
}: {
  researcher: ResearcherSession | null;
  activeCode: string;
  onUseCode: (code: string) => void;
  onSignOut: () => void;
}) {
  const { theme: t } = useTheme();
  const [code, setCode] = useState(activeCode);
  const [profile, setProfile] = useState<ResearcherProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, { valid: boolean; reason?: string }>>({});
  const [busy, setBusy] = useState(false);

  async function lookup() {
    setBusy(true);
    setError(null);
    setProfile(null);
    setVerdicts({});
    try {
      const found = await fetchResearcher(code.trim());
      setProfile(found);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function check(service: string) {
    setBusy(true);
    try {
      const verdict = await verifyResearcher(code.trim(), service);
      setVerdicts((previous) => ({ ...previous, [service]: verdict }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Panel
        title="Verified in this tab"
        subtitle="held in sessionStorage, so it lasts until the tab is closed"
        actions={
          researcher ? (
            <Btn variant="ghost" onClick={onSignOut}>
              Clear code
            </Btn>
          ) : null
        }
      >
        {researcher ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <Badge tone={researcher.status === "defunct" ? "crit" : "ok"}>
                {researcher.status === "defunct" ? "defunct" : "verified"}
              </Badge>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{researcher.name ?? researcher.code}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: t.muted }}>{researcher.code}</span>
            </div>
            <DetailRow label="Experiments" value={describeServices(researcher)} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {[["rta", "RTA"], ["lwm", "LWM"], ["opg", "OPG"]].map(([id, label]) => (
                <Badge key={id} tone={canOperate(researcher, id) ? "ok" : "neutral"}>
                  {label}: {canOperate(researcher, id) ? "may control" : "read-only"}
                </Badge>
              ))}
            </div>
          </>
        ) : (
          <Empty>No code verified. Everything stays readable; controls ask for a code when you press them.</Empty>
        )}
      </Panel>

      <Panel title="Researcher lookup" subtitle="codes are issued by the ARL API; there is no sign-in">
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <Field label="Researcher code" htmlFor="researcher-code-input" hint="Sent to GET /v1/researchers/{code}">
            <TextInput id="researcher-code-input" value={code} onChange={setCode} placeholder="e.g. RES-042" mono />
          </Field>
          <Btn variant="primary" onClick={() => void lookup()} disabled={busy || code.trim().length === 0}>
            Look up
          </Btn>
          <Btn
            variant="ok"
            onClick={() => onUseCode(code.trim())}
            disabled={code.trim().length === 0}
            title="Use this code for control actions in this browser"
          >
            Use code
          </Btn>
        </div>

        <div style={{ marginTop: 12 }}>
          {error ? (
            <div style={{ padding: "8px 10px", background: t.warnBg, border: `1px solid ${t.warnBorder}`, color: t.warn, fontSize: 12 }}>
              {error === "unknown_researcher" ? `No researcher with code ${code}.` : error}
            </div>
          ) : profile ? (
            <>
              <DetailRow label="Code" value={profile.code} />
              <DetailRow label="Name" value={profile.name ?? "—"} />
              <DetailRow label="Status" value={profile.status ?? "—"} />
              <DetailRow label="Experiments" value={profile.experiments?.join(", ") ?? "none assigned"} />

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: t.muted, marginBottom: 6 }}>
                  Ask the API per service
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {["rta", "lwm", "opg", "mhe", "owt"].map((service) => (
                    <Btn key={service} onClick={() => void check(service)} disabled={busy}>
                      verify {service}
                    </Btn>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {Object.entries(verdicts).map(([service, verdict]) => (
                    <Badge key={service} tone={verdict.valid ? "ok" : "crit"}>
                      {service}: {verdict.valid ? "allowed" : verdict.reason ?? "denied"}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <Empty>Look up a code to see what the ARL API says about it.</Empty>
          )}
        </div>
      </Panel>

      <Panel title="How control is protected" subtitle="the browser never decides this">
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7, color: t.text }}>
          <li>
            Every mutating request carries the operator's code in <code>x-researcher-code</code>.
          </li>
          <li>
            The API calls <code>GET /v1/researchers/{"{code}"}</code> to confirm the code exists.
          </li>
          <li>
            It then calls <code>POST /v1/researchers/verify</code> to ask whether that code may operate the specific
            service. A code that is valid but not assigned to an experiment is refused.
          </li>
          <li>
            Unknown codes, missing headers and an unreachable ARL API all fail closed — control is refused rather than
            assumed.
          </li>
          <li>
            Every attempt, including refusals, is written to the audit log with the actor, service, entity and the exact
            value that was sent.
          </li>
        </ol>
        <div style={{ marginTop: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <Badge tone={activeCode ? "ok" : "warn"}>{activeCode ? `session code: ${activeCode}` : "no code entered"}</Badge>
        </div>
        <p style={{ fontSize: 11, color: t.muted, marginTop: 10, lineHeight: 1.6 }}>
          Thresholds follow the same principle: the alert engine reads them from
          <code> /v1/alert-limits/{"{service}"}</code> every five minutes, so the numbers on this platform are the numbers
          the laboratory publishes.
        </p>
      </Panel>
    </div>
  );
}
