import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";

import { storage } from "@/src/utils/storage";
import { darkPalette, lightPalette, Palette, ThemeMode } from "@/src/theme";

const PREF_KEY = "omega.themeMode";

type ThemeContextValue = {
  mode: ThemeMode; // user preference (system|light|dark)
  scheme: "light" | "dark"; // effective scheme
  colors: Palette;
  setMode: (m: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await storage.getItem<string>(PREF_KEY, "");
      if (stored === "light" || stored === "dark" || stored === "system") {
        setModeState(stored);
      }
      setReady(true);
    })();
  }, []);

  const scheme: "light" | "dark" = useMemo(() => {
    if (mode === "system") return (system === "dark" ? "dark" : "light");
    return mode;
  }, [mode, system]);

  const colors = scheme === "dark" ? darkPalette : lightPalette;

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    storage.setItem(PREF_KEY, m);
  }, []);

  const value = useMemo(
    () => ({ mode, scheme, colors, setMode }),
    [mode, scheme, colors, setMode],
  );

  if (!ready) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
