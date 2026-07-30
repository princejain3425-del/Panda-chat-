import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth-context";
import { useTheme } from "@/src/theme-context";

export default function Index() {
  const router = useRouter();
  const { loading, user } = useAuth();
  const { colors } = useTheme();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/welcome");
    } else if (!user.username) {
      router.replace("/complete-profile");
    } else {
      router.replace("/(tabs)/chats");
    }
  }, [loading, user, router]);

  return (
    <View
      testID="splash-screen"
      style={[styles.container, { backgroundColor: colors.surface }]}
    >
      <ActivityIndicator color={colors.brandPrimary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
