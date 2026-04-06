import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useFocusEffect, router } from "expo-router";

const API_URL = "https://buildtrace-va.onrender.com";

async function getToken() {
  try {
    const token = await AsyncStorage.getItem("access_token");
    console.log("TOKEN USED:", token);
    return token;
  } catch (err) {
    console.log("GET TOKEN ERROR:", err);
    return null;
  }
}

export default function SavedClaimsScreen() {
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadClaims = useCallback(async () => {
    try {
      console.log("LOAD CLAIMS START");
      setError("");

      const token = await getToken();

      if (!token) {
        console.log("NO TOKEN FOUND ON SAVED CLAIMS SCREEN");
        setError("No access token found. Please log in again.");
        setClaims([]);
        return;
      }

      const res = await fetch(`${API_URL}/claims`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      console.log("CLAIMS STATUS:", res.status);

      const json = await res.json();
      console.log("CLAIMS RESPONSE:", JSON.stringify(json));

      if (!res.ok) {
        throw new Error(json?.error || "Failed to load claims");
      }

      const nextClaims = Array.isArray(json?.claims) ? json.claims : [];
      console.log("CLAIMS COUNT:", nextClaims.length);

      setClaims(nextClaims);
    } catch (err: any) {
      console.log("LOAD CLAIMS ERROR:", err);
      setError(err?.message || "Failed to load claims");
      setClaims([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      console.log("SAVED CLAIMS SCREEN FOCUSED");
      setLoading(true);
      loadClaims();
    }, [loadClaims])
  );

  const onRefresh = async () => {
    console.log("CLAIMS REFRESH");
    setRefreshing(true);
    await loadClaims();
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff", padding: 16 }}>
      <Pressable
        onPress={() => router.back()}
        style={{
          alignSelf: "flex-start",
          marginBottom: 16,
          paddingVertical: 8,
          paddingHorizontal: 12,
          backgroundColor: "#eee",
          borderRadius: 8,
        }}
      >
        <Text style={{ fontWeight: "700" }}>Back</Text>
      </Pressable>

      <Text style={{ fontSize: 24, fontWeight: "800", marginBottom: 12 }}>
        Saved Claims
      </Text>

      {loading ? (
        <ActivityIndicator size="large" />
      ) : error ? (
        <Text style={{ color: "red", marginBottom: 12 }}>{error}</Text>
      ) : null}

      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {!loading && claims.length === 0 ? (
          <Text style={{ color: "#555" }}>No saved claims yet.</Text>
        ) : null}

        {claims.map((claim) => (
          <View
            key={claim.id}
            style={{
              borderWidth: 1,
              borderColor: "#ddd",
              borderRadius: 12,
              padding: 14,
              marginBottom: 12,
              backgroundColor: "#fafafa",
            }}
          >
            <Text style={{ fontWeight: "800", marginBottom: 6 }}>
              {claim.detected_condition || "Unknown Condition"}
            </Text>

            <Text style={{ marginBottom: 4 }}>
              Rating: {claim.estimated_rating ?? "N/A"}
            </Text>

            <Text style={{ marginBottom: 4 }}>
              Confidence: {claim.confidence_label || "N/A"}
            </Text>

            <Text style={{ marginBottom: 4 }}>
              Source: {claim.source_type || "N/A"}
            </Text>

            <Text style={{ marginBottom: 8 }}>
              Created: {claim.created_at || "N/A"}
            </Text>

            <Text style={{ fontWeight: "700", marginBottom: 4 }}>
              Input
            </Text>
            <Text style={{ marginBottom: 8 }}>
              {claim.input_text || ""}
            </Text>

            <Text style={{ fontWeight: "700", marginBottom: 4 }}>
              Summary
            </Text>
            <Text>
              {claim.export_summary || claim.result_text || ""}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
