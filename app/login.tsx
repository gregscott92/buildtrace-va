import { useState } from "react";
import { Alert, Button, Text, TextInput, View } from "react-native";
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

    localStorage.setItem("user", JSON.stringify(data.user));
      }

      if (data?.session) {
        router.replace("/dashboard");
        return;
      }

      Alert.alert("Login failed", "No session returned.");
    } catch (err: any) {
      Alert.alert("Login failed", err?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 28, fontWeight: "700" }}>Login</Text>

      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{ borderWidth: 1, padding: 12, borderRadius: 8 }}
      />

      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderWidth: 1, padding: 12, borderRadius: 8 }}
      />

      <Button
        title={loading ? "Logging in..." : "Login"}
        onPress={handleLogin}
        disabled={loading}
      />
    </View>
  );
}
