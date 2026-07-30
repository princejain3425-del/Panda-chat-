// Omega Chat theme tokens — white + pink accents, light & dark modes.

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
  onSurface: "#17161B",
  surfaceSecondary: "#FBF6F8",
  onSurfaceSecondary: "#4A4548",
  surfaceTertiary: "#F5EBEF",
  onSurfaceTertiary: "#7A6E74",
  surfaceInverse: "#17161B",
  onSurfaceInverse: "#FFFFFF",
  brandPrimary: "#EC4899",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#F472B6",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#FCE7F3",
  onBrandTertiary: "#831843",
  success: "#16A34A",
  warning: "#D97706",
  error: "#DC2626",
  onError: "#FFFFFF",
  border: "#EFE6EA",
  borderStrong: "#D4CBCF",
  divider: "#F3EBEE",
  overlay: "rgba(23,22,27,0.5)",
};

export const darkPalette: Palette = {
  surface: "#151317",
  onSurface: "#FBF6F8",
  surfaceSecondary: "#211D22",
  onSurfaceSecondary: "#C4BABE",
  surfaceTertiary: "#2C262C",
  onSurfaceTertiary: "#8B8087",
  surfaceInverse: "#FBF6F8",
  onSurfaceInverse: "#151317",
  brandPrimary: "#F472B6",
  onBrandPrimary: "#151317",
  brandSecondary: "#EC4899",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#3A2530",
  onBrandTertiary: "#FCE7F3",
  success: "#4ADE80",
  warning: "#FBBF24",
  error: "#F87171",
  onError: "#151317",
  border: "#332C33",
  borderStrong: "#504853",
  divider: "#26212A",
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

export const APP_NAME = "Omega Chat";
