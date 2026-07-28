"use client";

import { useEffect, useState } from "react";

export type GoogleSessionState = {
  configured: boolean;
  authenticated: boolean;
  user: { email: string; name: string; picture?: string } | null;
};

export function useGoogleSession() {
  const [session, setSession] = useState<GoogleSessionState | null>(null);
  useEffect(() => {
    fetch("/api/auth/google/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((value) => setSession(value as GoogleSessionState))
      .catch(() => setSession({ configured: false, authenticated: false, user: null }));
  }, []);
  return session;
}
