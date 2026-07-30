import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Image,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNowStrict } from "date-fns";

import { useAuth } from "@/src/auth-context";
import { apiFetch, getWsUrl } from "@/src/api";
import { ConversationView, Message } from "@/src/types";
import { colors, spacing, radius, typography } from "@/src/theme";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return formatDistanceToNowStrict(d, { addSuffix: false });
  } catch {
    return "";
  }
}

function Avatar({ user }: { user: { name: string; picture?: string | null } }) {
  const initial = (user.name || "?").trim().charAt(0).toUpperCase();
  if (user.picture) {
    return (
      <Image source={{ uri: user.picture }} style={styles.avatar} />
    );
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarText}>{initial}</Text>
    </View>
  );
}

export default function ChatsScreen() {
  const { token, user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiFetch<ConversationView[]>("/api/conversations", { token });
      setConversations(data);
    } catch (e) {
      console.warn("Failed to load conversations", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Live update via websocket
  useEffect(() => {
    if (!token) return;
    const url = getWsUrl(token);
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(url);
      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data);
          if (parsed.event === "message") {
            const msg: Message = parsed.data;
            setConversations((prev) => {
              const idx = prev.findIndex((c) => c.conversation_id === msg.conversation_id);
              if (idx === -1) {
                // Unknown conversation → refetch list
                load();
                return prev;
              }
              const updated = { ...prev[idx] };
              updated.last_message =
                msg.type === "text"
                  ? (msg.text || "").slice(0, 120)
                  : msg.type === "image"
                    ? "📷 Photo"
                    : "🎥 Video";
              updated.last_message_type = msg.type;
              updated.last_sender_id = msg.sender_id;
              updated.updated_at = msg.created_at;
              const next = [...prev];
              next.splice(idx, 1);
              next.unshift(updated);
              return next;
            });
          }
        } catch {}
      };
      ws.onerror = () => {};
      ws.onclose = () => {};
    } catch (e) {
      console.warn("WS connect failed", e);
    }

    return () => {
      try { ws?.close(); } catch {}
    };
  }, [token, load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const openChat = (c: ConversationView) => {
    router.push({
      pathname: "/chat/[id]",
      params: {
        id: c.conversation_id,
        peer_name: c.peer.name,
        peer_picture: c.peer.picture || "",
        peer_user_id: c.peer.user_id,
      },
    });
  };

  return (
    <SafeAreaView testID="chats-screen" edges={["top"]} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
        <TouchableOpacity
          testID="new-chat-header-button"
          onPress={() => router.push("/new-chat")}
          style={styles.headerAction}
        >
          <Ionicons name="create-outline" size={22} color={colors.onSurface} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <FlatList
          testID="conversations-list"
          data={conversations}
          keyExtractor={(item) => item.conversation_id}
          contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="chatbubble-ellipses-outline" size={40} color={colors.brandPrimary} />
              </View>
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptySubtitle}>
                Start a new chat with someone to see it here.
              </Text>
              <TouchableOpacity
                testID="empty-new-chat-button"
                onPress={() => router.push("/new-chat")}
                style={styles.emptyBtn}
              >
                <Text style={styles.emptyBtnText}>Start a new chat</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => {
            const isMineLast = item.last_sender_id === user?.user_id;
            const preview = item.last_message
              ? (isMineLast ? "You: " : "") + item.last_message
              : "Say hi 👋";
            return (
              <TouchableOpacity
                testID={`conversation-row-${item.conversation_id}`}
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => openChat(item)}
              >
                <Avatar user={item.peer} />
                <View style={styles.rowMain}>
                  <View style={styles.rowTopLine}>
                    <Text style={styles.name} numberOfLines={1}>{item.peer.name}</Text>
                    <Text style={styles.time}>
                      {item.updated_at ? formatTime(item.updated_at) : ""}
                    </Text>
                  </View>
                  <Text style={styles.preview} numberOfLines={1}>{preview}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      <TouchableOpacity
        testID="new-chat-fab"
        activeOpacity={0.85}
        style={[styles.fab, { bottom: 80 + insets.bottom }]}
        onPress={() => router.push("/new-chat")}
      >
        <Ionicons name="add" size={26} color={colors.onBrandPrimary} />
      </TouchableOpacity>
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
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: "700",
    color: colors.onSurface,
    letterSpacing: -0.5,
  },
  headerAction: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceTertiary,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandTertiary,
  },
  avatarText: {
    color: colors.brandPrimary,
    fontWeight: "700",
    fontSize: typography.xl,
  },
  rowMain: { flex: 1 },
  rowTopLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  name: {
    flex: 1,
    fontSize: typography.lg,
    fontWeight: "600",
    color: colors.onSurface,
  },
  time: {
    fontSize: typography.sm,
    color: colors.onSurfaceTertiary,
  },
  preview: {
    marginTop: 2,
    fontSize: typography.base,
    color: colors.onSurfaceTertiary,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginLeft: spacing.lg + 52 + spacing.md,
  },
  empty: {
    marginTop: 80,
    alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  emptyIconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: typography.xl,
    fontWeight: "700",
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: typography.base,
    color: colors.onSurfaceSecondary,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  emptyBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  emptyBtnText: {
    color: colors.onBrandPrimary,
    fontWeight: "600",
    fontSize: typography.lg,
  },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
});
