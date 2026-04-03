import { useState } from "react";
import { Alert, Button, Text, TextInput, View } from "react-native";
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

      if (data?.user) {
        try {
          localStorage.setItem("user", JSON.stringify(data.user));
        } catch {}
      }

      if (data?.session || data?.user) {
        window.location.href = "/va";
        return;
      }

      Alert.alert("Signup failed", "No user returned.");
    } catch (err: any) {
      Alert.alert("Signup failed", err?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 28, fontWeight: "700" }}>Sign Up</Text>

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
        title={loading ? "Creating account..." : "Create account"}
        onPress={handleSignup}
        disabled={loading}
      />
    </View>
  );
}
