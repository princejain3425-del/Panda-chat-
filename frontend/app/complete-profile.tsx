import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useAuth } from "@/src/auth-context";
import { apiFetch, ApiError } from "@/src/api";
import { User } from "@/src/types";
import { useTheme } from "@/src/theme-context";
import { Palette, radius, spacing, typography, APP_NAME } from "@/src/theme";

type Availability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; normalized: string }
  | { state: "invalid"; reason: string }
  | { state: "taken" };

export default function CompleteProfileScreen() {
  const { user, token, refreshUser } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [displayName, setDisplayName] = useState(user?.name || "");
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avail, setAvail] = useState<Availability>({ state: "idle" });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // If user already completed profile, bounce forward
  useEffect(() => {
    if (user?.username) {
      router.replace("/(tabs)/chats");
    }
  }, [user?.username, router]);

  const checkUsername = useCallback(
    async (raw: string) => {
      if (!token) return;
      const trimmed = raw.trim().toLowerCase();
      if (!trimmed) {
        setAvail({ state: "idle" });
        return;
      }
      setAvail({ state: "checking" });
      try {
        const res = await apiFetch<{
          available: boolean;
          username?: string;
          reason?: string;
        }>(`/api/auth/username-available?u=${encodeURIComponent(trimmed)}`, { token });
        if (res.available && res.username) {
          setAvail({ state: "available", normalized: res.username });
        } else if (res.reason) {
          setAvail({ state: "invalid", reason: res.reason });
        } else {
          setAvail({ state: "taken" });
        }
      } catch {
        setAvail({ state: "invalid", reason: "Could not check availability" });
      }
    },
    [token],
  );

  const handleUsernameChange = (v: string) => {
    // Normalize as user types: lowercase, strip spaces/non-allowed
    const cleaned = v.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setUsername(cleaned);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => checkUsername(cleaned), 350);
  };

  const canSubmit =
    displayName.trim().length > 0 &&
    avail.state === "available" &&
    !submitting;

  const submit = async () => {
    if (!canSubmit || !token) return;
    setSubmitting(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await apiFetch<User>("/api/auth/complete-profile", {
        method: "POST",
        token,
        body: {
          display_name: displayName.trim(),
          username: username.trim().toLowerCase(),
        },
      });
      await refreshUser();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)/chats");
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        if (e.status === 409) setAvail({ state: "taken" });
      } else {
        setError("Something went wrong, please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const availIcon = () => {
    switch (avail.state) {
      case "checking":
        return <ActivityIndicator size="small" color={colors.brandPrimary} />;
      case "available":
        return <Ionicons name="checkmark-circle" size={20} color={colors.success} />;
      case "taken":
      case "invalid":
        return <Ionicons name="close-circle" size={20} color={colors.error} />;
      default:
        return null;
    }
  };

  const availMessage = () => {
    switch (avail.state) {
      case "available":
        return { text: `@${avail.normalized} is available`, color: colors.success };
      case "taken":
        return { text: "That username is already taken", color: colors.error };
      case "invalid":
        return { text: avail.reason, color: colors.error };
      default:
        return null;
    }
  };

  const initial = (user?.name || "?").charAt(0).toUpperCase();
  const msg = availMessage();

  return (
    <SafeAreaView testID="complete-profile-screen" edges={["top", "bottom"]} style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandRow}>
            <View style={styles.brandDot}>
              <Ionicons name="chatbubbles" size={14} color={colors.onBrandPrimary} />
            </View>
            <Text style={styles.brand}>{APP_NAME}</Text>
          </View>

          <Text style={styles.title}>One quick step</Text>
          <Text style={styles.subtitle}>
            Pick how your friends see you, and grab a unique @handle so people can find you.
          </Text>

          <View style={styles.avatarWrap}>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
            )}
          </View>

          <Text style={styles.fieldLabel}>Display name</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="person-outline" size={18} color={colors.onSurfaceTertiary} />
            <TextInput
              testID="display-name-input"
              style={styles.input}
              value={displayName}
              onChangeText={(v) => setDisplayName(v.slice(0, 40))}
              placeholder="Your name"
              placeholderTextColor={colors.onSurfaceTertiary}
              maxLength={40}
              autoCorrect={false}
            />
          </View>
          <Text style={styles.hint}>1–40 characters. Others will see this in chats.</Text>

          <Text style={[styles.fieldLabel, { marginTop: spacing.lg }]}>Username</Text>
          <View style={styles.inputWrap}>
            <Text style={styles.at}>@</Text>
            <TextInput
              testID="username-input"
              style={styles.input}
              value={username}
              onChangeText={handleUsernameChange}
              placeholder="yourhandle"
              placeholderTextColor={colors.onSurfaceTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
            />
            {availIcon()}
          </View>
          <Text style={styles.hint}>
            3–20 chars. Lowercase letters, numbers, underscore. Can only be claimed once.
          </Text>
          {msg && (
            <Text
              testID="username-availability-msg"
              style={[styles.availText, { color: msg.color }]}
            >
              {msg.text}
            </Text>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            testID="complete-profile-submit"
            activeOpacity={0.85}
            onPress={submit}
            disabled={!canSubmit}
            style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <>
                <Text style={styles.submitText}>Continue</Text>
                <Ionicons name="arrow-forward" size={18} color={colors.onBrandPrimary} />
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    scroll: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.xxl,
    },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.xl,
    },
    brandDot: {
      width: 26,
      height: 26,
      borderRadius: 8,
      backgroundColor: colors.brandPrimary,
      alignItems: "center",
      justifyContent: "center",
    },
    brand: {
      fontSize: typography.base,
      fontWeight: "700",
      color: colors.onSurfaceSecondary,
      letterSpacing: 0.3,
    },
    title: {
      fontSize: 28,
      fontWeight: "800",
      color: colors.onSurface,
      letterSpacing: -0.5,
    },
    subtitle: {
      marginTop: spacing.xs,
      fontSize: typography.lg,
      color: colors.onSurfaceSecondary,
      lineHeight: 22,
    },
    avatarWrap: {
      alignItems: "center",
      marginTop: spacing.xl,
      marginBottom: spacing.lg,
    },
    avatar: {
      width: 84,
      height: 84,
      borderRadius: 42,
      backgroundColor: colors.brandTertiary,
    },
    avatarFallback: {
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontSize: 32,
      fontWeight: "700",
      color: colors.brandPrimary,
    },
    fieldLabel: {
      fontSize: typography.sm,
      color: colors.onSurfaceTertiary,
      fontWeight: "700",
      letterSpacing: 0.8,
      textTransform: "uppercase",
      marginBottom: spacing.xs,
    },
    inputWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    at: {
      fontSize: typography.lg,
      color: colors.onSurfaceSecondary,
      fontWeight: "700",
    },
    input: {
      flex: 1,
      fontSize: typography.lg,
      color: colors.onSurface,
      paddingVertical: 0,
    },
    hint: {
      marginTop: spacing.xs,
      fontSize: typography.sm,
      color: colors.onSurfaceTertiary,
    },
    availText: {
      marginTop: spacing.xs,
      fontSize: typography.base,
      fontWeight: "600",
    },
    errorText: {
      marginTop: spacing.md,
      color: colors.error,
      fontSize: typography.base,
      textAlign: "center",
    },
    footer: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.md,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      backgroundColor: colors.surface,
    },
    submitBtn: {
      height: 54,
      borderRadius: radius.pill,
      backgroundColor: colors.brandPrimary,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: spacing.sm,
      shadowColor: colors.brandPrimary,
      shadowOpacity: 0.3,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    submitBtnDisabled: {
      backgroundColor: colors.brandSecondary,
      opacity: 0.4,
      shadowOpacity: 0,
    },
    submitText: {
      color: colors.onBrandPrimary,
      fontSize: typography.lg,
      fontWeight: "700",
    },
  });
