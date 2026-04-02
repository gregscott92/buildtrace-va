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

function bulletize(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);

  return String(value)
    .split(/\n|•|- /)
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function VaScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [issue, setIssue] = useState("");
  const [serviceContext, setServiceContext] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [debugText, setDebugText] = useState("");

  const SHOW_DEBUG = false;

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Permission needed", "Please allow photo library access.");
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"] as any,
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

      if (issue.trim()) {
        formData.append("issue", issue.trim());
      }

      if (serviceContext.trim()) {
        formData.append("serviceContext", serviceContext.trim());
      }

      if (imageUri) {
        formData.append(
          "image",
          {
            uri: imageUri,
            name: "upload.jpg",
            type: "image/jpeg",
          } as any
        );
      }

      const res = await fetch("http://10.124.48.159:3000/va/analyze", {
        method: "POST",
        body: formData,
      });

      const text = await res.text();
      setDebugText(`Response status: ${res.status}\nRaw: ${text}`);

      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text || "Invalid server response" };
      }

      if (!res.ok) {
        Alert.alert("Analysis failed", data?.error || data?.details || "Server error");
        return;
      }

      setResult(data);
    } catch (err: any) {
      setDebugText(`Request failed: ${err?.message || "Unknown error"}`);
      Alert.alert("Analysis failed", err?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const structured = result?.structured || result?.parsed || {};
  const confidenceValue = structured.confidence || "N/A";

  const confidenceColor =
    confidenceValue === "High"
      ? "#16a34a"
      : confidenceValue === "Medium"
      ? "#f59e0b"
      : confidenceValue === "Low"
      ? "#dc2626"
      : "#111827";

  const reasoningItems = bulletize(structured.reasoning);
  const evidenceItems = bulletize(structured.evidenceNeeded);
  const nextStepItems = bulletize(structured.nextSteps);
  const importantItems = bulletize(structured.important);

  const hasEvidenceGap =
    structured.evidenceNeeded &&
    structured.evidenceNeeded !== "N/A" &&
    bulletize(structured.evidenceNeeded).length > 0;

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

      {SHOW_DEBUG && debugText ? (
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

          {hasEvidenceGap ? (
            <View
              style={{
                backgroundColor: "#fff7ed",
                borderColor: "#fdba74",
                borderWidth: 1,
                borderRadius: 12,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  color: "#9a3412",
                  fontWeight: "700",
                  marginBottom: 4,
                }}
              >
                Warning
              </Text>
              <Text style={{ fontSize: 14, color: "#7c2d12" }}>
                Your claim may be weak without the missing evidence listed below.
              </Text>
            </View>
          ) : null}

          <Text style={{ fontSize: 16, marginBottom: 8 }}>
            <Text style={{ fontWeight: "700" }}>Condition:</Text>{" "}
            {structured.condition || "N/A"}
          </Text>

          <Text style={{ fontSize: 16, marginBottom: 8 }}>
            <Text style={{ fontWeight: "700" }}>Diagnostic Code:</Text>{" "}
            {structured.diagnosticCode || "N/A"}
          </Text>

          <Text style={{ fontSize: 16, marginBottom: 8 }}>
            <Text style={{ fontWeight: "700" }}>Estimated Rating:</Text>{" "}
            {structured.estimatedRating || result.likelihood || "N/A"}
          </Text>

          <Text style={{ fontSize: 16, marginBottom: 12 }}>
            <Text style={{ fontWeight: "700" }}>Confidence:</Text>{" "}
            <Text style={{ color: confidenceColor, fontWeight: "700" }}>
              {confidenceValue}
            </Text>
          </Text>

          <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 8 }}>
            Reasoning
          </Text>
          {reasoningItems.length ? (
            reasoningItems.map((item, i) => (
              <Text key={i} style={{ fontSize: 15, marginBottom: 6 }}>
                • {item}
              </Text>
            ))
          ) : (
            <Text style={{ fontSize: 15, marginBottom: 12 }}>
              {structured.reasoning || "N/A"}
            </Text>
          )}

          <Text style={{ fontSize: 18, fontWeight: "700", marginTop: 12, marginBottom: 8 }}>
            Evidence Still Needed
          </Text>
          {evidenceItems.length ? (
            evidenceItems.map((item, i) => (
              <Text key={i} style={{ fontSize: 15, marginBottom: 6 }}>
                • {item}
              </Text>
            ))
          ) : (
            <Text style={{ fontSize: 15, marginBottom: 12 }}>
              {structured.evidenceNeeded || "N/A"}
            </Text>
          )}

          <Text style={{ fontSize: 18, fontWeight: "700", marginTop: 12, marginBottom: 8 }}>
            Next Steps
          </Text>
          <Text style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
            Focus here first to improve the claim.
          </Text>
          {nextStepItems.length ? (
            nextStepItems.map((item, i) => (
              <Text key={i} style={{ fontSize: 15, marginBottom: 6 }}>
                • {item}
              </Text>
            ))
          ) : (
            <Text style={{ fontSize: 15, marginBottom: 12 }}>
              {structured.nextSteps || "N/A"}
            </Text>
          )}

          <Text style={{ fontSize: 18, fontWeight: "700", marginTop: 12, marginBottom: 8 }}>
            Important
          </Text>
          {importantItems.length ? (
            importantItems.map((item, i) => (
              <Text key={i} style={{ fontSize: 15, marginBottom: 6 }}>
                • {item}
              </Text>
            ))
          ) : (
            <Text style={{ fontSize: 15, marginBottom: 12 }}>
              {structured.important || "N/A"}
            </Text>
          )}

          <View
            style={{
              backgroundColor: "#fff7ed",
              borderColor: "#fdba74",
              borderWidth: 1,
              borderRadius: 12,
              padding: 12,
              marginTop: 16,
            }}
          >
            <Text style={{ fontSize: 14, color: "#9a3412", fontWeight: "700", marginBottom: 6 }}>
              Disclaimer
            </Text>
            <Text style={{ fontSize: 14, color: "#7c2d12" }}>
              {result.disclaimer || "This tool provides an estimate only. Final determinations are made by the VA."}
            </Text>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
