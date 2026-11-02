/**
 * Meridian Design System - Theme Tokens
 *
 * Ported value-for-value from the supplied mockup so the built console and the
 * design reference read as the same product: sharp corners everywhere, navy used
 * only for brand and for "this is the active thing", everything else neutral.
 * Red is reserved for critical alerts and faults, so it always means trouble.
 */

export const theme = {
  light: {
    // Primary brand (navy - use sparingly)
    primary: "#1b2f5e",
    primaryHi: "#2a4482",
    primaryRgb: "27, 47, 94",

    // Backgrounds
    bg: "#f4f4f6",
    panel: "#ffffff",
    panel2: "#f0f0f3",
    panelSunken: "#fbfbfc",
    panel3: "#f6f6f8",

    // Borders
    line: "#e3e3e8",
    lineSoft: "#ededf0",
    // Ruled tables need a rule you can actually see; --line is a hairline for
    // card edges, which disappears between white cells.
    tableRule: "#93939e",

    // Text
    text: "#1c1c1e",
    // Secondary text, darkened to #555 so hints and labels hold up on white
    // without having to be bolded.
    muted: "#555555",
    muted2: "#5c5c5c",
    muted3: "#707070",
    navFg: "#333638",
    btnFg: "#333638",
    strong: "#24282a",
    onPrimary: "#ffffff",

    // Semantic colours
    crit: "#c8323f",
    critFg: "#ffffff",
    critBg: "rgba(200, 50, 63, 0.07)",
    critBorder: "rgba(200, 50, 63, 0.32)",

    warn: "#a4620a",
    warnFg: "#ffffff",
    warnBg: "#fdf3e3",
    warnBorder: "#e0bd85",

    info: "#2c62a8",
    infoFg: "#ffffff",
    infoBg: "#eaf1fb",
    infoBorder: "#b9cfe9",

    ok: "#24784c",
    okFg: "#ffffff",
    okBg: "#e8f5ee",

    // Active / replay accents
    chipOnBg: "rgba(27, 47, 94, 0.10)",
    tlWindowBg: "rgba(27, 47, 94, 0.16)",
    tlWindowBorder: "rgba(27, 47, 94, 0.40)",

    // UI elements
    dot: "#4b4b54",
    cursor: "#1c1c1e",
    rail: "#e6e6ea",
    railPast: "#b9b9c2",

    // Charts. chartLine is the default series colour; chart2..chart8 are the
    // categorical palette. Separate hues, not tints of one colour, so a chart
    // with four series stays readable in greyscale print and for colour-blind
    // readers (blue / teal / violet / plum / ochre / slate / olive / brick).
    chartLine: "#2f6db5",
    chartFill: "#2f6db5",
    chart2: "#17868b",
    chart3: "#5f5aa8",
    chart4: "#9c4b7d",
    chart5: "#b4610f",
    chart6: "#4f6b57",
    chart7: "#7a6a12",
    chart8: "#8c3547",
    gridline: "#ececef",
    axis: "#d8d8de",
    axisLabel: "#555555",

    // Heatmap
    heatCool: "#588fcb",
    heatMid: "#bac5cf",
    heatHot: "#c96f1c",
    scanLo: "#d7e8f2",
    scanHi: "#1f5c96",

    // Dish states. Offline is a dark square with a light outline, so a dish
    // that has stopped reporting is unmistakable rather than merely pale.
    dishOfflineBg: "#4d4d55",
    dishOfflineBorder: "#a9a9b4",
    dishOfflineInk: "#f4f4f5",

    // Misc
    shadow: "0 1px 2px rgba(20, 20, 26, 0.05)"
  },

  dark: {
    // Primary brand (navy, lifted a step so it still reads on the dark panels)
    primary: "#2a4a8c",
    primaryHi: "#3a5fa8",
    primaryRgb: "42, 74, 140",

    // Backgrounds
    bg: "#17171a",
    panel: "#1f1f23",
    panel2: "#26262b",
    panelSunken: "#1b1b1f",
    panel3: "#151518",

    // Borders
    line: "#33333a",
    lineSoft: "#2a2a30",
    tableRule: "#6a6a77",

    // Text
    text: "#f4f4f5",
    muted: "#9ea1a1",
    muted2: "#8b8e8e",
    muted3: "#737676",
    navFg: "#c9cbcc",
    btnFg: "#dcdedf",
    strong: "#c9cbcc",
    onPrimary: "#ffffff",

    // Semantic colours
    crit: "#f2606f",
    critFg: "#2b0b0f",
    critBg: "rgba(242, 96, 111, 0.14)",
    critBorder: "rgba(242, 96, 111, 0.45)",

    warn: "#e3a44f",
    warnFg: "#2a1c06",
    warnBg: "rgba(227, 164, 79, 0.14)",
    warnBorder: "rgba(227, 164, 79, 0.42)",

    info: "#7fb0ea",
    infoFg: "#08172b",
    infoBg: "rgba(127, 176, 234, 0.14)",
    infoBorder: "rgba(127, 176, 234, 0.40)",

    ok: "#45bb80",
    okFg: "#06231a",
    okBg: "rgba(69, 187, 128, 0.14)",

    // Active / replay accents
    chipOnBg: "rgba(42, 74, 140, 0.28)",
    tlWindowBg: "rgba(42, 74, 140, 0.45)",
    tlWindowBorder: "rgba(58, 95, 168, 0.75)",

    // UI elements
    dot: "#d8dadb",
    cursor: "#ffffff",
    rail: "#2c2c33",
    railPast: "#6f7373",

    // Charts
    chartLine: "#6aa8ea",
    chartFill: "#3f7fc4",
    chart2: "#4fc3c7",
    chart3: "#9a93e6",
    chart4: "#e08ab6",
    chart5: "#e0a34f",
    chart6: "#8fbf9f",
    chart7: "#cbc25e",
    chart8: "#e0788b",
    gridline: "#2a2a30",
    axis: "#3a3a42",
    axisLabel: "#8b8e8e",

    // Heatmap
    heatCool: "#4f83bb",
    heatMid: "#70808d",
    heatHot: "#c98a3c",
    scanLo: "#1b2f4a",
    scanHi: "#7fd6ea",

    // Dish states
    dishOfflineBg: "#3a3a42",
    dishOfflineBorder: "#7c7c88",
    dishOfflineInk: "#dcdedf",

    // Misc
    shadow: "none"
  }
};

