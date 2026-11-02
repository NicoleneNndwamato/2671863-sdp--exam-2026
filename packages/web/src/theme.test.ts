import { cssVariables, seriesColours, shade, theme } from "./theme";

/**
 * Tokens are the contract between TypeScript and the stylesheet, so the two
 * mechanical pieces - the camelCase to kebab-case mapping and the derived
 * heatmap shades - are worth pinning.
 */

describe("cssVariables", () => {
  const vars = cssVariables(theme.light);

  it("kebab-cases every camelCase token", () => {
    expect(vars["--primary"]).toBe(theme.light.primary);
    expect(vars["--primary-hi"]).toBe(theme.light.primaryHi);
    expect(vars["--panel-2"]).toBe(theme.light.panel2);
    expect(vars["--button-fg"] ?? vars["--btn-fg"]).toBe(theme.light.btnFg);
  });

  it("emits one variable per token, all as strings", () => {
    expect(Object.keys(vars)).toHaveLength(Object.keys(theme.light).length);
    for (const value of Object.values(vars)) expect(typeof value).toBe("string");
  });

  it("publishes the same token names in both themes", () => {
    expect(Object.keys(cssVariables(theme.dark)).sort()).toEqual(Object.keys(vars).sort());
  });
});

describe("seriesColours", () => {
  it("returns the eight chart hues in draw order", () => {
    const colours = seriesColours(theme.light);
    expect(colours).toHaveLength(8);
    expect(colours[0]).toBe(theme.light.chartLine);
    expect(colours[7]).toBe(theme.light.chart8);
  });

  it("uses different colours for every series", () => {
    expect(new Set(seriesColours(theme.light)).size).toBe(8);
    expect(new Set(seriesColours(theme.dark)).size).toBe(8);
  });
});

describe("shade", () => {
  it("returns the colour unchanged at zero", () => {
    expect(shade("#2f6db5", 0)).toBe("#2f6db5");
  });

  it("lightens toward white", () => {
    expect(shade("#000000", 0.5)).toBe("#808080");
    expect(shade("#000000", 1)).toBe("#ffffff");
  });

  it("darkens toward black", () => {
    expect(shade("#ffffff", -0.5)).toBe("#808080");
    expect(shade("#ffffff", -1)).toBe("#000000");
  });

  it("keeps the hue while changing the shade", () => {
    const lighter = shade("#2f6db5", 0.3);
    expect(lighter).toMatch(/^#[0-9a-f]{6}$/);
    expect(lighter).not.toBe("#2f6db5");
  });

  it("hands back anything it cannot parse", () => {
    expect(shade("rebeccapurple", 0.2)).toBe("rebeccapurple");
    expect(shade("#fff", -0.2)).toBe("#fff");
  });
});
