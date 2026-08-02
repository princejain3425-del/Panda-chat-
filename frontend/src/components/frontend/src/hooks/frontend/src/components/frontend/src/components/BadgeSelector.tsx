// frontend/src/components/BadgeSelector.tsx
import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, FlatList } from "react-native";

const BADGES = [
  { id: "exam_demon", label: "Exam Demon", emoji: "⚡" },
  { id: "pookie_friend", label: "Pookie Friend", emoji: "🎀" },
  { id: "dumbo_panda", label: "Dumbo Panda", emoji: "🐘" },
  { id: "night_owl", label: "Night Owl", emoji: "🦉" },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (badgeId: string) => Promise<void>;
};

export default function BadgeSelector({ visible, onClose, onSelect }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <Text style={styles.title}>Select a Badge</Text>
          <FlatList
            data={BADGES}
            numColumns={2}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.badge}
                onPress={async () => {
                  await onSelect(item.id);
                  onClose();
                }}
              >
                <Text style={styles.emoji}>{item.emoji}</Text>
                <Text style={styles.label}>{item.label}</Text>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={{ color: "#fff" }}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  container: { width: "90%", backgroundColor: "#fff", borderRadius: 12, padding: 16 },
  title: { fontSize: 18, fontWeight: "600", marginBottom: 12 },
  badge: { flex: 1, alignItems: "center", margin: 8, padding: 12, borderRadius: 8, backgroundColor: "#f6f6f6" },
  emoji: { fontSize: 28 },
  label: { marginTop: 6, textAlign: "center" },
  closeBtn: { marginTop: 12, backgroundColor: "#333", padding: 10, borderRadius: 8, alignItems: "center" },
});
