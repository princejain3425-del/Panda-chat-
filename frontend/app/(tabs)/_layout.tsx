import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View, Platform } from "react-native";
import { BlurView } from "expo-blur";

import { useAuth } from "@/src/auth-context";
import { colors } from "@/src/theme";

export default function TabsLayout() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Redirect href="/welcome" />;

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
                  tint="light"
                  intensity={80}
                  style={StyleSheet.absoluteFill}
                >
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: "rgba(253,251,247,0.72)" },
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
