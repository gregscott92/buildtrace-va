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

    router.replace("/login");
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 20, gap: 16 }}>
      <Text style={{ fontSize: 28, fontWeight: "700" }}>Dashboard</Text>
      <Button title="Log out" onPress={handleLogout} />
    </View>
  );
}
