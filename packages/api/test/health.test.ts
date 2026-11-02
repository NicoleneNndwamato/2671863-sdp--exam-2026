import { buildApp } from "../src/app";

describe("health", () => {
  it("reports ok without touching the database", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });

    await app.close();
  });
});
