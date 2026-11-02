import type { FastifyReply, FastifyRequest } from "fastify";
import { fakeArlFetch } from "./fakeArl";

/**
 * Researcher verification is the only thing standing between a browser and a
 * command to a physical device, so every way it can say "no" is pinned here.
 *
 * Both modules keep module-level caches; each test loads fresh copies so one
 * test's cached verdict cannot leak into the next.
 */
jest.mock("../src/db/audit", () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));

type ResearcherModule = typeof import("../src/auth/researcher");
type MiddlewareModule = typeof import("../src/auth/middleware");

let researcher: ResearcherModule;
let middleware: MiddlewareModule;
let recordAudit: jest.Mock;
let fetchMock: ReturnType<typeof fakeArlFetch>;
const realFetch = global.fetch;

beforeEach(() => {
  jest.resetModules();
  fetchMock = fakeArlFetch();
  global.fetch = fetchMock as unknown as typeof fetch;
  researcher = require("../src/auth/researcher");
  middleware = require("../src/auth/middleware");
  recordAudit = require("../src/db/audit").recordAudit;
});

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

function calledUrl(n = 0): string {
  return String(fetchMock.mock.calls[n][0]);
}

describe("resolveResearcher", () => {
  it("returns the profile the ARL API holds for a known code", async () => {
    const profile = await researcher.resolveResearcher("arl-as3");

    expect(profile).toEqual({
      code: "arl-as3",
      name: "Person A",
      experiments: ["rta", "mhe", "lwm", "pes"],
      status: "active"
    });
    expect(calledUrl()).toBe("http://localhost:8080/v1/researchers/arl-as3");
  });

  it("trims and URL-encodes the code before asking", async () => {
    await researcher.resolveResearcher("  arl/../x  ");
    expect(calledUrl()).toBe("http://localhost:8080/v1/researchers/arl%2F..%2Fx");
  });

  it("does not call the API for a blank code", async () => {
    await expect(researcher.resolveResearcher("   ")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for an unknown code and remembers the 404", async () => {
    await expect(researcher.resolveResearcher("arl-zzz")).resolves.toBeNull();
    await expect(researcher.resolveResearcher("arl-zzz")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still returns a defunct researcher - the profile is not the permission check", async () => {
    const profile = await researcher.resolveResearcher("arl-k9q");
    expect(profile?.status).toBe("defunct");
  });

  it("caches a profile for a minute, then asks again", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    await researcher.resolveResearcher("arl-f2l");
    await researcher.resolveResearcher("arl-f2l");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + 61_000);
    await researcher.resolveResearcher("arl-f2l");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed and does not cache when the API errors", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(researcher.resolveResearcher("arl-as3")).resolves.toBeNull();
    await expect(researcher.resolveResearcher("arl-as3")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the API is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(researcher.resolveResearcher("arl-as3")).resolves.toBeNull();
  });

  it("drops malformed fields instead of trusting them", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: 42, experiments: ["rta", 7, null], status: true }), {
        status: 200
      })
    );
    await expect(researcher.resolveResearcher("arl-odd")).resolves.toEqual({
      code: "arl-odd",
      name: undefined,
      experiments: ["rta"],
      status: undefined
    });
  });

  it("leaves experiments undefined when the API omits them", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "arl-odd" }), { status: 200 }));
    const profile = await researcher.resolveResearcher("arl-odd");
    expect(profile?.experiments).toBeUndefined();
  });
});

