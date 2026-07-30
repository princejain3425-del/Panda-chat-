import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

import { useAuth } from "@/src/auth-context";
import { apiFetch, getWsUrl } from "@/src/api";
import { Message } from "@/src/types";
import { colors, spacing, radius, typography } from "@/src/theme";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function ChatDetailScreen() {
  const { id, peer_name, peer_picture } = useLocalSearchParams<{
    id: string;
    peer_name?: string;
    peer_picture?: string;
    peer_user_id?: string;
  }>();
  const router = useRouter();
  const { token, user } = useAuth();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  // Initial load
  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const data = await apiFetch<Message[]>(`/api/conversations/${id}/messages`, { token });
      setMessages(data);
    } catch (e) {
      console.warn("Failed to load messages", e);
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    load();
  }, [load]);

  // WebSocket for realtime
  useEffect(() => {
    if (!token || !id) return;
    const url = getWsUrl(token);
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(url);
      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data);
          if (parsed.event === "message") {
            const msg: Message = parsed.data;
            if (msg.conversation_id !== id) return;
            setMessages((prev) => {
              if (prev.some((m) => m.message_id === msg.message_id)) return prev;
              return [...prev, msg];
            });
            if (msg.sender_id !== user?.user_id) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          }
        } catch {}
      };
    } catch (e) {
      console.warn("WS connect failed", e);
    }
    return () => {
      try { ws?.close(); } catch {}
    };
  }, [token, id, user?.user_id]);

  // Auto-scroll when messages change
  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [messages.length]);

  const sendText = async () => {
    const value = text.trim();
    if (!value || sending || !token) return;
    setSending(true);
    setText("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const msg = await apiFetch<Message>(`/api/conversations/${id}/messages`, {
        method: "POST",
        token,
        body: { type: "text", text: value },
      });
      setMessages((prev) => {
        if (prev.some((m) => m.message_id === msg.message_id)) return prev;
        return [...prev, msg];
      });
    } catch (e: any) {
      console.warn("Send failed", e);
      Alert.alert("Failed to send", e?.message || "Please try again.");
    } finally {
      setSending(false);
    }
  };

  const pickMedia = async () => {
    const permission = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (permission.status !== "granted") {
      if (!permission.canAskAgain) {
        Alert.alert(
          "Permission needed",
          "Grant photo access in Settings to share photos and videos.",
        );
        return;
      }
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (req.status !== "granted") {
        if (!req.canAskAgain) {
          Alert.alert(
            "Permission needed",
            "Grant photo access in Settings to share photos and videos.",
          );
        }
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsEditing: false,
      quality: 0.6,
      base64: true,
      videoMaxDuration: 20,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const isVideo = asset.type === "video";
    let base64 = asset.base64;
    let mime = asset.mimeType || (isVideo ? "video/mp4" : "image/jpeg");

    if (!base64 && !isVideo) {
      Alert.alert("Unable to attach", "Could not read media.");
      return;
    }
    if (isVideo && !base64) {
      // For videos, base64 may not be provided; try to fetch and encode
      try {
        const resp = await fetch(asset.uri);
        const blob = await resp.blob();
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = reject;
          reader.onload = () => {
            const dataUrl = String(reader.result || "");
            const idx = dataUrl.indexOf(",");
            resolve(idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl);
          };
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn("video read failed", e);
        Alert.alert("Unable to attach", "Could not read video.");
        return;
      }
    }

    // Guard against huge payloads
    if (base64 && base64.length > 8 * 1024 * 1024) {
      Alert.alert("File too large", "Please choose a smaller file (< 6MB).");
      return;
    }

    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const msg = await apiFetch<Message>(`/api/conversations/${id}/messages`, {
        method: "POST",
        token,
        body: {
          type: isVideo ? "video" : "image",
          media_base64: base64,
          media_mime: mime,
        },
      });
      setMessages((prev) => {
        if (prev.some((m) => m.message_id === msg.message_id)) return prev;
        return [...prev, msg];
      });
    } catch (e: any) {
      console.warn("Send media failed", e);
      Alert.alert("Failed to send", e?.message || "Please try again.");
    } finally {
      setSending(false);
    }
  };

  const renderItem = ({ item }: { item: Message }) => {
    const mine = item.sender_id === user?.user_id;
    const bubbleStyle = [
      styles.bubble,
      mine ? styles.bubbleMine : styles.bubbleTheirs,
    ];
    const textStyle = mine ? styles.bubbleTextMine : styles.bubbleTextTheirs;
    const timeStyle = mine ? styles.bubbleTimeMine : styles.bubbleTimeTheirs;

    return (
      <View
        testID={`message-${item.message_id}`}
        style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}
      >
        <View style={bubbleStyle}>
          {item.type === "text" ? (
            <Text style={textStyle}>{item.text}</Text>
          ) : item.type === "image" ? (
            <Image
              source={{
                uri: `data:${item.media_mime || "image/jpeg"};base64,${item.media_base64}`,
              }}
              style={styles.media}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.videoPlaceholder}>
              <Ionicons name="videocam" size={28} color={colors.onSurface} />
              <Text style={styles.videoLabel}>Video</Text>
            </View>
          )}
          <Text style={timeStyle}>{formatTime(item.created_at)}</Text>
        </View>
      </View>
    );
  };

  const peerInitial = (peer_name || "?").trim().charAt(0).toUpperCase();

  return (
    <SafeAreaView testID="chat-detail-screen" edges={["top"]} style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          testID="chat-back-button"
          onPress={() => router.back()}
          style={styles.headerBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </TouchableOpacity>
        {peer_picture ? (
          <Image source={{ uri: peer_picture }} style={styles.headerAvatar} />
        ) : (
          <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
            <Text style={styles.headerAvatarText}>{peerInitial}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text testID="chat-peer-name" style={styles.headerName} numberOfLines={1}>
            {peer_name || "Chat"}
          </Text>
          <Text style={styles.headerStatus}>Online</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.brandPrimary} />
          </View>
        ) : (
          <FlatList
            testID="messages-list"
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.message_id}
            renderItem={renderItem}
            contentContainerStyle={{
              paddingHorizontal: spacing.md,
              paddingTop: spacing.lg,
              paddingBottom: spacing.md,
              flexGrow: 1,
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Say hi 👋</Text>
                <Text style={styles.emptySubtitle}>This is the start of your conversation.</Text>
              </View>
            }
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        <View
          style={[
            styles.inputBar,
            { paddingBottom: Math.max(insets.bottom, spacing.sm) },
          ]}
        >
          <TouchableOpacity
            testID="attach-media-button"
            onPress={pickMedia}
            disabled={sending}
            style={styles.attachBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="image-outline" size={22} color={colors.brandPrimary} />
          </TouchableOpacity>
          <TextInput
            testID="message-input"
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={colors.onSurfaceTertiary}
            multiline
            maxLength={2000}
            editable={!sending}
          />
          <TouchableOpacity
            testID="send-message-button"
            onPress={sendText}
            disabled={!text.trim() || sending}
            style={[
              styles.sendBtn,
              (!text.trim() || sending) && styles.sendBtnDisabled,
            ]}
            activeOpacity={0.85}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.onBrandPrimary} />
            ) : (
              <Ionicons name="arrow-up" size={20} color={colors.onBrandPrimary} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  headerBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandTertiary,
  },
  headerAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: {
    fontWeight: "700",
    color: colors.brandPrimary,
    fontSize: typography.lg,
  },
  headerName: {
    fontSize: typography.lg,
    fontWeight: "600",
    color: colors.onSurface,
  },
  headerStatus: {
    fontSize: typography.sm,
    color: colors.brandPrimary,
    fontWeight: "500",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  msgRow: {
    marginVertical: 3,
    flexDirection: "row",
  },
  msgRowMine: { justifyContent: "flex-end" },
  msgRowTheirs: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "80%",
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleMine: {
    backgroundColor: colors.brandPrimary,
    borderBottomRightRadius: 6,
  },
  bubbleTheirs: {
    backgroundColor: colors.surfaceTertiary,
    borderBottomLeftRadius: 6,
  },
  bubbleTextMine: {
    color: colors.onBrandPrimary,
    fontSize: typography.lg,
    lineHeight: 22,
  },
  bubbleTextTheirs: {
    color: colors.onSurface,
    fontSize: typography.lg,
    lineHeight: 22,
  },
  bubbleTimeMine: {
    marginTop: 4,
    fontSize: 10,
    color: "rgba(255,255,255,0.75)",
    alignSelf: "flex-end",
  },
  bubbleTimeTheirs: {
    marginTop: 4,
    fontSize: 10,
    color: colors.onSurfaceTertiary,
    alignSelf: "flex-end",
  },
  media: {
    width: 220,
    height: 220,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
  },
  videoPlaceholder: {
    width: 220,
    height: 140,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  videoLabel: {
    fontSize: typography.base,
    color: colors.onSurface,
    fontWeight: "600",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    fontSize: typography.xxl,
    fontWeight: "700",
    color: colors.onSurface,
  },
  emptySubtitle: {
    marginTop: spacing.xs,
    color: colors.onSurfaceSecondary,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    color: colors.onSurface,
    fontSize: typography.lg,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: colors.brandSecondary,
    opacity: 0.5,
  },
});
