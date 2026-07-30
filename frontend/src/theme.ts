// Panda Chat theme tokens — white + panda green, light & dark modes.

export type ThemeMode = "light" | "dark" | "system";

export type Palette = {
  surface: string;
  onSurface: string;
  surfaceSecondary: string;
  onSurfaceSecondary: string;
  surfaceTertiary: string;
  onSurfaceTertiary: string;
  surfaceInverse: string;
  onSurfaceInverse: string;
  brandPrimary: string;
  onBrandPrimary: string;
  brandSecondary: string;
  onBrandSecondary: string;
  brandTertiary: string;
  onBrandTertiary: string;
  success: string;
  warning: string;
  error: string;
  onError: string;
  border: string;
  borderStrong: string;
  divider: string;
  overlay: string;
};

export const lightPalette: Palette = {
  surface: "#FFFFFF",
  onSurface: "#131A16",
  surfaceSecondary: "#F5F8F2",
  onSurfaceSecondary: "#3F4A44",
  surfaceTertiary: "#E7EEDF",
  onSurfaceTertiary: "#6B786F",
  surfaceInverse: "#131A16",
  onSurfaceInverse: "#FFFFFF",
  brandPrimary: "#3F7E44",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#68A26C",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#D5E6CE",
  onBrandTertiary: "#1F3A22",
  success: "#16A34A",
  warning: "#B88B42",
  error: "#B5534A",
  onError: "#FFFFFF",
  border: "#E1E9D9",
  borderStrong: "#B8C4AA",
  divider: "#EEF3E7",
  overlay: "rgba(19,26,22,0.5)",
};

export const darkPalette: Palette = {
  surface: "#0E120F",
  onSurface: "#F1F6EB",
  surfaceSecondary: "#161C18",
  onSurfaceSecondary: "#C0CBBA",
  surfaceTertiary: "#1F2620",
  onSurfaceTertiary: "#7C8879",
  surfaceInverse: "#F1F6EB",
  onSurfaceInverse: "#0E120F",
  brandPrimary: "#7FBF77",
  onBrandPrimary: "#0E120F",
  brandSecondary: "#4E9155",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#233022",
  onBrandTertiary: "#D5E6CE",
  success: "#4ADE80",
  warning: "#FBBF24",
  error: "#F87171",
  onError: "#0E120F",
  border: "#2A322C",
  borderStrong: "#4A5548",
  divider: "#1D231F",
  overlay: "rgba(0,0,0,0.6)",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  xl: 28,
  pill: 999,
};

export const typography = {
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
  display: 32,
};

export const APP_NAME = "Panda Chat";
