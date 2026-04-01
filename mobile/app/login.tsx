import { router } from "expo-router";
import React, { useState } from "react";
import { Alert, Text, TextInput, TouchableOpacity, View } from "react-native";
import { setAppSession } from "../lib/appSession";
import { getCurrentUser, signInWithEmail } from "../lib/auth";
import { ensureWorkspace } from "../lib/workspace";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    try {
      setLoading(true);

      await signInWithEmail(email.trim(), password);

      const user = await getCurrentUser();
      if (!user) {
        throw new Error("No authenticated user found after login.");
      }

      const workspace = await ensureWorkspace();

      setAppSession({
        userId: user.id,
        organizationId: workspace.organization_id,
        organizationName: workspace.organization_name,
        role: workspace.role,
      });

      Alert.alert("Success", "Logged in successfully.");
      router.replace("/select-mode");
    } catch (err: any) {
      Alert.alert("Login failed", err.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: "700" }}>Login</Text>

      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{
          borderWidth: 1,
          borderColor: "#ccc",
          borderRadius: 8,
          padding: 12,
        }}
      />

      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{
          borderWidth: 1,
          borderColor: "#ccc",
          borderRadius: 8,
          padding: 12,
        }}
      />

      <TouchableOpacity
        onPress={handleLogin}
        disabled={loading}
        style={{
          backgroundColor: "#111827",
          padding: 14,
          borderRadius: 8,
          alignItems: "center",
          opacity: loading ? 0.7 : 1,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "600" }}>
          {loading ? "Logging in..." : "Log In"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => router.push("/signup")}
        style={{ alignItems: "center", marginTop: 8 }}
      >
        <Text style={{ color: "#2563eb" }}>Need an account? Sign up</Text>
      </TouchableOpacity>
    </View>
  );
}
