import { supabase } from "./supabase";
import { ensureWorkspace } from "./workspace";
import { setAppSession, clearAppSession } from "./appSession";

export async function bootstrapAuthenticatedUser() {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) throw sessionError;

  if (!session?.user) {
    clearAppSession();

    return {
      isAuthenticated: false,
      user: null,
      workspace: null,
    };
  }

  const workspace = await ensureWorkspace();

  setAppSession({
    userId: session.user.id,
    organizationId: workspace.organization_id,
    organizationName: workspace.organization_name,
    role: workspace.role,
  });

  return {
    isAuthenticated: true,
    user: session.user,
    workspace,
  };
}