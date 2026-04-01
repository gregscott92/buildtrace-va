import { router } from "expo-router";
import React, { useState } from "react";
import { Alert, Text, TextInput, TouchableOpacity, View } from "react-native";
import { setAppSession } from "../lib/appSession";
import { signUpWithEmail } from "../lib/auth";

export default function SignupScreen() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    try {
      setLoading(true);

      const result = await signUpWithEmail(
        email.trim(),
        password,
        fullName.trim()
      );

      if (!result.workspace) {
        throw new Error("No workspace returned after signup.");
      }

      setAppSession({
        userId: result.user.id,
        organizationId: result.workspace.organization_id,
        organizationName: result.workspace.organization_name,
        role: result.workspace.role,
      });

      Alert.alert("Success", "Account created successfully.");
      router.replace("/dashboard");
    } catch (err: any) {
      Alert.alert("Signup failed", err.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: "700" }}>Create Account</Text>

      <TextInput
        placeholder="Full name"
        value={fullName}
        onChangeText={setFullName}
        style={{
          borderWidth: 1,
          borderColor: "#ccc",
          borderRadius: 8,
          padding: 12,
        }}
      />

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
        onPress={handleSignup}
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
          {loading ? "Creating..." : "Create Account"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => router.push("/login")}
        style={{ alignItems: "center", marginTop: 8 }}
      >
        <Text style={{ color: "#2563eb" }}>Already have an account? Log in</Text>
      </TouchableOpacity>
    </View>
  );
}