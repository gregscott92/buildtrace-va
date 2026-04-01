import { supabase } from "./supabase";

export type Workspace = {
  organization_id: string;
  organization_name: string;
  role: "owner" | "admin" | "member";
};

function normalizeWorkspace(data: any): Workspace | null {
  if (!data) return null;

  if (Array.isArray(data)) {
    return data[0] ?? null;
  }

  return data as Workspace;
}

export async function getMyWorkspace(): Promise<Workspace | null> {
  const { data, error } = await supabase.rpc("get_my_default_organization");

  if (error) throw error;

  return normalizeWorkspace(data);
}

export async function ensureWorkspace(): Promise<Workspace> {
  let workspace = await getMyWorkspace();

  if (workspace) return workspace;

  const { data, error } = await supabase.rpc("bootstrap_new_user_workspace", {
    workspace_name: "My Workspace",
  });

  if (error) throw error;

  workspace = normalizeWorkspace(data);

  if (!workspace) {
    throw new Error("Workspace bootstrap failed.");
  }

  return workspace;
}