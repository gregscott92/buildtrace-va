import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";

export default function SelectModeScreen() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#06153a",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Text
        style={{
          color: "white",
          fontSize: 34,
          fontWeight: "700",
          textAlign: "center",
          marginBottom: 12,
        }}
      >
        VA Mode
      </Text>

      <Text
        style={{
          color: "#aab4c8",
          fontSize: 16,
          textAlign: "center",
          marginBottom: 28,
        }}
      >
        Continue to VA analysis
      </Text>

      <Pressable
        onPress={() => router.replace("/va")}
        style={{
          backgroundColor: "#16a34a",
          paddingVertical: 20,
          borderRadius: 18,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "white", fontSize: 22, fontWeight: "700" }}>
          Open VA
        </Text>
      </Pressable>
    </View>
  );
}