import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Image,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNowStrict } from "date-fns";

import { useAuth } from "@/src/auth-context";
import { apiFetch, getWsUrl } from "@/src/api";
import { ConversationView, Message, User } from "@/src/types";
import { useTheme } from "@/src/theme-context";
import { radius, spacing, typography, Palette } from "@/src/theme";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return formatDistanceToNowStrict(d, { addSuffix: false });
  } catch {
    return "";
  }
}

function Avatar({
  user,
  size = 52,
  colors,
}: {
  user: { name: string; display_name?: string | null; picture?: string | null };
  size?: number;
  colors: Palette;
}) {
  const label = (user.display_name || user.name || "?").trim();
  const initial = label.charAt(0).toUpperCase();
  const style = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: colors.brandTertiary,
  };
  if (user.picture) {
    return <Image source={{ uri: user.picture }} style={style} />;
  }
  return (
    <View style={[style, { alignItems: "center", justifyContent: "center" }]}>
      <Text
        style={{
          color: colors.brandPrimary,
          fontWeight: "700",
          fontSize: size * 0.4,
        }}
      >
        {initial}
      </Text>
    </View>
  );
}

export default function ChatsScreen() {
  const { token, user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [discover, setDiscover] = useState<User[]>([]);
  const [typingMap, setTypingMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [convos, discovered] = await Promise.all([
        apiFetch<ConversationView[]>("/api/conversations", { token }),
        apiFetch<User[]>("/api/users/discover", { token }).catch(() => []),
      ]);
      setConversations(convos);
      setDiscover(discovered);
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
              if (msg.sender_id !== user?.user_id) {
                updated.unread_count = (updated.unread_count || 0) + 1;
              }
              const next = [...prev];
              next.splice(idx, 1);
              next.unshift(updated);
              return next;
            });
          } else if (parsed.event === "typing") {
            const { conversation_id, user_id, is_typing } = parsed.data || {};
            if (user_id === user?.user_id) return;
            setTypingMap((prev) => ({
              ...prev,
              [conversation_id]: !!is_typing,
            }));
          }
        } catch {}
      };
    } catch (e) {
      console.warn("WS connect failed", e);
    }

    return () => {
      try { ws?.close(); } catch {}
    };
  }, [token, load, user?.user_id]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const openChat = (peer: User, convoId?: string) => {
    if (convoId) {
      router.push({
        pathname: "/chat/[id]",
        params: {
          id: convoId,
          peer_name: peer.name,
          peer_picture: peer.picture || "",
          peer_user_id: peer.user_id,
        },
      });
    } else {
      startDiscoverChat(peer);
    }
  };

  const startDiscoverChat = async (peer: User) => {
    if (!token) return;
    try {
      const convo = await apiFetch<ConversationView>("/api/conversations", {
        method: "POST",
        token,
        body: { peer_user_id: peer.user_id },
      });
      router.push({
        pathname: "/chat/[id]",
        params: {
          id: convo.conversation_id,
          peer_name: convo.peer.display_name || convo.peer.name,
          peer_username: convo.peer.username || "",
          peer_picture: convo.peer.picture || "",
          peer_user_id: convo.peer.user_id,
        },
      });
    } catch (e) {
      console.warn("start chat failed", e);
    }
  };

  const renderHeader = () => {
    if (discover.length === 0) return null;
    return (
      <View style={styles.discoverWrap}>
        <View style={styles.discoverTitleRow}>
          <Text style={styles.discoverTitle}>People you may know</Text>
          <TouchableOpacity onPress={() => router.push("/new-chat")}>
            <Text style={styles.discoverSeeAll}>See all</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.discoverRow}
        >
          {discover.map((u) => (
            <TouchableOpacity
              key={u.user_id}
              testID={`discover-user-${u.user_id}`}
              activeOpacity={0.75}
              onPress={() => startDiscoverChat(u)}
              style={styles.discoverCard}
            >
              <Avatar user={u} size={56} colors={colors} />
              <Text numberOfLines={1} style={styles.discoverName}>
                {(u.display_name || u.name).split(" ")[0]}
              </Text>
              <View style={styles.discoverBtn}>
                <Ionicons name="chatbubble-ellipses" size={12} color={colors.onBrandPrimary} />
                <Text style={styles.discoverBtnText}>Chat</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  return (
    <SafeAreaView testID="chats-screen" edges={["top"]} style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Chats</Text>
          <Text style={styles.headerSubtitle}>Say hi to your people</Text>
        </View>
        <TouchableOpacity
          testID="new-chat-header-button"
          onPress={() => router.push("/new-chat")}
          style={styles.headerAction}
        >
          <Ionicons name="create-outline" size={22} color={colors.brandPrimary} />
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
          ListHeaderComponent={renderHeader}
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
                Tap someone above to say hi, or search for a friend.
              </Text>
              <TouchableOpacity
                testID="empty-new-chat-button"
                onPress={() => router.push("/new-chat")}
                style={styles.emptyBtn}
              >
                <Text style={styles.emptyBtnText}>Find friends</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => {
            const isMineLast = item.last_sender_id === user?.user_id;
            const peerTyping = typingMap[item.conversation_id];
            const preview = peerTyping
              ? "typing…"
              : item.last_message
                ? (isMineLast ? "You: " : "") + item.last_message
                : "Say hi 👋";
            return (
              <TouchableOpacity
                testID={`conversation-row-${item.conversation_id}`}
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => openChat(item.peer, item.conversation_id)}
              >
                <Avatar user={item.peer} colors={colors} />
                <View style={styles.rowMain}>
                  <View style={styles.rowTopLine}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.peer.display_name || item.peer.name}
                    </Text>
                    <Text style={styles.time}>
                      {item.updated_at ? formatTime(item.updated_at) : ""}
                    </Text>
                  </View>
                  <View style={styles.rowBottomLine}>
                    <Text
                      style={[
                        styles.preview,
                        peerTyping && styles.previewTyping,
                        item.unread_count > 0 && !peerTyping && styles.previewUnread,
                      ]}
                      numberOfLines={1}
                    >
                      {preview}
                    </Text>
                    {item.unread_count > 0 && (
                      <View testID={`unread-badge-${item.conversation_id}`} style={styles.badge}>
                        <Text style={styles.badgeText}>
                          {item.unread_count > 99 ? "99+" : item.unread_count}
                        </Text>
                      </View>
                    )}
                  </View>
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
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    headerTitle: {
      fontSize: 32,
      fontWeight: "800",
      color: colors.onSurface,
      letterSpacing: -0.6,
    },
    headerSubtitle: {
      marginTop: 2,
      fontSize: typography.base,
      color: colors.onSurfaceSecondary,
    },
    headerAction: {
      width: 42,
      height: 42,
      borderRadius: radius.pill,
      backgroundColor: colors.brandTertiary,
      alignItems: "center",
      justifyContent: "center",
    },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    discoverWrap: {
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      marginBottom: spacing.sm,
    },
    discoverTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.sm,
    },
    discoverTitle: {
      fontSize: typography.lg,
      fontWeight: "700",
      color: colors.onSurface,
    },
    discoverSeeAll: {
      fontSize: typography.base,
      color: colors.brandPrimary,
      fontWeight: "600",
    },
    discoverRow: {
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
    },
    discoverCard: {
      width: 84,
      alignItems: "center",
      gap: spacing.xs,
    },
    discoverName: {
      fontSize: typography.base,
      color: colors.onSurface,
      fontWeight: "600",
      marginTop: spacing.xs,
    },
    discoverBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.brandPrimary,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    discoverBtnText: {
      color: colors.onBrandPrimary,
      fontSize: 11,
      fontWeight: "700",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.md,
    },
    rowMain: { flex: 1 },
    rowTopLine: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.sm,
    },
    rowBottomLine: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: 2,
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
      flex: 1,
      fontSize: typography.base,
      color: colors.onSurfaceTertiary,
    },
    previewUnread: {
      color: colors.onSurface,
      fontWeight: "600",
    },
    previewTyping: {
      color: colors.brandPrimary,
      fontStyle: "italic",
      fontWeight: "600",
    },
    badge: {
      minWidth: 22,
      height: 22,
      paddingHorizontal: 7,
      borderRadius: 11,
      backgroundColor: colors.brandPrimary,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: {
      color: colors.onBrandPrimary,
      fontSize: 11,
      fontWeight: "700",
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginLeft: spacing.lg + 52 + spacing.md,
    },
    empty: {
      marginTop: 40,
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
      fontWeight: "700",
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
      shadowColor: colors.brandPrimary,
      shadowOpacity: 0.4,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 5,
    },
  });
