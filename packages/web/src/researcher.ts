import type { ResearcherProfile } from "./api";

/**
 * Researcher identity, held in `sessionStorage` on purpose.
 *
 * The brief is "no authentication": nobody signs into the platform, every panel
 * is readable, and only *interaction* needs a code. So this is not a login - it
 * is a badge that says which code will be attached to the next command.
 *
 * `sessionStorage` rather than `localStorage` because the requirement is that
 * the researcher's session ends when they leave: closing the tab drops the
 * code, while a refresh inside the same tab keeps it.
 */

export type ResearcherSession = ResearcherProfile;

const STORAGE_KEY = "meridian.researcher";

export function loadResearcher(): ResearcherSession | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResearcherSession>;
    if (typeof parsed.code !== "string" || parsed.code.trim().length === 0) return null;
    return {
      code: parsed.code,
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      experiments: Array.isArray(parsed.experiments)
        ? parsed.experiments.filter((value): value is string => typeof value === "string")
        : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined
    };
  } catch {
    // Storage can be unavailable (private browsing, disabled cookies). The
    // console still works, it just asks for the code each time.
    return null;
  }
}

export function saveResearcher(researcher: ResearcherSession): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(researcher));
  } catch {
    // Nothing to do: the in-memory session is still valid for this page.
  }
}

export function clearResearcher(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * May this researcher operate this service?
 *
 * Answered from the profile the ARL API returned. A missing experiment list is
 * treated as "unknown, let the server decide" rather than "no access", because
 * the API's verify endpoint - not this function - is authoritative; the check
 * here only exists so the operator gets an answer without a round trip.
 */
export function canOperate(researcher: ResearcherSession | null, service: string): boolean {
  if (!researcher) return false;
  if (researcher.status === "defunct") return false;
  if (!researcher.experiments) return true;
  return researcher.experiments.includes(service);
}

/** Human sentence for the `reason` the verify endpoint returns. */
export function refusalText(reason: string | undefined, service: string): string {
  switch (reason) {
    case "unknown":
      return "The ARL API does not know that researcher code.";
    case "defunct":
      return "That researcher is marked defunct and may not control anything.";
    case "not_permitted":
      return `That code is valid, but its experiments do not include ${service.toUpperCase()}.`;
    case "api_unreachable":
      return "The ARL API could not be reached, so the code could not be verified.";
    case "missing":
      return "Enter a researcher code.";
    default:
      return reason ? `The code was refused (${reason}).` : "The code was refused.";
  }
}

export function describeServices(researcher: ResearcherSession): string {
  if (!researcher.experiments || researcher.experiments.length === 0) return "no experiments listed";
  return researcher.experiments.join(" · ");
}
