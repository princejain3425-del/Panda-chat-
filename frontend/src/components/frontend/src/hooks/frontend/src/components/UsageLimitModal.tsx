// frontend/src/components/UsageLimitModal.tsx
import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";

/**
 * Full-screen modal shown when usage limit is reached.
 * Buttons:
 *  - Continue: dismisses (optionally increases limit)
 *  - Lock: triggers a lock flow (show LockModal or global lock)
 */
type Props = {
  visible: boolean;
  onContinue: () => void;
  onLock: () => void;
};

export default function UsageLimitModal({ visible, onContinue, onLock }: Props) {
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <Text style={styles.title}>Time Limit Reached! 🚨</Text>
          <Text style={styles.msg}>
            You've reached your daily active limit. Would you like to continue or lock the app to focus?
          </Text>
          <View style={{ flexDirection: "row", marginTop: 16 }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: "#c33" }]} onPress={onLock}>
              <Text style={styles.btnText}>Lock & Focus</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { marginLeft: 8 }]} onPress={onContinue}>
              <Text style={styles.btnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" },
  box: { width: "92%", backgroundColor: "#fff", borderRadius: 12, padding: 20 },
  title: { fontSize: 20, fontWeight: "700" },
  msg: { marginTop: 12, color: "#444" },
  btn: { flex: 1, padding: 12, borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
});
