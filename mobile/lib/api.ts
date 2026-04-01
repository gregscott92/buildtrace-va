import { supabase } from "./supabase";

const API_BASE_URL = "https://buildtrace-va.onrender.com";

export async function runBuildTrace(input: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const token = session?.access_token;

  const response = await fetch(`${API_BASE_URL}/api/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ input }),
  });

  const text = await response.text();

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      data?.details ||
        data?.error ||
        data?.message ||
        data?.raw ||
        `Request failed with status ${response.status}`
    );
  }

  return data;
}
