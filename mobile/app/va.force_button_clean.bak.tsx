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
import * as Clipboard from "expo-clipboard";

function bulletize(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);

  return String(value)
    .split(/\n|•|- /)
    .map((x) => x.trim())
    .filter(Boolean);
}



const handleAnalyze = async () => {
  try {
    console.log("ANALYZE CLICKED");

    setLoading(true);
    setResult(null);

    let imageBase64 = null;

    if (image?.base64) {
      imageBase64 = image.base64;
    } else if (image?.uri) {
      const res = await fetch(image.uri);
      const blob = await res.blob();

      const reader = new FileReader();
      imageBase64 = await new Promise((resolve) => {
        reader.onloadend = () => {
          const base64 = reader.result.split(",")[1];
          resolve(base64);
        };
        reader.readAsDataURL(blob);
      });
    }

    console.log("IMAGE BASE64 LENGTH:", imageBase64?.length);

    const response = await fetch(
      "https://buildtrace-va.onrender.com/va/analyze-base64",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          issue: issue || "",
          serviceContext: serviceContext || "",
          imageBase64,
        }),
      }
    );

    console.log("RESPONSE STATUS:", response.status);

    const data = await response.json();

    console.log("RESPONSE DATA:", data);

    if (!data.success) {
      throw new Error(data.error || "Unknown error");
    }

    setResult(data);
  } catch (err) {
    console.log("ANALYZE ERROR:", err);
  } finally {
    setLoading(false);
  }
};

export default function VaScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState("");
  const [issue, setIssue] = useState("");
  const [serviceContext, setServiceContext] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [debugText, setDebugText] = useState("");
  const [showDebug, setShowDebug] = useState(false);

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
      base64: true,
    });

    if (res.canceled || !res.assets?.length) {
      return;
    }

    const asset = res.assets[0];

    if (!asset?.uri) {
      Alert.alert("Image error", "Selected image did not return a usable URI.");
      return;
    }

    setImageUri(asset.uri);

    if (asset.base64) {
      setImageBase64(`data:image/jpeg;base64,${asset.base64}`);
      setDebugText(
        `Image ready.\nURI: ${asset.uri}\nBase64 length: ${asset.base64.length}`
      );
    } else {
      setImageBase64("");
      setDebugText(
        `Image selected but no base64 returned.\nURI: ${asset.uri}`
      );
    }
  }

  async function handleAnalyze() {
    if (!issue.trim() && !serviceContext.trim() && !imageBase64) {
      Alert.alert("Missing info", "Add a description, service context, or image.");
      return;
    }

    try {
      setLoading(true);
      setResult(null);
      setDebugText("Submitting request...");

      const payload = {
        issue: issue.trim(),
        serviceContext: serviceContext.trim(),
        imageBase64: imageBase64 || "",
      };

      const res = await fetch("https://buildtrace-va.onrender.comva/analyze-base64", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();

      setDebugText(
        `Response status: ${res.status}\n` +
        `Sent imageBase64: ${imageBase64 ? "YES" : "NO"}\n` +
        `Raw: ${text}`
      );

      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text || "Invalid server response" };
      }

      if (!res.ok) {
        Alert.alert(
          "Analysis failed",
          data?.error || data?.details || "Server error"
        );
        return;
      }

      setResult(data);
    } catch (err: any) {
      const msg = err?.message || "Unknown error";
      setDebugText(`Request failed: ${msg}`);
      Alert.alert("Analysis failed", msg);
    } finally {
      setLoading(false);
    }
  }

  const structured = result?.structured || result?.parsed || {};

  async function copySummary() {
    if (!result) return;

    const output = [
      `Condition: ${structured.condition || "N/A"}`,
      `Diagnostic Code: ${structured.diagnosticCode || "N/A"}`,
      `Estimated Rating: ${structured.estimatedRating || result?.likelihood || "N/A"}`,
      `Confidence: ${structured.confidence || "N/A"}`,
      "",
      "Reasoning:",
      structured.reasoning || "N/A",
      "",
      "Evidence Still Needed:",
      structured.evidenceNeeded || "N/A",
      "",
      "Next Steps:",
      structured.nextSteps || "N/A",
      "",
      "Important:",
      structured.important || "N/A",
      "",
      `Disclaimer: ${result?.disclaimer || "This tool provides an estimate only. Final determinations are made by the VA."}`
    ].join("\n");

    await Clipboard.setStringAsync(output);
    Alert.alert("Copied", "Claim summary copied.");
  }

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

      <Pressable onPress={handleAnalyze}
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

      <Pressable onPress={handleAnalyze}
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

          <Pressable onPress={handleAnalyze}
            onPress={copySummary}
            style={{
              backgroundColor: "#0f172a",
              paddingVertical: 12,
              borderRadius: 12,
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
              Copy Summary
            </Text>
          </Pressable>

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
            reasoningItems.map((item: string, i: number) => (
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
            evidenceItems.map((item: string, i: number) => (
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
            nextStepItems.map((item: string, i: number) => (
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
            importantItems.map((item: string, i: number) => (
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
