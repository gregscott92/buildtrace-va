import { supabase } from "./supabase";

export async function signUpWithEmail(email: string, password: string) {
  const signup = await supabase.auth.signUp({
    email,
    password,
  });

  if (signup.error) {
    return signup;
  }

  // Force a real session immediately after signup
  const signin = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signin.error) {
    // fall back to signup response if signin does not return a session
    return signup;
  }

  return signin;
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  return { data, error };
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  return { data, error };
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  return { data, error };
}
