import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth-context";
import { colors, spacing, radius, typography } from "@/src/theme";

function Row({
  icon,
  label,
  onPress,
  destructive,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  destructive?: boolean;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      activeOpacity={0.7}
      onPress={onPress}
      style={styles.row}
    >
      <View style={[styles.iconTile, destructive && styles.iconTileDanger]}>
        <Ionicons
          name={icon}
          size={18}
          color={destructive ? colors.onError : colors.brandPrimary}
        />
      </View>
      <Text style={[styles.rowLabel, destructive && { color: colors.error }]}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleSignOut = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await signOut();
    router.replace("/welcome");
  };

  const initial = (user?.name || "?").trim().charAt(0).toUpperCase();

  return (
    <SafeAreaView testID="profile-screen" edges={["top"]} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <View style={styles.profileCard}>
        {user?.picture ? (
          <Image source={{ uri: user.picture }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        )}
        <Text testID="profile-name" style={styles.name}>{user?.name}</Text>
        <Text testID="profile-email" style={styles.email}>{user?.email}</Text>
      </View>

      <View style={[styles.list, { marginBottom: 90 + insets.bottom }]}>
        <Row icon="notifications-outline" label="Notifications" testID="settings-notifications" />
        <View style={styles.divider} />
        <Row icon="lock-closed-outline" label="Privacy" testID="settings-privacy" />
        <View style={styles.divider} />
        <Row icon="help-circle-outline" label="Help & Support" testID="settings-help" />
      </View>

      <View style={{ paddingHorizontal: spacing.lg, marginBottom: 90 + insets.bottom }}>
        <TouchableOpacity
          testID="sign-out-button"
          onPress={handleSignOut}
          style={styles.signOutBtn}
          activeOpacity={0.85}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    fontSize: 30,
    fontWeight: "700",
    color: colors.onSurface,
    letterSpacing: -0.5,
  },
  profileCard: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.brandTertiary,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 36,
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
  list: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
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
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  iconTileDanger: {
    backgroundColor: colors.error,
  },
  rowLabel: {
    flex: 1,
    fontSize: typography.lg,
    color: colors.onSurface,
    fontWeight: "500",
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
    fontWeight: "600",
    fontSize: typography.lg,
  },
});
