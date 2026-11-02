import {
  canOperate,
  clearResearcher,
  describeServices,
  loadResearcher,
  refusalText,
  saveResearcher
} from "./researcher";

/**
 * The researcher code is the only thing standing between a curious visitor and
 * a live dish. These tests pin how it is stored, when it expires, and what the
 * console says when the ARL API refuses it.
 */

const session: Parameters<typeof saveResearcher>[0] = {
  code: "arl-as3",
  name: "Person A",
  experiments: ["rta", "mhe", "lwm", "pes"],
  status: "active"
};

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("session storage", () => {
  it("round-trips a verified researcher", () => {
    saveResearcher(session);
    expect(loadResearcher()).toEqual(session);
  });

  it("returns null when nothing has been verified", () => {
    expect(loadResearcher()).toBeNull();
  });

  it("forgets the code on request", () => {
    saveResearcher(session);
    clearResearcher();
    expect(loadResearcher()).toBeNull();
  });

  it("rejects a stored blob with no usable code", () => {
    window.sessionStorage.setItem("meridian.researcher", JSON.stringify({ name: "Person A" }));
    expect(loadResearcher()).toBeNull();

    window.sessionStorage.setItem("meridian.researcher", JSON.stringify({ code: "   " }));
    expect(loadResearcher()).toBeNull();
  });

  it("survives corrupt storage instead of taking the console down", () => {
    window.sessionStorage.setItem("meridian.researcher", "{not json");
    expect(loadResearcher()).toBeNull();
  });

  it("drops non-string experiments but keeps the code", () => {
    window.sessionStorage.setItem(
      "meridian.researcher",
      JSON.stringify({ code: "arl-as3", experiments: ["rta", 7, null], status: "active" })
    );
    expect(loadResearcher()).toEqual({ code: "arl-as3", name: undefined, experiments: ["rta"], status: "active" });
  });

  it("does not throw when storage itself is unavailable", () => {
    // jsdom exposes Storage methods on the prototype, so patch there.
    const spy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(loadResearcher()).toBeNull();
    spy.mockRestore();

    const setSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => saveResearcher(session)).not.toThrow();
    setSpy.mockRestore();

    const removeSpy = jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(() => clearResearcher()).not.toThrow();
    removeSpy.mockRestore();
  });
});

describe("canOperate", () => {
  it("refuses when nobody is verified", () => {
    expect(canOperate(null, "rta")).toBe(false);
  });

  it("lets the server decide when the profile lists no experiments", () => {
    expect(canOperate({ code: "arl-as3" }, "rta")).toBe(true);
  });

  it("refuses a defunct researcher outright", () => {
    expect(canOperate({ ...session, status: "defunct" }, "rta")).toBe(false);
  });

  it("checks the experiment list", () => {
    expect(canOperate(session, "rta")).toBe(true);
    expect(canOperate(session, "opg")).toBe(false);
  });
});

describe("refusalText", () => {
  it("explains every reason the API can give", () => {
    expect(refusalText("unknown", "rta")).toContain("does not know");
    expect(refusalText("defunct", "rta")).toContain("defunct");
    expect(refusalText("not_permitted", "opg")).toContain("OPG");
    expect(refusalText("api_unreachable", "rta")).toContain("could not be reached");
    expect(refusalText("missing", "rta")).toBe("Enter a researcher code.");
  });

  it("passes an unexpected reason through instead of hiding it", () => {
    expect(refusalText("rate_limited", "rta")).toBe("The code was refused (rate_limited).");
    expect(refusalText(undefined, "rta")).toBe("The code was refused.");
  });
});

describe("describeServices", () => {
  it("lists the experiments the code may touch", () => {
    expect(describeServices(session)).toBe("rta · mhe · lwm · pes");
  });

  it("says so when the profile is empty", () => {
    expect(describeServices({ code: "x", experiments: [] })).toBe("no experiments listed");
    expect(describeServices({ code: "x" })).toBe("no experiments listed");
  });
});
