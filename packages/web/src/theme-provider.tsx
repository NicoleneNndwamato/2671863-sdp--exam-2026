import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cssVariables, theme, type Theme } from "./theme";

interface ThemeContextValue {
  theme: Theme;
  dark: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: theme.light,
  dark: false,
  toggle: () => undefined
});

const STORAGE_KEY = "meridian.theme";

/**
 * Light/dark is a real operator need here: the control room is dark at night and
 * the domes are sunlight-bright during the day. The choice is remembered.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "dark") return true;
      if (stored === "light") return false;
    } catch {
      // Private browsing can throw; fall through to the default.
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? "dark" : "light";
    // Publish the palette as CSS variables so the layout rules in styles.css
    // can colour the shell from the same tokens the components use inline.
    for (const [name, value] of Object.entries(cssVariables(dark ? theme.dark : theme.light))) {
      root.style.setProperty(name, value);
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
    } catch {
      // Ignore storage failures.
    }
  }, [dark]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: dark ? theme.dark : theme.light, dark, toggle: () => setDark((d) => !d) }),
    [dark]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
