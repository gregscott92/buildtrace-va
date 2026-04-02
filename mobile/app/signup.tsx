import { useState } from "react";
import { Alert, Button, Text, TextInput, View, Pressable } from "react-native";
import { router } from "expo-router";
import { signUpWithEmail } from "../lib/auth";

export default function SignupScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    try {
      setLoading(true);

      const { data, error } = await signUpWithEmail(email.trim(), password);

      if (error) {
        Alert.alert("Signup failed", error.message);
        return;
      }

      if (data?.session) {
        router.replace("/select-mode");
        return;
      }

      Alert.alert("Signup complete", "You can now log in.");
      router.replace("/login");
    } catch (err) {
      Alert.alert("Signup failed", err?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
      <Text style={{ fontSize: 28, fontWeight: "700", marginBottom: 24 }}>
        Sign Up
      </Text>

      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{ borderWidth: 1, padding: 12, borderRadius: 8, marginBottom: 12 }}
      />

      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderWidth: 1, padding: 12, borderRadius: 8, marginBottom: 16 }}
      />

      <Button
        title={loading ? "Creating account..." : "Sign Up"}
        onPress={handleSignup}
        disabled={loading}
      />

      <Pressable onPress={() => router.push("/login")} style={{ marginTop: 20 }}>
        <Text style={{ textAlign: "center", color: "#2563eb", fontSize: 16 }}>
          Already have an account? Log in
        </Text>
      </Pressable>
    </View>
  );
}