import { useState } from "react";
import { Alert, Button, Text, TextInput, View, Pressable } from "react-native";
import { router } from "expo-router";
import { useRouter } from "expo-router";
import { signInWithEmail } from "../lib/auth";


const handleLogin = async () => {
  try {
    console.log("LOGIN CLICKED");

    const response = await fetch("https://buildtrace-va.onrender.comlogin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
      }),
    });

    console.log("STATUS:", response.status);

    const data = await response.json();
    console.log("DATA:", data);

    if (!response.ok || !data.success) {
      alert(data.error || "Login failed");
      return;
    }

    // SUCCESS → redirect
    window.location.href = "/va";

  } router.replace("/va");

    catch (err) {
    console.log("LOGIN ERROR:", err);
    alert("Network error");
  }
};


export default function LoginScreen() {
  const router = useRouter();

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

      <Pressable onPress={handleLogin} // replaced inline router.push("/signup")} style={{ marginTop: 20 }}>
        <Text style={{ textAlign: "center", color: "#2563eb", fontSize: 16 }}>
          Need an account? Sign up
        </Text>
      </Pressable>
    </View>
  );
}