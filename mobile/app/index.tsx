import { useEffect } from "react";
import { View, Text } from "react-native";
import { router } from "expo-router";
import { getSession } from "../lib/auth";

export default function IndexScreen() {
  useEffect(() => {
    async function checkAuth() {
      const { session } = await getSession();

      if (session) {
        router.replace("/dashboard");
      } else {
        router.replace("/login");
      }
    }

    checkAuth();
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Loading BuildTrace...</Text>
    </View>
  );
}