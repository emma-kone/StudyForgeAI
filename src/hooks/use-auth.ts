"use client";

import { useEffect } from "react";
import { api } from "@/lib/client-api";
import { useAppStore } from "@/store/app-store";

export function useAuth() {
  const authenticated = useAppStore((s) => s.authenticated);
  const user = useAppStore((s) => s.user);
  const setAuthenticated = useAppStore((s) => s.setAuthenticated);

  useEffect(() => {
    api
      .get<{ authenticated: boolean; user?: { id: string; email: string; name: string | null } }>(
        "/api/auth/login",
      )
      .then((res) => setAuthenticated(res.authenticated, res.user ?? null))
      .catch(() => setAuthenticated(false));
  }, [setAuthenticated]);

  return { authenticated, user, setAuthenticated };
}
