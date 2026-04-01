import { supabase } from "./supabase";
import type { Workspace } from "./workspace";

function normalizeWorkspace(data: any): Workspace | null {
  if (!data) return null;

  if (Array.isArray(data)) {
    return data[0] ?? null;
  }

  return data as Workspace;
}

export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) throw error;

  return data.session ?? null;
}

export async function getCurrentUser() {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

export async function signUpWithEmail(
  email: string,
  password: string,
  fullName?: string
) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) throw error;

  const user = data.user;
  if (!user) {
    throw new Error("Signup succeeded but no user returned.");
  }

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email,
    full_name: fullName ?? null,
  });

  if (profileError) {
    console.warn("Profile upsert warning:", profileError.message);
  }

  const { data: workspaceData, error: workspaceError } = await supabase.rpc(
    "bootstrap_new_user_workspace",
    {
      workspace_name: fullName ? `${fullName}'s Workspace` : "My Workspace",
    }
  );

  if (workspaceError) throw workspaceError;

  const workspace = normalizeWorkspace(workspaceData);

  return {
    user,
    workspace,
  };
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;

  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (error) throw error;
}