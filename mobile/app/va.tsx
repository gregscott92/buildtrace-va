import { View, Text } from "react-native";

export default function VAScreen() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0f172a",
        padding: 24,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text
        style={{
          color: "white",
          fontSize: 28,
          fontWeight: "700",
          marginBottom: 12,
        }}
      >
        VA Mode
      </Text>

      <Text
        style={{
          color: "#94a3b8",
          fontSize: 16,
          textAlign: "center",
        }}
      >
        VA section is now connected.
      </Text>
    </View>
  );
}
