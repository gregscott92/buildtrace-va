import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { bootstrapAuthenticatedUser } from "../lib/session-bootstrap";

export default function IndexScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const result = await bootstrapAuthenticatedUser();

        if (!mounted) return;

        if (!result.isAuthenticated) {
          router.replace("/login");
          return;
        }

        router.replace("/dashboard");
      } catch (err: any) {
        if (!mounted) return;
        setError(err.message ?? "Unknown error");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text>Loading BuildTrace...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Text style={{ color: "red" }}>Startup error: {error}</Text>
      </View>
    );
  }

  return null;
}