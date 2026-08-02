// frontend/src/components/LockModal.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";

type Props = {
  visible: boolean;
  conversationId: string;
  onUnlock: () => void;
  onClose?: () => void;
};

/**
 * LockModal manages a per-conversation PIN (stored in SecureStore) and biometric unlock.
 * - PIN is never sent to the server.
 * - Key name pattern: pin:<conversationId>
 */
export default function LockModal({
  visible,
  conversationId,
  onUnlock,
  onClose,
}: Props) {
  const key = `pin:${conversationId}`;
  const [mode, setMode] = useState<"enter" | "create">("enter");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [stored, setStored] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const v = await SecureStore.getItemAsync(key);
        setStored(v);
        setMode(v ? "enter" : "create");
      } catch (e) {
        // SecureStore may throw on simulators without proper setup
        setStored(null);
        setMode("create");
      }
    })();
  }, [visible, conversationId]);

  async function tryBiometric() {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!hasHardware) return false;
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!enrolled) return false;
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock conversation",
        fallbackLabel: "Use PIN",
        disableDeviceFallback: false,
      });
      return res.success;
    } catch {
      return false;
    }
  }

  async function onSubmitEnter() {
    const bioOk = await tryBiometric();
    if (bioOk) {
      onUnlock();
      return;
    }
    if (!stored) {
      Alert.alert("No PIN set", "Please create a PIN first.");
      setMode("create");
      return;
    }
    if (pin === stored) {
      setPin("");
      onUnlock();
    } else {
      Alert.alert("Incorrect PIN", "Please try again.");
      setPin("");
    }
  }

  async function onSubmitCreate() {
    if (!/^\d{4,}$/.test(pin)) {
      Alert.alert("PIN invalid", "Use at least 4 digits.");
      return;
    }
    if (pin !== confirmPin) {
      Alert.alert("PIN mismatch", "Please make sure PINs match.");
      return;
    }
    await SecureStore.setItemAsync(key, pin, {
      keychainAccessible: SecureStore.ALWAYS_THIS_DEVICE_ONLY,
    });
    setStored(pin);
    setPin("");
    setConfirmPin("");
    setMode("enter");
    Alert.alert("PIN set", "You can now use biometric or PIN to unlock.");
  }

  async function onRemovePin() {
    await SecureStore.deleteItemAsync(key);
    setStored(null);
    setMode("create");
    Alert.alert("PIN removed", "You removed the local PIN for this conversation.");
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <Text style={styles.title}>
            {mode === "enter" ? "Enter PIN or use biometric" : "Create PIN"}
          </Text>

          {mode === "enter" ? (
            <>
              <TextInput
                style={styles.input}
                placeholder="Enter PIN"
                value={pin}
                onChangeText={setPin}
                keyboardType="number-pad"
                secureTextEntry
              />
              <TouchableOpacity style={styles.btn} onPress={onSubmitEnter}>
                <Text style={styles.btnText}>Unlock</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                <TouchableOpacity onPress={() => setMode("create")}>
                  <Text style={styles.link}>Create / Reset PIN</Text>
                </TouchableOpacity>
                {stored ? (
                  <TouchableOpacity onPress={onRemovePin}>
                    <Text style={[styles.link, { color: "#c33" }]}>Remove PIN</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          ) : (
            <>
              <TextInput
                style={styles.input}
                placeholder="New PIN"
                value={pin}
                onChangeText={setPin}
                keyboardType="number-pad"
                secureTextEntry
              />
              <TextInput
                style={styles.input}
                placeholder="Confirm PIN"
                value={confirmPin}
                onChangeText={setConfirmPin}
                keyboardType="number-pad"
                secureTextEntry
              />
              <TouchableOpacity style={styles.btn} onPress={onSubmitCreate}>
                <Text style={styles.btnText}>Save PIN</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={styles.close} onPress={onClose}>
            <Text style={{ color: "#666" }}>Close</Text>
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
  input: { borderWidth: 1, borderColor: "#ddd", padding: 12, borderRadius: 8, marginBottom: 8 },
  btn: { backgroundColor: "#2563eb", padding: 12, borderRadius: 8, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  link: { color: "#2563eb" },
  close: { marginTop: 12, alignItems: "center" },
});
