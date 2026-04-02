import { useMemo, useState } from "react";
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
  if (Array.isArray(value)) {
    return value.map((x) => String(x).trim()).filter(Boolean);
  }

  return String(value)
    .split(/\n+|•|\-\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.toLowerCase() !== "n/a");
}

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
        Alert.alert("Analysis failed", data?.error || "Server error");
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

  const condition = structured.condition || "N/A";
  const diagnosticCode = structured.diagnosticCode || "N/A";
  const estimatedRating =
    structured.estimatedRating || result?.likelihood || "N/A";
  const confidence = structured.confidence || "N/A";
  const reasoning = structured.reasoning || "N/A";
  const evidenceNeeded = structured.evidenceNeeded || "N/A";
  const nextSteps = structured.nextSteps || "N/A";
  const important = structured.important || "N/A";

  const reasoningItems = bulletize(reasoning);
  const evidenceItems = bulletize(evidenceNeeded);
  const nextStepItems = bulletize(nextSteps);
  const importantItems = bulletize(important);

  const confidenceColor = useMemo(() => {
    const v = String(confidence || "").toLowerCase();
    if (v === "high") return "#15803d";
    if (v === "medium") return "#b45309";
    if (v === "low") return "#b91c1c";
    return "#111827";
  }, [confidence]);

  const hasEvidenceGap =
    evidenceItems.length > 0 ||
    (typeof evidenceNeeded === "string" &&
      evidenceNeeded.trim() &&
      evidenceNeeded.trim().toLowerCase() !== "n/a");

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

          {hasEvidenceGap && (
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
          )}

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
            {condition}
          </Text>

          <Text style={{ fontSize: 16, marginBottom: 8 }}>
            <Text style={{ fontWeight: "700" }}>Diagnostic Code:</Text>{" "}
            {diagnosticCode}
          </Text>

          <Text style={{ fontSize: 16, marginBottom: 8 }}>
            <Text style={{ fontWeight: "700" }}>Estimated Rating:</Text>{" "}
            {estimatedRating}
          </Text>

          <Text style={{ fontSize: 16, marginBottom: 12 }}>
            <Text style={{ fontWeight: "700" }}>Confidence:</Text>{" "}
            <Text style={{ color: confidenceColor, fontWeight: "700" }}>
              {confidence}
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
            <Text style={{ fontSize: 15, marginBottom: 12 }}>{reasoning}</Text>
          )}

          <Text
            style={{
              fontSize: 18,
              fontWeight: "700",
              marginTop: 12,
              marginBottom: 8,
            }}
          >
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
              {evidenceNeeded}
            </Text>
          )}

          <Text
            style={{
              fontSize: 18,
              fontWeight: "700",
              marginTop: 12,
              marginBottom: 8,
            }}
          >
            Next Steps
          </Text>
          <Text
            style={{
              fontSize: 13,
              color: "#6b7280",
              marginBottom: 8,
            }}
          >
            Focus here first to improve the claim.
          </Text>
          {nextStepItems.length ? (
            nextStepItems.map((item, i) => (
              <Text key={i} style={{ fontSize: 15, marginBottom: 6 }}>
                • {item}
              </Text>
            ))
          ) : (
            <Text style={{ fontSize: 15, marginBottom: 12 }}>{nextSteps}</Text>
          )}

          <Text
            style={{
              fontSize: 18,
              fontWeight: "700",
              marginTop: 12,
              marginBottom: 8,
            }}
          >
            Important
          </Text>
          {importantItems.length ? (
            importantItems.map((item, i) => (
              <Text key={i} style={{ fontSize: 15, marginBottom: 6 }}>
                • {item}
              </Text>
            ))
          ) : (
            <Text style={{ fontSize: 15, marginBottom: 12 }}>{important}</Text>
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
            <Text
              style={{
                fontSize: 14,
                color: "#9a3412",
                fontWeight: "700",
                marginBottom: 6,
              }}
            >
              Disclaimer
            </Text>
            <Text style={{ fontSize: 14, color: "#7c2d12" }}>
              {result?.disclaimer ||
                "This tool provides an estimate only. Final determinations are made by the VA."}
            </Text>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
