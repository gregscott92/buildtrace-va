import { Alert, Button, Text, View } from "react-native";
import { router } from "expo-router";
import { signOutUser } from "../lib/auth";

export default function DashboardScreen() {
  async function handleLogout() {
    const { error } = await signOutUser();

    if (error) {
      Alert.alert("Logout failed", error.message);
      return;
    }

    try {
      localStorage.removeItem("user");
    } catch {}

    router.replace("/login");
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 28, fontWeight: "700" }}>BuildTrace Dashboard</Text>
      <Text>You are logged in.</Text>
      <Button title="Go to VA Tool" onPress={() => router.replace("/va")} />
      <Button title="Logout" onPress={handleLogout} />
    </View>
  );
}
