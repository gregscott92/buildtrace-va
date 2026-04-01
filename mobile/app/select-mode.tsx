import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";

export default function SelectModeScreen() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0f172a",
        padding: 24,
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: "white",
          fontSize: 28,
          fontWeight: "700",
          marginBottom: 12,
          textAlign: "center",
        }}
      >
        Choose Mode
      </Text>

      <Text
        style={{
          color: "#94a3b8",
          fontSize: 16,
          marginBottom: 32,
          textAlign: "center",
        }}
      >
        Where do you want to go?
      </Text>

      <Pressable
        onPress={() => router.replace("/dashboard")}
        style={{
          backgroundColor: "#2563eb",
          padding: 16,
          borderRadius: 12,
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: "white",
            fontSize: 18,
            fontWeight: "700",
            textAlign: "center",
          }}
        >
          BuildTrace
        </Text>
      </Pressable>

      <Pressable
        onPress={() => router.replace("/va")}
        style={{
          backgroundColor: "#16a34a",
          padding: 16,
          borderRadius: 12,
        }}
      >
        <Text
          style={{
            color: "white",
            fontSize: 18,
            fontWeight: "700",
            textAlign: "center",
          }}
        >
          VA
        </Text>
      </Pressable>
    </View>
  );
}
