import { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { useAuth } from "@/src/auth-context";
import { useTheme } from "@/src/theme-context";
import { APP_NAME, radius, spacing, typography } from "@/src/theme";

export default function WelcomeScreen() {
  const router = useRouter();
  const { signInWithGoogle, user, loading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!loading && user) {
    router.replace("/(tabs)/chats");
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
    <SafeAreaView testID="welcome-screen" style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.heroWrap}>
        <View style={styles.blob1} />
        <View style={styles.blob2} />
        <View style={styles.blob3} />
        <View style={styles.heroBadge}>
          <View style={styles.brandDot}>
            <Ionicons name="sparkles" size={22} color={colors.onBrandPrimary} />
          </View>
        </View>
        <Image
          source={{ uri: "https://images.unsplash.com/photo-1765498173413-b428f5d0a17e" }}
          style={styles.heroImage}
          resizeMode="cover"
        />
      </View>

      <View style={styles.content}>
        <View style={styles.brandRow}>
          <View style={styles.smallBrandDot}>
            <Ionicons name="chatbubbles" size={16} color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.brand}>{APP_NAME}</Text>
        </View>
        <Text style={styles.title}>
          Chats that{"\n"}feel <Text style={styles.titleAccent}>alive</Text>.
        </Text>
        <Text style={styles.subtitle}>
          Real-time messages, quick photo shares, and a soft pastel vibe. Sign in with Google to get started.
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
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>["colors"]) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    heroWrap: {
      flex: 1.1,
      backgroundColor: colors.brandTertiary,
      overflow: "hidden",
      borderBottomLeftRadius: 40,
      borderBottomRightRadius: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    heroImage: {
      width: "100%",
      height: "100%",
      opacity: 0.9,
    },
    heroBadge: {
      position: "absolute",
      top: spacing.xxl,
      alignSelf: "center",
      zIndex: 2,
    },
    blob1: {
      position: "absolute",
      width: 200,
      height: 200,
      borderRadius: 100,
      backgroundColor: colors.brandSecondary,
      opacity: 0.35,
      top: -40,
      right: -40,
    },
    blob2: {
      position: "absolute",
      width: 160,
      height: 160,
      borderRadius: 80,
      backgroundColor: colors.brandPrimary,
      opacity: 0.25,
      bottom: 30,
      left: -30,
    },
    blob3: {
      position: "absolute",
      width: 90,
      height: 90,
      borderRadius: 45,
      backgroundColor: colors.brandSecondary,
      opacity: 0.35,
      bottom: 90,
      right: 40,
    },
    content: {
      flex: 1,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.lg,
      justifyContent: "space-between",
    },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    smallBrandDot: {
      width: 28,
      height: 28,
      borderRadius: radius.md,
      backgroundColor: colors.brandPrimary,
      alignItems: "center",
      justifyContent: "center",
    },
    brandDot: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.brandPrimary,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: colors.brandPrimary,
      shadowOpacity: 0.35,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    brand: {
      fontSize: typography.lg,
      fontWeight: "700",
      color: colors.onSurface,
      letterSpacing: 0.2,
    },
    title: {
      marginTop: spacing.lg,
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
