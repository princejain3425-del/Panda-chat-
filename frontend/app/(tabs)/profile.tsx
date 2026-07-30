import { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth-context";
import { useTheme } from "@/src/theme-context";
import { Palette, radius, spacing, typography, ThemeMode } from "@/src/theme";

function SettingRow({
  icon,
  label,
  onPress,
  colors,
  destructive,
  testID,
  right,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  colors: Palette;
  destructive?: boolean;
  testID?: string;
  right?: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      activeOpacity={0.7}
      onPress={onPress}
      style={styles.row}
    >
      <View
        style={[
          styles.iconTile,
          { backgroundColor: destructive ? colors.error : colors.brandTertiary },
        ]}
      >
        <Ionicons
          name={icon}
          size={18}
          color={destructive ? colors.onError : colors.brandPrimary}
        />
      </View>
      <Text
        style={[
          styles.rowLabel,
          { color: destructive ? colors.error : colors.onSurface },
        ]}
      >
        {label}
      </Text>
      {right ?? (
        <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
      )}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, mode, setMode } = useTheme();
  const themed = useMemo(() => makeStyles(colors), [colors]);

  const handleSignOut = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await signOut();
    router.replace("/welcome");
  };

  const initial = (user?.name || "?").trim().charAt(0).toUpperCase();

  const modes: { key: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "system", label: "System", icon: "phone-portrait-outline" },
    { key: "light", label: "Light", icon: "sunny-outline" },
    { key: "dark", label: "Dark", icon: "moon-outline" },
  ];

  return (
    <SafeAreaView testID="profile-screen" edges={["top"]} style={themed.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        <View style={themed.header}>
          <Text style={themed.headerTitle}>Profile</Text>
        </View>

        <View style={themed.profileCard}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={themed.avatar} />
          ) : (
            <View style={[themed.avatar, themed.avatarFallback]}>
              <Text style={themed.avatarText}>{initial}</Text>
            </View>
          )}
          <Text testID="profile-name" style={themed.name}>{user?.display_name || user?.name}</Text>
          {user?.username && (
            <Text testID="profile-username" style={themed.username}>@{user.username}</Text>
          )}
          <Text testID="profile-email" style={themed.email}>{user?.email}</Text>
        </View>

        {/* Theme selector */}
        <Text style={themed.sectionLabel}>Appearance</Text>
        <View style={themed.themeCard}>
          {modes.map((m, i) => {
            const active = mode === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                testID={`theme-mode-${m.key}`}
                activeOpacity={0.8}
                onPress={() => {
                  Haptics.selectionAsync();
                  setMode(m.key);
                }}
                style={[
                  themed.themeOption,
                  active && themed.themeOptionActive,
                  i > 0 && themed.themeOptionDivider,
                ]}
              >
                <View
                  style={[
                    themed.themeIconWrap,
                    active && { backgroundColor: colors.brandPrimary },
                  ]}
                >
                  <Ionicons
                    name={m.icon}
                    size={16}
                    color={active ? colors.onBrandPrimary : colors.brandPrimary}
                  />
                </View>
                <Text
                  style={[
                    themed.themeLabel,
                    active && { color: colors.brandPrimary, fontWeight: "700" },
                  ]}
                >
                  {m.label}
                </Text>
                {active && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={themed.sectionLabel}>Settings</Text>
        <View style={themed.list}>
          <SettingRow icon="notifications-outline" label="Notifications" colors={colors} testID="settings-notifications" />
          <View style={themed.divider} />
          <SettingRow icon="lock-closed-outline" label="Privacy" colors={colors} testID="settings-privacy" />
          <View style={themed.divider} />
          <SettingRow icon="help-circle-outline" label="Help & Support" colors={colors} testID="settings-help" />
        </View>

        <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg }}>
          <TouchableOpacity
            testID="sign-out-button"
            onPress={handleSignOut}
            style={themed.signOutBtn}
            activeOpacity={0.85}
          >
            <Ionicons name="log-out-outline" size={18} color={colors.error} />
            <Text style={themed.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Row styles that are safe to keep static (only used for structure)
const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    gap: spacing.md,
  },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    flex: 1,
    fontSize: typography.lg,
    fontWeight: "500",
  },
});

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    headerTitle: {
      fontSize: 32,
      fontWeight: "800",
      color: colors.onSurface,
      letterSpacing: -0.6,
    },
    profileCard: {
      alignItems: "center",
      paddingVertical: spacing.xl,
    },
    avatar: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: colors.brandTertiary,
    },
    avatarFallback: {
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontSize: 38,
      fontWeight: "700",
      color: colors.brandPrimary,
    },
    name: {
      marginTop: spacing.md,
      fontSize: typography.xxl,
      fontWeight: "700",
      color: colors.onSurface,
    },
    email: {
      marginTop: spacing.xs,
      fontSize: typography.base,
      color: colors.onSurfaceSecondary,
    },
    username: {
      marginTop: spacing.xs,
      fontSize: typography.lg,
      color: colors.brandPrimary,
      fontWeight: "700",
    },
    sectionLabel: {
      marginTop: spacing.lg,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      fontSize: typography.sm,
      fontWeight: "700",
      color: colors.onSurfaceTertiary,
      letterSpacing: 1,
      textTransform: "uppercase",
    },
    themeCard: {
      marginHorizontal: spacing.lg,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.lg,
      overflow: "hidden",
    },
    themeOption: {
      flexDirection: "row",
      alignItems: "center",
      padding: spacing.md,
      gap: spacing.md,
    },
    themeOptionActive: {
      backgroundColor: colors.brandTertiary,
    },
    themeOptionDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    themeIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: colors.brandTertiary,
      alignItems: "center",
      justifyContent: "center",
    },
    themeLabel: {
      flex: 1,
      fontSize: typography.lg,
      fontWeight: "500",
      color: colors.onSurface,
    },
    list: {
      marginHorizontal: spacing.lg,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.lg,
      overflow: "hidden",
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginLeft: spacing.md + 34 + spacing.md,
    },
    signOutBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingVertical: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.error,
      backgroundColor: colors.surface,
    },
    signOutText: {
      color: colors.error,
      fontWeight: "700",
      fontSize: typography.lg,
    },
  });
