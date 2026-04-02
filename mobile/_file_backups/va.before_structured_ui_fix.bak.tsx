import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";

export default function VaScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [issue, setIssue] = useState("");
  const [serviceContext, setServiceContext] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [debugText, setDebugText] = useState("");

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Permission needed", "Please allow photo library access.");
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: true,
    });

    if (!res.canceled && res.assets?.length) {
      setImageUri(res.assets[0].uri);
    }
  }

  async function handleAnalyze() {
    if (!issue.trim() && !serviceContext.trim() && !imageUri) {
      Alert.alert("Missing info", "Add a description, service context, or image.");
      return;
    }

    try {
      setLoading(true);
      setResult(null);
      setDebugText("Submitting request...");

      const formData = new FormData();
      formData.append("issue", issue);
      formData.append("serviceContext", serviceContext);

      if (imageUri) {
        const filename = imageUri.split("/").pop() || "evidence.jpg";
        const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
        const mime =
          ext === "png"
            ? "image/png"
            : ext === "heic"
            ? "image/heic"
            : "image/jpeg";

        formData.append("image", {
          uri: imageUri,
          name: filename,
          type: mime,
        } as any);
      }

      const res = await fetch("https://buildtrace-va.onrender.com/va/analyze", {
        method: "POST",
        body: formData,
      });

      setDebugText(`Response status: ${res.status}`);

      const text = await res.text();
      setDebugText(`Response status: ${res.status}\nRaw: ${text}`);

      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text || "Invalid server response" };
      }

      if (!res.ok) {
        Alert.alert("Analysis failed", data?.error || "Server error");
        return;
      }

      setResult(data);
      Alert.alert("Success", "Analysis returned successfully.");
    } catch (err: any) {
      setDebugText(`Request failed: ${err?.message || "Unknown error"}`);
      Alert.alert("Analysis failed", err?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        backgroundColor: "#06153a",
        padding: 20,
      }}
    >
      <Text
        style={{
          color: "white",
          fontSize: 34,
          fontWeight: "700",
          marginTop: 40,
          marginBottom: 10,
          textAlign: "center",
        }}
      >
        VA Mode
      </Text>

      <Text
        style={{
          color: "#aab4c8",
          fontSize: 16,
          marginBottom: 24,
          textAlign: "center",
        }}
      >
        Upload evidence and describe the condition or claim issue.
      </Text>

      <Text style={{ color: "white", marginBottom: 8, fontWeight: "600" }}>
        Short description
      </Text>
      <TextInput
        value={issue}
        onChangeText={setIssue}
        placeholder="Example: lower back pain, tinnitus, knee issue, migraine records"
        placeholderTextColor="#94a3b8"
        multiline
        style={{
          backgroundColor: "white",
          borderRadius: 12,
          padding: 14,
          minHeight: 110,
          marginBottom: 16,
        }}
      />

      <Text style={{ color: "white", marginBottom: 8, fontWeight: "600" }}>
        Service context
      </Text>
      <TextInput
        value={serviceContext}
        onChangeText={setServiceContext}
        placeholder="Example: deployed 2010-2011, airborne ops, MOS, injury event, hearing exposure"
        placeholderTextColor="#94a3b8"
        multiline
        style={{
          backgroundColor: "white",
          borderRadius: 12,
          padding: 14,
          minHeight: 90,
          marginBottom: 16,
        }}
      />

      <Pressable
        onPress={pickImage}
        style={{
          backgroundColor: "#2563eb",
          paddingVertical: 16,
          borderRadius: 14,
          alignItems: "center",
          marginBottom: 18,
        }}
      >
        <Text style={{ color: "white", fontSize: 18, fontWeight: "700" }}>
          {imageUri ? "Change Image" : "Upload Image"}
        </Text>
      </Pressable>

      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          style={{
            width: "100%",
            height: 240,
            borderRadius: 14,
            marginBottom: 18,
          }}
          resizeMode="cover"
        />
      ) : null}

      <Pressable
        onPress={handleAnalyze}
        disabled={loading}
        style={{
          backgroundColor: loading ? "#64748b" : "#16a34a",
          paddingVertical: 18,
          borderRadius: 14,
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={{ color: "white", fontSize: 20, fontWeight: "700" }}>
            Analyze Claim
          </Text>
        )}
      </Pressable>

      {loading ? (
        <Text style={{ color: "white", textAlign: "center", marginBottom: 20 }}>
          Analyzing...
        </Text>
      ) : null}

      {debugText ? (
        <View
          style={{
            backgroundColor: "#0f172a",
            borderRadius: 12,
            padding: 12,
            marginBottom: 20,
          }}
        >
          <Text style={{ color: "#93c5fd", fontWeight: "700", marginBottom: 6 }}>
            Debug
          </Text>
          <Text style={{ color: "white" }}>{debugText}</Text>
        </View>
      ) : null}

      {result ? (
        <View
          style={{
            backgroundColor: "white",
            borderRadius: 16,
            padding: 16,
            marginBottom: 30,
          }}
        >
          <Text style={{ fontSize: 22, fontWeight: "700", marginBottom: 12 }}>
            Result
          </Text>

          <Text style={{ fontSize: 16, marginBottom: 8 }}>
            <Text style={{ fontWeight: "700" }}>Likelihood:</Text>{" "}
            {result.likelihood ?? "N/A"}
          </Text>

          <Text style={{ fontSize: 16, marginBottom: 8 }}>
            <Text style={{ fontWeight: "700" }}>Summary:</Text>{" "}
            {result.summary ?? "N/A"}
          </Text>

          <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>
            Next steps:
          </Text>

          {Array.isArray(result.nextSteps) ? (
            result.nextSteps.map((step: string, i: number) => (
              <Text key={i} style={{ fontSize: 15, marginBottom: 6 }}>
                • {step}
              </Text>
            ))
          ) : (
            <Text style={{ fontSize: 15 }}>
              {result.nextSteps ?? "N/A"}
            </Text>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}