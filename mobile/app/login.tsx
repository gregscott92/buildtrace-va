import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState } from "react";
import { Alert, Button, Text, TextInput, View, Pressable } from "react-native";
import { useRouter } from "expo-router";

export default function LoginScreen() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    try {
      setLoading(true);
      console.log("LOGIN CLICKED");

      const response = await fetch("https://buildtrace-va.onrender.com/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      console.log("STATUS:", response.status);

      const data = await response.json();
      console.log("DATA:", data);

      if (!response.ok || !data?.success) {
        Alert.alert("Login failed", data?.error || "Login failed");
        return;
      }

      if (data?.access_token) {
        await AsyncStorage.setItem("access_token", data.access_token);
        console.log("TOKEN SAVED:", data.access_token);

        const verify = await AsyncStorage.getItem("access_token");
        console.log("VERIFY TOKEN:", verify);
      } else {
        Alert.alert("Login failed", "No access token returned.");
        return;
      }

      router.replace("/select-mode");
    } catch (err: any) {
      console.log("LOGIN ERROR:", err);
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

      <Pressable
        onPress={() => router.push("/signup")}
        style={{ marginTop: 20 }}
      >
        <Text style={{ textAlign: "center", color: "#2563eb", fontSize: 16 }}>
          Need an account? Sign up
        </Text>
      </Pressable>
    </View>
  );
}
