import React from "react";
import { ImageBackground, StyleSheet, View, ImageBackgroundProps } from "react-native";

import { useTheme } from "@/src/theme-context";

// A very subtle panda-bamboo watermark used on Home and Chat screens.
// The image itself is nearly-white so it works fine on light mode; in dark mode
// we lay a strong tint over it so text stays readable.
export function PandaBackground({
  children,
  style,
  ...rest
}: {
  children?: React.ReactNode;
} & Omit<ImageBackgroundProps, "source">) {
  const { scheme, colors } = useTheme();
  return (
    <ImageBackground
      source={require("../../assets/images/panda-chat-bg.jpeg")}
      style={[{ flex: 1, backgroundColor: colors.surface }, style]}
      resizeMode="cover"
      {...rest}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            backgroundColor:
              scheme === "dark"
                ? "rgba(14,18,15,0.90)"
                : "rgba(255,255,255,0.55)",
          },
        ]}
      />
      {children}
    </ImageBackground>
  );
}
