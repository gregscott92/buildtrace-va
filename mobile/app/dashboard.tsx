import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from "react-native";

const API_BASE_URL = "http://10.127.190.198:3000";

export default function DashboardScreen() {
  const [input, setInput] = useState(
    "Built my backend on my phone using Termux. Connected OpenAI and Supabase."
  );
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runBuildTrace = async () => {
    try {
      setLoading(true);
      setError(null);
      setResult(null);

      const res = await fetch(`${API_BASE_URL}/api/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        setError(text);
        return;
      }

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#f3f4f6", padding: 16 }}>
      <Text style={{ fontSize: 28, fontWeight: "800", marginBottom: 16 }}>
        BuildTrace Dashboard
      </Text>

      {/* INPUT */}
      <View
        style={{
          backgroundColor: "#ffffff",
          padding: 16,
          borderRadius: 12,
          marginBottom: 16,
        }}
      >
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="What did you build?"
          multiline
          style={{
            minHeight: 80,
            fontSize: 16,
          }}
        />
      </View>

      {/* BUTTON */}
      <TouchableOpacity
        onPress={runBuildTrace}
        disabled={loading}
        style={{
          backgroundColor: "#0f172a",
          padding: 16,
          borderRadius: 12,
          alignItems: "center",
          marginBottom:
