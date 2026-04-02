import { useState } from "react";
import { Alert, Button, Text, TextInput, View, Pressable } from "react-native";
import { router } from "expo-router";
import { signInWithEmail } from "../lib/auth";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    try {
      setLoading(true);

      const { data, error } = await signInWithEmail(email.trim(), password);

      if (error) {
        Alert.alert("Login failed", error.message);
        return;
      }

      if (data?.session) {
        router.replace("/select-mode");
        return;
      }

      Alert.alert("Login failed", "No session returned.");
    } catch (err) {
      Alert.alert("Login failed", err?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
      <Text style={{ fontSize: 28, fontWeight: "700", marginBottom: 24 }}>
        Login
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
        title={loading ? "Logging in..." : "Log In"}
        onPress={handleLogin}
        disabled={loading}
      />

      <Pressable onPress={() => router.push("/signup")} style={{ marginTop: 20 }}>
        <Text style={{ textAlign: "center", color: "#2563eb", fontSize: 16 }}>
          Need an account? Sign up
        </Text>
      </Pressable>
    </View>
  );
}