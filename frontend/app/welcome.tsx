import { useState } from "react";
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
import { colors, spacing, radius, typography } from "@/src/theme";

export default function WelcomeScreen() {
  const router = useRouter();
  const { signInWithGoogle, user, loading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  // Once auth completes, index.tsx will redirect; also handle case where user visits
  // this route while authenticated.
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
        <Image
          source={{ uri: "https://images.unsplash.com/photo-1765498173413-b428f5d0a17e" }}
          style={styles.heroImage}
          resizeMode="cover"
        />
        <View style={styles.heroOverlay} />
      </View>

      <View style={styles.content}>
        <View style={styles.brandRow}>
          <View style={styles.brandDot}>
            <Ionicons name="chatbubbles" size={20} color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.brand}>SageChat</Text>
        </View>
        <Text style={styles.title}>Conversations,{"\n"}kept simple.</Text>
        <Text style={styles.subtitle}>
          A calm, private space for your everyday chats. Sign in to pick up right where you left off.
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  heroWrap: {
    flex: 1.1,
    backgroundColor: colors.surfaceSecondary,
    overflow: "hidden",
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  heroOverlay: {
    position: "absolute",
    inset: 0 as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(253, 251, 247, 0.15)",
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
  brandDot: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    fontSize: typography.lg,
    fontWeight: "600",
    color: colors.onSurface,
  },
  title: {
    marginTop: spacing.lg,
    fontSize: typography.display,
    fontWeight: "700",
    lineHeight: 40,
    color: colors.onSurface,
    letterSpacing: -0.5,
  },
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
  },
  googleBtnText: {
    color: colors.onBrandPrimary,
    fontSize: typography.lg,
    fontWeight: "600",
  },
  terms: {
    marginTop: spacing.md,
    textAlign: "center",
    color: colors.onSurfaceTertiary,
    fontSize: typography.sm,
  },
});
