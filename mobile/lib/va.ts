const API_BASE_URL = "https://buildtrace-va.onrender.com";

export async function submitVaAnalysis(formData: FormData) {
  const response = await fetch(`${API_BASE_URL}/va/analyze`, {
    method: "POST",
    body: formData,
  });

  const text = await response.text();

  try {
    return {
      ok: response.ok,
      status: response.status,
      data: JSON.parse(text),
    };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      data: { error: text || "Invalid server response" },
    };
  }
}