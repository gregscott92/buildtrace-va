export type AppSessionState = {
  userId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  role: string | null;
};

let appSession: AppSessionState = {
  userId: null,
  organizationId: null,
  organizationName: null,
  role: null,
};

export function getAppSession(): AppSessionState {
  return appSession;
}

export function setAppSession(params: {
  userId: string;
  organizationId: string;
  organizationName: string;
  role: string;
}) {
  appSession = {
    userId: params.userId,
    organizationId: params.organizationId,
    organizationName: params.organizationName,
    role: params.role,
  };
}

export function clearAppSession() {
  appSession = {
    userId: null,
    organizationId: null,
    organizationName: null,
    role: null,
  };
}