describe("verifyResearcher", () => {
  it("allows an active researcher on one of their experiments", async () => {
    await expect(researcher.verifyResearcher("arl-as3", "rta")).resolves.toEqual({
      valid: true,
      reason: undefined
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8080/v1/researchers/verify");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ code: "arl-as3", service: "rta" });
  });

  it.each([
    ["arl-f2l", "lwm", "not_permitted"],
    ["arl-k9q", "opg", "defunct"],
    ["arl-nope", "rta", "unknown"]
  ])("refuses %s on %s with reason %s", async (code, service, reason) => {
    await expect(researcher.verifyResearcher(code, service)).resolves.toEqual({ valid: false, reason });
  });

  it("refuses a blank code without calling the API", async () => {
    await expect(researcher.verifyResearcher(" ", "rta")).resolves.toEqual({
      valid: false,
      reason: "missing"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only treats a literal `valid: true` as permission", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ valid: "yes" }), { status: 200 }));
    await expect(researcher.verifyResearcher("arl-as3", "rta")).resolves.toEqual({
      valid: false,
      reason: undefined
    });
  });

  it("reports the HTTP status when the API rejects the request", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    await expect(researcher.verifyResearcher("arl-as3", "rta")).resolves.toEqual({
      valid: false,
      reason: "api_503"
    });
  });

  it("fails closed when the API is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(researcher.verifyResearcher("arl-as3", "rta")).resolves.toEqual({
      valid: false,
      reason: "api_unreachable"
    });
  });

  it("caches per code and service, not per code", async () => {
    await researcher.verifyResearcher("arl-f2l", "rta");
    await researcher.verifyResearcher("arl-f2l", "rta");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(researcher.verifyResearcher("arl-f2l", "lwm")).resolves.toMatchObject({ valid: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-verifies after thirty seconds so a revoked researcher loses access", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(5_000_000);
    await researcher.verifyResearcher("arl-b7m", "rta");
    now.mockReturnValue(5_000_000 + 31_000);
    await researcher.verifyResearcher("arl-b7m", "rta");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("canAccessService", () => {
  it("matches only listed experiments", () => {
    const person = { code: "arl-f2l", experiments: ["rta", "opg"] };
    expect(researcher.canAccessService(person, "rta")).toBe(true);
    expect(researcher.canAccessService(person, "lwm")).toBe(false);
  });

  it("grants nothing when experiments are unknown", () => {
    expect(researcher.canAccessService({ code: "arl-x" }, "rta")).toBe(false);
  });
});

// --- The route guard --------------------------------------------------------

interface FakeReply {
  code: jest.Mock;
  send: jest.Mock;
  status?: number;
  body?: unknown;
}

function reply(): FakeReply {
  const r: FakeReply = {
    code: jest.fn((status: number) => {
      r.status = status;
      return r;
    }),
    send: jest.fn((body: unknown) => {
      r.body = body;
      return r;
    })
  };
  return r;
}

/** `id: null` models a route without a `:id` parameter. */
function request(code?: string | string[], id: string | null = "rta"): FastifyRequest {
  return {
    headers: code === undefined ? {} : { "x-researcher-code": code },
    params: id === null ? {} : { id },
    method: "POST",
    url: `/api/services/${id}/control`
  } as unknown as FastifyRequest;
}

const asReply = (r: FakeReply) => r as unknown as FastifyReply;

describe("requireResearcher", () => {
  it("answers 401 and audits the attempt when no code is sent", async () => {
    const r = reply();
    await middleware.requireResearcher(request(), asReply(r));

    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ error: "missing_researcher_code" });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "anonymous",
        action: "auth.missing_code",
        service: "rta",
        result: "rejected",
        detail: "POST /api/services/rta/control"
      })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 403 for a code the ARL API does not know", async () => {
    const r = reply();
    await middleware.requireResearcher(request("arl-nope"), asReply(r));

    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: "invalid_researcher_code" });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "arl-nope", action: "auth.unknown_code", result: "rejected" })
    );
  });

  it("attaches the verified profile to the request", async () => {
    const r = reply();
    const req = request("arl-as3");
    const who = await middleware.requireResearcher(req, asReply(r));

    expect(r.code).not.toHaveBeenCalled();
    expect(who).toMatchObject({ code: "arl-as3", name: "Person A" });
    expect(req.researcher?.code).toBe("arl-as3");
    expect(middleware.getResearcher(req).name).toBe("Person A");
  });

  it("uses the first value when the header is repeated", async () => {
    const req = request(["arl-f2l", "arl-as3"]);
    await middleware.requireResearcher(req, asReply(reply()));
    expect(req.researcher?.code).toBe("arl-f2l");
  });

  it("records a null service when the route has no :id", async () => {
    await middleware.requireResearcher(request(undefined, null), asReply(reply()));
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ service: null }));
  });
});

describe("requireServiceAccess", () => {
  async function guarded(code: string, service: string | null): Promise<FakeReply> {
    const req = request(code, service);
    await middleware.requireResearcher(req, asReply(reply()));
    const r = reply();
    await middleware.requireServiceAccess(req, asReply(r));
    return r;
  }

  it("lets an active researcher through on their own experiment", async () => {
    const r = await guarded("arl-as3", "lwm");
    expect(r.code).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses a researcher outside the service's experiment", async () => {
    const r = await guarded("arl-f2l", "lwm");

    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: "service_access_denied", reason: "not_permitted" });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "arl-f2l",
        action: "auth.service_denied",
        service: "lwm",
        detail: "not_permitted",
        result: "rejected"
      })
    );
  });

  it("refuses a defunct researcher even on a listed experiment", async () => {
    const r = await guarded("arl-k9q", "opg");
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ reason: "defunct" });
  });

  it("refuses when the ARL API cannot be asked", async () => {
    const req = request("arl-as3", "rta");
    await middleware.requireResearcher(req, asReply(reply()));
    fetchMock.mockRejectedValue(new Error("down"));

    const r = reply();
    await middleware.requireServiceAccess(req, asReply(r));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ reason: "api_unreachable" });
  });

  it("answers 400 when there is no service to check against", async () => {
    const r = await guarded("arl-as3", null);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: "missing_service" });
  });

  it("answers 401 when run without requireResearcher first", async () => {
    const r = reply();
    await middleware.requireServiceAccess(request("arl-as3"), asReply(r));
    expect(r.status).toBe(401);
  });

  it("getResearcher refuses to invent an identity", () => {
    expect(() => middleware.getResearcher(request("arl-as3"))).toThrow(/requireResearcher/);
  });
});