export type Theme = typeof theme.light;

/**
 * The same tokens as CSS custom properties.
 *
 * Layout lives in CSS (columns and breakpoints cannot be expressed inline), and
 * that CSS needs the palette. Writing the vars from one source keeps the design
 * system single-sourced instead of duplicating hex codes in two places.
 */
export function cssVariables(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme)) {
    // camelCase -> kebab-case, and a dash before a trailing digit so that
    // `panel2` becomes `--panel-2` - which is how styles.css spells it.
    const name = key
      .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
      .replace(/(?<=[a-z])(\d)/g, "-$1");
    out[`--${name}`] = String(value);
  }
  return out;
}

/**
 * The categorical series palette, in draw order.
 *
 * Charts ask for a colour by position, so three series are always blue, teal and
 * violet no matter which page they appear on - the same reading looks the same
 * in two places.
 */
export function seriesColours(theme: Theme): string[] {
  return [
    theme.chartLine,
    theme.chart2,
    theme.chart3,
    theme.chart4,
    theme.chart5,
    theme.chart6,
    theme.chart7,
    theme.chart8
  ];
}

/**
 * Move a hex colour toward white (amount > 0) or black (amount < 0).
 *
 * The heatmap needs several shades inside one band - "green" is four different
 * greens - and deriving them from the band colour keeps every shade in the same
 * hue, so the band is still obvious at a glance.
 */
export function shade(hex: string, amount: number): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return hex;
  const target = amount >= 0 ? 255 : 0;
  const weight = Math.min(1, Math.abs(amount));
  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(raw.slice(offset, offset + 2), 16);
    return Math.round(value + (target - value) * weight)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}
