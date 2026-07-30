import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

import { useAuth } from "@/src/auth-context";
import { apiFetch, getWsUrl } from "@/src/api";
import { Message } from "@/src/types";
import { useTheme } from "@/src/theme-context";
import { Palette, radius, spacing, typography } from "@/src/theme";
import { PandaBackground } from "@/src/components/PandaBackground";
import * as DocumentPicker from "expo-document-picker";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function ChatDetailScreen() {
  const { id, peer_name, peer_picture, peer_username, peer_user_id } = useLocalSearchParams<{
    id: string;
    peer_name?: string;
    peer_picture?: string;
    peer_user_id?: string;
    peer_username?: string;
  }>();
  const router = useRouter();
  const { token, user } = useAuth();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerOnline, setPeerOnline] = useState(false);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingSentRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markRead = useCallback(async () => {
    if (!token || !id) return;
    try {
      await apiFetch(`/api/conversations/${id}/read`, { method: "POST", token });
    } catch {}
  }, [token, id]);

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
    markRead();
  }, [token, id, markRead]);

  useEffect(() => {
    load();
  }, [load]);

  // Fetch initial presence for peer
  useEffect(() => {
    if (!token || !peer_user_id) return;
    apiFetch<Record<string, boolean>>(
      `/api/presence?ids=${peer_user_id}`,
      { token },
    )
      .then((map) => setPeerOnline(!!map[peer_user_id as string]))
      .catch(() => {});
  }, [token, peer_user_id]);

  // WebSocket
  useEffect(() => {
    if (!token || !id) return;
    const url = getWsUrl(token);
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(url);
      wsRef.current = ws;
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
              markRead();
            }
          } else if (parsed.event === "read") {
            const { conversation_id, reader_id, read_at } = parsed.data || {};
            if (conversation_id !== id) return;
            if (reader_id === user?.user_id) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.sender_id === user?.user_id && !m.read_at
                  ? { ...m, read_at }
                  : m,
              ),
            );
          } else if (parsed.event === "typing") {
            const { conversation_id, user_id, is_typing } = parsed.data || {};
            if (conversation_id !== id) return;
            if (user_id === user?.user_id) return;
            setPeerTyping(!!is_typing);
          } else if (parsed.event === "presence") {
            const { user_id, is_online } = parsed.data || {};
            if (user_id && user_id === peer_user_id) {
              setPeerOnline(!!is_online);
            }
          }
        } catch {}
      };
    } catch (e) {
      console.warn("WS connect failed", e);
    }
    return () => {
      try { ws?.close(); } catch {}
      wsRef.current = null;
    };
  }, [token, id, user?.user_id, peer_user_id, markRead]);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [messages.length]);

  const sendTyping = useCallback((is_typing: boolean) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(
        JSON.stringify({
          event: "typing",
          conversation_id: id,
          is_typing,
        }),
      );
    } catch {}
  }, [id]);

  const handleTextChange = (value: string) => {
    setText(value);
    if (value.length > 0 && !typingSentRef.current) {
      typingSentRef.current = true;
      sendTyping(true);
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      typingSentRef.current = false;
      sendTyping(false);
    }, 2500);
  };

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (typingSentRef.current) sendTyping(false);
    };
  }, [sendTyping]);

  const sendText = async () => {
    const value = text.trim();
    if (!value || sending || !token) return;
    setSending(true);
    setText("");
    typingSentRef.current = false;
    sendTyping(false);
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
    setAttachSheetOpen(false);
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

  const pickDocument = async () => {
    setAttachSheetOpen(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const size = asset.size || 0;
      if (size > 6 * 1024 * 1024) {
        Alert.alert("File too large", "Please choose a file under 6MB.");
        return;
      }

      // Read file → base64
      let base64 = "";
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
        console.warn("doc read failed", e);
        Alert.alert("Unable to attach", "Could not read file.");
        return;
      }

      if (!base64) return;
      setSending(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const msg = await apiFetch<Message>(`/api/conversations/${id}/messages`, {
          method: "POST",
          token,
          body: {
            type: "document",
            media_base64: base64,
            media_mime: asset.mimeType || "application/octet-stream",
            filename: asset.name || "file",
            filesize: size,
          },
        });
        setMessages((prev) =>
          prev.some((m) => m.message_id === msg.message_id) ? prev : [...prev, msg],
        );
      } catch (e: any) {
        Alert.alert("Failed to send", e?.message || "Please try again.");
      } finally {
        setSending(false);
      }
    } catch (e) {
      console.warn("document pick failed", e);
    }
  };

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const mine = item.sender_id === user?.user_id;
    const bubbleStyle = [
      styles.bubble,
      mine ? styles.bubbleMine : styles.bubbleTheirs,
    ];
    const textStyle = mine ? styles.bubbleTextMine : styles.bubbleTextTheirs;
    const timeStyle = mine ? styles.bubbleTimeMine : styles.bubbleTimeTheirs;

    // Read receipt: only show on last message from me
    const isLastMine =
      mine &&
      !messages.slice(index + 1).some((m) => m.sender_id === user?.user_id);

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
          ) : item.type === "video" ? (
            <View style={styles.videoPlaceholder}>
              <Ionicons name="videocam" size={28} color={colors.onSurface} />
              <Text style={styles.videoLabel}>Video</Text>
            </View>
          ) : (
            <View style={styles.documentCard}>
              <View style={styles.documentIconWrap}>
                <Ionicons name="document-text" size={22} color={mine ? colors.onBrandPrimary : colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={[styles.documentName, { color: mine ? colors.onBrandPrimary : colors.onSurface }]}
                >
                  {item.filename || "File"}
                </Text>
                <Text
                  style={[
                    styles.documentMeta,
                    { color: mine ? "rgba(255,255,255,0.85)" : colors.onSurfaceTertiary },
                  ]}
                >
                  {formatFileSize(item.filesize)}
                </Text>
              </View>
            </View>
          )}
          <View style={styles.metaRow}>
            <Text style={timeStyle}>{formatTime(item.created_at)}</Text>
            {mine && (
              <Ionicons
                name={item.read_at ? "checkmark-done" : "checkmark"}
                size={13}
                color={
                  item.read_at
                    ? "#7DE0FF"
                    : "rgba(255,255,255,0.85)"
                }
                style={{ marginLeft: 4 }}
              />
            )}
          </View>
        </View>
        {isLastMine && item.read_at && (
          <Text testID={`read-indicator-${item.message_id}`} style={styles.readLabel}>
            Read
          </Text>
        )}
      </View>
    );
  };

  const peerInitial = (peer_name || "?").trim().charAt(0).toUpperCase();

  return (
    <PandaBackground>
      <SafeAreaView testID="chat-detail-screen" edges={["top"]} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="chat-back-button"
          onPress={() => router.back()}
          style={styles.headerBtn}
        >
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </TouchableOpacity>
        {peer_picture ? (
          <View style={styles.headerAvatarWrap}>
            <Image source={{ uri: peer_picture }} style={styles.headerAvatar} />
            {peerOnline && <View style={styles.presenceDot} />}
          </View>
        ) : (
          <View style={styles.headerAvatarWrap}>
            <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
              <Text style={styles.headerAvatarText}>{peerInitial}</Text>
            </View>
            {peerOnline && <View style={styles.presenceDot} />}
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text testID="chat-peer-name" style={styles.headerName} numberOfLines={1}>
            {peer_name || "Chat"}
          </Text>
          <Text
            testID="chat-peer-status"
            style={[styles.headerStatus, !peerTyping && !peerOnline && styles.headerStatusOffline]}
          >
            {peerTyping
              ? "typing…"
              : peerOnline
                ? "Online"
                : peer_username
                  ? `@${peer_username}`
                  : "Offline"}
          </Text>
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
                <View style={styles.emptyBadge}>
                  <Ionicons name="sparkles" size={26} color={colors.brandPrimary} />
                </View>
                <Text style={styles.emptyTitle}>Say hi 👋</Text>
                <Text style={styles.emptySubtitle}>
                  This is the start of your conversation.
                </Text>
              </View>
            }
            ListFooterComponent={
              peerTyping ? (
                <View testID="typing-indicator" style={[styles.msgRow, styles.msgRowTheirs]}>
                  <View style={[styles.bubble, styles.bubbleTheirs, styles.typingBubble]}>
                    <View style={styles.typingDot} />
                    <View style={[styles.typingDot, { opacity: 0.7 }]} />
                    <View style={[styles.typingDot, { opacity: 0.4 }]} />
                  </View>
                </View>
              ) : null
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
            onPress={() => setAttachSheetOpen(true)}
            disabled={sending}
            style={styles.attachBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={22} color={colors.brandPrimary} />
          </TouchableOpacity>
          <TextInput
            testID="message-input"
            style={styles.input}
            value={text}
            onChangeText={handleTextChange}
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

      {/* Attachment sheet */}
      <Modal
        visible={attachSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAttachSheetOpen(false)}
      >
        <TouchableOpacity
          testID="attach-sheet-backdrop"
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setAttachSheetOpen(false)}
        >
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Share something</Text>
            <TouchableOpacity
              testID="attach-option-photo"
              activeOpacity={0.75}
              style={styles.sheetOption}
              onPress={pickMedia}
            >
              <View style={[styles.sheetIconTile, { backgroundColor: colors.brandTertiary }]}>
                <Ionicons name="image" size={22} color={colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetOptionTitle}>Photo or Video</Text>
                <Text style={styles.sheetOptionSubtitle}>Pick from your gallery</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity
              testID="attach-option-document"
              activeOpacity={0.75}
              style={styles.sheetOption}
              onPress={pickDocument}
            >
              <View style={[styles.sheetIconTile, { backgroundColor: colors.brandTertiary }]}>
                <Ionicons name="document-text" size={22} color={colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetOptionTitle}>Document</Text>
                <Text style={styles.sheetOptionSubtitle}>PDF, docs, and other files</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </TouchableOpacity>
            <TouchableOpacity
              testID="attach-sheet-cancel"
              onPress={() => setAttachSheetOpen(false)}
              style={styles.sheetCancel}
              activeOpacity={0.75}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
    </PandaBackground>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "transparent",
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
    headerAvatarWrap: {
      width: 38,
      height: 38,
      position: "relative",
    },
    headerAvatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.brandTertiary,
    },
    presenceDot: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: "#22C55E",
      borderWidth: 2,
      borderColor: colors.surface,
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
      fontWeight: "700",
      color: colors.onSurface,
    },
    headerStatus: {
      fontSize: typography.sm,
      color: colors.brandPrimary,
      fontWeight: "600",
    },
    headerStatusOffline: {
      color: colors.onSurfaceTertiary,
    },
    loadingWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    msgRow: {
      marginVertical: 3,
    },
    msgRowMine: {
      alignItems: "flex-end",
    },
    msgRowTheirs: {
      alignItems: "flex-start",
    },
    bubble: {
      maxWidth: "80%",
      borderRadius: 22,
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
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-end",
      marginTop: 4,
    },
    bubbleTimeMine: {
      fontSize: 10,
      color: "rgba(255,255,255,0.85)",
    },
    bubbleTimeTheirs: {
      fontSize: 10,
      color: colors.onSurfaceTertiary,
    },
    readLabel: {
      marginTop: 2,
      marginRight: 4,
      fontSize: 10,
      color: colors.onSurfaceTertiary,
      fontWeight: "600",
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
    documentCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minWidth: 220,
    },
    documentIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: "rgba(255,255,255,0.2)",
      alignItems: "center",
      justifyContent: "center",
    },
    documentName: {
      fontSize: typography.lg,
      fontWeight: "700",
    },
    documentMeta: {
      marginTop: 2,
      fontSize: typography.sm,
    },
    sheetBackdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xl,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      gap: spacing.sm,
    },
    sheetHandle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      marginBottom: spacing.md,
    },
    sheetTitle: {
      fontSize: typography.xl,
      fontWeight: "700",
      color: colors.onSurface,
      marginBottom: spacing.sm,
    },
    sheetOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: radius.md,
    },
    sheetIconTile: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    sheetOptionTitle: {
      fontSize: typography.lg,
      fontWeight: "600",
      color: colors.onSurface,
    },
    sheetOptionSubtitle: {
      marginTop: 2,
      fontSize: typography.sm,
      color: colors.onSurfaceTertiary,
    },
    sheetCancel: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSecondary,
      alignItems: "center",
    },
    sheetCancelText: {
      fontSize: typography.lg,
      fontWeight: "700",
      color: colors.onSurface,
    },
    typingBubble: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    typingDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.brandPrimary,
    },
    empty: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.xxl,
    },
    emptyBadge: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: colors.brandTertiary,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.md,
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
      backgroundColor: colors.brandTertiary,
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
      opacity: 0.4,
    },
  });
