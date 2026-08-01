import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";

import { storage } from "@/src/utils/storage";
import { darkPalette, lightPalette, Palette, ThemeMode } from "@/src/theme";

const PREF_KEY_MODE = "omega.themeMode";
const PREF_KEY_ACCENT = "omega.themeAccent";

type ThemeContextValue = {
  mode: ThemeMode; // user preference (system|light|dark)
  scheme: "light" | "dark"; // effective scheme
  colors: Palette;
  accent: string;
  setMode: (m: ThemeMode) => void;
  setAccent: (a: string) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [accent, setAccentState] = useState<string>("sage");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const storedMode = await storage.getItem<string>(PREF_KEY_MODE, "");
      const storedAccent = await storage.getItem<string>(PREF_KEY_ACCENT, "");
      if (storedMode === "light" || storedMode === "dark" || storedMode === "system") {
        setModeState(storedMode as ThemeMode);
      }
      if (storedAccent) {
        setAccentState(storedAccent);
      }
      setReady(true);
    })();
  }, []);

  const scheme: "light" | "dark" = useMemo(() => {
    if (mode === "system") return system === "dark" ? "dark" : "light";
    return mode;
  }, [mode, system]);

  const colors = scheme === "dark" ? darkPalette : lightPalette;

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    storage.setItem(PREF_KEY_MODE, m);
  }, []);

  const setAccent = useCallback((a: string) => {
    setAccentState(a);
    storage.setItem(PREF_KEY_ACCENT, a);
  }, []);

  const value = useMemo(() => ({ mode, scheme, colors, accent, setMode, setAccent }), [
    mode,
    scheme,
    colors,
    accent,
    setMode,
    setAccent,
  ]);

  if (!ready) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
