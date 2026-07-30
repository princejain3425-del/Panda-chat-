import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth-context";
import { apiFetch } from "@/src/api";
import { User, ConversationView } from "@/src/types";
import { useTheme } from "@/src/theme-context";
import { Palette, radius, spacing, typography } from "@/src/theme";

export default function NewChatScreen() {
  const { token } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const load = useCallback(
    async (q: string) => {
      if (!token) return;
      setLoading(true);
      try {
        const params = q ? `?q=${encodeURIComponent(q)}` : "";
        const data = await apiFetch<User[]>(`/api/users/search${params}`, { token });
        setUsers(data);
      } catch (e) {
        console.warn("Search failed", e);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const t = setTimeout(() => load(query), 250);
    return () => clearTimeout(t);
  }, [query, load]);

  const startChat = async (u: User) => {
    if (!token || creating) return;
    setCreating(u.user_id);
    try {
      const convo = await apiFetch<ConversationView>("/api/conversations", {
        method: "POST",
        token,
        body: { peer_user_id: u.user_id },
      });
      router.replace({
        pathname: "/chat/[id]",
        params: {
          id: convo.conversation_id,
          peer_name: convo.peer.name,
          peer_picture: convo.peer.picture || "",
          peer_user_id: convo.peer.user_id,
        },
      });
    } catch (e) {
      console.warn("Start chat failed", e);
    } finally {
      setCreating(null);
    }
  };

  return (
    <SafeAreaView testID="new-chat-screen" edges={["top"]} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="new-chat-close-button"
          onPress={() => router.back()}
          style={styles.headerBtn}
        >
          <Ionicons name="close" size={24} color={colors.onSurface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New chat</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.onSurfaceTertiary} />
        <TextInput
          testID="user-search-input"
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
          placeholder="Search by name or email"
          placeholderTextColor={colors.onSurfaceTertiary}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery("")} testID="clear-search">
            <Ionicons name="close-circle" size={18} color={colors.onSurfaceTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <FlatList
          testID="user-search-results"
          data={users}
          keyExtractor={(u) => u.user_id}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={44} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>
                {query ? "No users found" : "No other users yet"}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const initial = (item.name || "?").charAt(0).toUpperCase();
            const isCreating = creating === item.user_id;
            return (
              <TouchableOpacity
                testID={`user-result-${item.user_id}`}
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => startChat(item)}
                disabled={!!creating}
              >
                {item.picture ? (
                  <Image source={{ uri: item.picture }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarText}>{initial}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.email}>{item.email}</Text>
                </View>
                {isCreating ? (
                  <ActivityIndicator color={colors.brandPrimary} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    headerBtn: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      fontSize: typography.xl,
      fontWeight: "700",
      color: colors.onSurface,
    },
    searchWrap: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    searchInput: {
      flex: 1,
      fontSize: typography.lg,
      color: colors.onSurface,
      paddingVertical: 0,
    },
    loadingWrap: { padding: spacing.xl, alignItems: "center" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.md,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.brandTertiary,
    },
    avatarFallback: {
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontWeight: "700",
      color: colors.brandPrimary,
      fontSize: typography.xl,
    },
    name: {
      fontSize: typography.lg,
      fontWeight: "600",
      color: colors.onSurface,
    },
    email: {
      marginTop: 2,
      fontSize: typography.base,
      color: colors.onSurfaceTertiary,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginLeft: spacing.lg + 48 + spacing.md,
    },
    empty: {
      marginTop: spacing.xxxl,
      alignItems: "center",
      gap: spacing.sm,
    },
    emptyText: {
      color: colors.onSurfaceSecondary,
      fontSize: typography.lg,
    },
  });
