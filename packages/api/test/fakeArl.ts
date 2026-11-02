/**
 * A stand-in for the ARL API's researcher endpoints, answering the way the
 * spec (arl-api-spec, section 2.1 and "Verify Researcher") says the real one
 * does. The register is a slice of the simulator's seed/researchers.csv, so
 * every case below is one a grader can reproduce against the live API.
 */
export const register: Record<string, { name: string; experiments: string[]; status: string }> = {
  "arl-as3": { name: "Person A", experiments: ["rta", "mhe", "lwm", "pes"], status: "active" },
  "arl-f2l": { name: "Person B", experiments: ["rta", "opg"], status: "active" },
  "arl-k9q": { name: "Person C", experiments: ["owt", "opg"], status: "defunct" },
  "arl-b7m": { name: "Thandi Mokoena", experiments: ["rta"], status: "active" },
  "arl-c2p": { name: "Pieter van Wyk", experiments: ["rta", "lwm"], status: "active" }
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

/** fetch() implementation that routes researcher calls through the register. */
export function fakeArlFetch(): jest.Mock<Promise<Response>, [string | URL | Request, RequestInit?]> {
  return jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));

    if (url.pathname === "/v1/researchers/verify" && init?.method === "POST") {
      const { code, service } = JSON.parse(String(init.body)) as { code: string; service: string };
      const who = register[code];
      if (!who) return json(200, { valid: false, reason: "unknown" });
      if (who.status !== "active") return json(200, { valid: false, reason: "defunct" });
      if (!who.experiments.includes(service)) return json(200, { valid: false, reason: "not_permitted" });
      return json(200, { valid: true, reason: null });
    }

    const profile = url.pathname.match(/^\/v1\/researchers\/([^/]+)$/);
    if (profile) {
      const code = decodeURIComponent(profile[1]);
      const who = register[code];
      if (!who) return json(404, { error: "not_found", detail: null });
      return json(200, { code, ...who });
    }

    return json(404, { error: "not_found", detail: null });
  });
}
