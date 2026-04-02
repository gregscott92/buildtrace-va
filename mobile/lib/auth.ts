import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// SIGN UP
export async function signUpWithEmail(email: string, password: string) {
  return await supabase.auth.signUp({
    email,
    password,
  });
}

// LOGIN
export async function signInWithEmail(email: string, password: string) {
  return await supabase.auth.signInWithPassword({
    email,
    password,
  });
}

// LOGOUT
export async function signOutUser() {
  return await supabase.auth.signOut();
}

// GET SESSION
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();

  return {
    session: data?.session ?? null,
    error,
  };
}