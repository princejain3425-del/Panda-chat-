import { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ImageBackground,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { useAuth } from "@/src/auth-context";
import { useTheme } from "@/src/theme-context";
import { APP_NAME, radius, spacing, typography, Palette } from "@/src/theme";

export default function WelcomeScreen() {
  const router = useRouter();
  const { signInWithGoogle, user, loading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!loading && user) {
    router.replace(user.username ? "/(tabs)/chats" : "/complete-profile");
  }

  const handleSignIn = async () => {
    try {
      setSigningIn(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await signInWithGoogle();
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <ImageBackground
      source={require("../assets/images/panda-auth-bg.png")}
      style={styles.bg}
      resizeMode="cover"
    >
      <View style={styles.scrim} />
      <SafeAreaView testID="welcome-screen" style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <View style={styles.brandRow}>
            <View style={styles.brandDot}>
              <Ionicons name="paw" size={16} color={colors.onBrandPrimary} />
            </View>
            <Text style={styles.brand}>{APP_NAME}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>
            Cozy chats,{"\n"}<Text style={styles.titleAccent}>bamboo vibes</Text>.
          </Text>
          <Text style={styles.subtitle}>
            Real-time messages, easy media sharing, and a soft panda-forest aesthetic.
          </Text>

          <TouchableOpacity
            testID="google-signin-button"
            activeOpacity={0.85}
            disabled={signingIn}
            onPress={handleSignIn}
            style={styles.googleBtn}
          >
            {signingIn ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.googleBtnText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.terms}>By continuing, you agree to our Terms & Privacy Policy.</Text>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    bg: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor:
        colors.surface === "#FFFFFF"
          ? "rgba(255,255,255,0.15)"
          : "rgba(14,18,15,0.45)",
    },
    container: {
      flex: 1,
      paddingHorizontal: spacing.xl,
      justifyContent: "space-between",
    },
    top: {
      alignItems: "flex-start",
    },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      backgroundColor:
        colors.surface === "#FFFFFF"
          ? "rgba(255,255,255,0.7)"
          : "rgba(14,18,15,0.55)",
      borderWidth: 1,
      borderColor: colors.border,
    },
    brandDot: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.brandPrimary,
      alignItems: "center",
      justifyContent: "center",
    },
    brand: {
      fontSize: typography.lg,
      fontWeight: "800",
      color: colors.onSurface,
      letterSpacing: 0.3,
    },
    card: {
      backgroundColor:
        colors.surface === "#FFFFFF"
          ? "rgba(255,255,255,0.92)"
          : "rgba(14,18,15,0.85)",
      borderRadius: radius.xl,
      padding: spacing.xl,
      marginBottom: spacing.md,
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    title: {
      fontSize: typography.display,
      fontWeight: "800",
      lineHeight: 40,
      color: colors.onSurface,
      letterSpacing: -0.5,
    },
    titleAccent: { color: colors.brandPrimary },
    subtitle: {
      marginTop: spacing.md,
      fontSize: typography.lg,
      color: colors.onSurfaceSecondary,
      lineHeight: 22,
    },
    googleBtn: {
      marginTop: spacing.xl,
      height: 54,
      borderRadius: radius.pill,
      backgroundColor: colors.brandPrimary,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: spacing.md,
      shadowColor: colors.brandPrimary,
      shadowOpacity: 0.35,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4,
    },
    googleBtnText: {
      color: colors.onBrandPrimary,
      fontSize: typography.lg,
      fontWeight: "700",
    },
    terms: {
      marginTop: spacing.md,
      textAlign: "center",
      color: colors.onSurfaceTertiary,
      fontSize: typography.sm,
    },
  });
