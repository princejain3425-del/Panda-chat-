import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View, Platform } from "react-native";
import { BlurView } from "expo-blur";

import { useAuth } from "@/src/auth-context";
import { useTheme } from "@/src/theme-context";

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const { colors, scheme } = useTheme();

  if (loading) return null;
  if (!user) return <Redirect href="/welcome" />;

  const solidBg = scheme === "dark" ? "rgba(21,19,23,0.75)" : "rgba(255,255,255,0.75)";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.onSurfaceTertiary,
        tabBarStyle: {
          position: "absolute",
          backgroundColor:
            Platform.OS === "android" ? colors.surfaceSecondary : "transparent",
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
        },
        tabBarBackground:
          Platform.OS === "android"
            ? undefined
            : () => (
                <BlurView
                  tint={scheme === "dark" ? "dark" : "light"}
                  intensity={80}
                  style={StyleSheet.absoluteFill}
                >
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: solidBg },
                    ]}
                  />
                </BlurView>
              ),
        tabBarLabelStyle: { fontWeight: "600", fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="chats"
        options={{
          title: "Chats",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
          tabBarButtonTestID: "tab-chats",
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle" size={size} color={color} />
          ),
          tabBarButtonTestID: "tab-profile",
        }}
      />
    </Tabs>
  );
}
