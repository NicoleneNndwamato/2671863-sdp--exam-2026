/**
 * Meridian Design System - Theme Tokens
 *
 * Ported value-for-value from the supplied mockup so the built console and the
 * design reference read as the same product: sharp corners everywhere, red used
 * only for brand and for "this is the active thing", everything else neutral.
 */

export const theme = {
  light: {
    // Primary brand (red - use sparingly)
    primary: "#801226",
    primaryHi: "#a81b36",
    primaryRgb: "128, 18, 38",

    // Backgrounds
    bg: "#f4f4f6",
    panel: "#ffffff",
    panel2: "#f0f0f3",
    panelSunken: "#fbfbfc",
    panel3: "#f6f6f8",

    // Borders
    line: "#e3e3e8",
    lineSoft: "#ededf0",

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
    chipOnBg: "rgba(128, 18, 38, 0.10)",
    tlWindowBg: "rgba(128, 18, 38, 0.16)",
    tlWindowBorder: "rgba(128, 18, 38, 0.40)",

    // UI elements
    dot: "#4b4b54",
    cursor: "#1c1c1e",
    rail: "#e6e6ea",
    railPast: "#b9b9c2",

    // Charts
    chartLine: "#2f6db5",
    chartFill: "#2f6db5",
    gridline: "#ececef",
    axis: "#d8d8de",
    axisLabel: "#555555",

    // Heatmap
    heatCool: "#588fcb",
    heatMid: "#bac5cf",
    heatHot: "#c96f1c",
    scanLo: "#d7e8f2",
    scanHi: "#1f5c96",

    // Dish states
    dishOfflineBg: "#f0f0f3",
    dishOfflineBorder: "#c9c9d2",

    // Misc
    shadow: "0 1px 2px rgba(20, 20, 26, 0.05)"
  },

  dark: {
    // Primary brand (red - use sparingly)
    primary: "#801226",
    primaryHi: "#a81b36",
    primaryRgb: "128, 18, 38",

    // Backgrounds
    bg: "#17171a",
    panel: "#1f1f23",
    panel2: "#26262b",
    panelSunken: "#1b1b1f",
    panel3: "#151518",

    // Borders
    line: "#33333a",
    lineSoft: "#2a2a30",

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
    chipOnBg: "rgba(128, 18, 38, 0.28)",
    tlWindowBg: "rgba(128, 18, 38, 0.45)",
    tlWindowBorder: "rgba(168, 27, 54, 0.70)",

    // UI elements
    dot: "#d8dadb",
    cursor: "#ffffff",
    rail: "#2c2c33",
    railPast: "#6f7373",

    // Charts
    chartLine: "#6aa8ea",
    chartFill: "#3f7fc4",
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
    dishOfflineBg: "#202024",
    dishOfflineBorder: "#3d3d45",

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
    // camelCase -> kebab-case: primaryHi -> --primary-hi
    out[`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`] = String(value);
  }
  return out;
}
