"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { useAppStore } from "@/store/app-store";
import { AuthGuard } from "@/components/layout/auth-guard";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { AppFooter } from "@/components/layout/app-footer";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const setAuthenticated = useAppStore((s) => s.setAuthenticated);

  async function logout() {
    await api.post("/api/auth/logout");
    setAuthenticated(false, null);
    router.replace(routes.login);
  }

  return (
    <AuthGuard>
      <div className="min-h-screen flex flex-col bg-background">
        <div className="flex flex-1">
          <SidebarNav user={user} onLogout={logout} />
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileNav onLogout={logout} />
            <main className="flex-1 min-w-0">{children}</main>
            <AppFooter />
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
