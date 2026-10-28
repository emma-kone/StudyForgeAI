"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";
import { api } from "@/lib/client-api";
import LoginView from "@/components/studyforge/LoginView";
import DashboardView from "@/components/studyforge/DashboardView";
import LibraryView from "@/components/studyforge/LibraryView";
import GenerateView from "@/components/studyforge/GenerateView";
import SessionView from "@/components/studyforge/SessionView";
import CodeLabView from "@/components/studyforge/CodeLabView";
import SqlLabView from "@/components/studyforge/SqlLabView";
import ProgressView from "@/components/studyforge/ProgressView";
import SettingsView from "@/components/studyforge/SettingsView";
import { BookOpen, Home, FilePlus2, PenLine, Terminal, Database, TrendingUp, Settings, LogOut, GraduationCap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV: { id: ReturnType<typeof useAppStore.getState>["view"]; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Tableau de bord", icon: Home },
  { id: "library", label: "Bibliothèque", icon: BookOpen },
  { id: "generate", label: "Générer des exercices", icon: FilePlus2 },
  { id: "code", label: "Éditeur de code", icon: Terminal },
  { id: "sql", label: "Laboratoire SQL", icon: Database },
  { id: "progress", label: "Progression", icon: TrendingUp },
  { id: "settings", label: "Réglages", icon: Settings },
];

export default function AppShell() {
  const { authenticated, user, view, setAuthenticated, setView, openSession, activeSessionId, closeSession } = useAppStore();

  useEffect(() => {
    api
      .get<{ authenticated: boolean; user?: { id: string; email: string; name: string | null } }>("/api/auth/login")
      .then((res) => setAuthenticated(res.authenticated, res.user ?? null))
      .catch(() => setAuthenticated(false));
  }, [setAuthenticated]);

  async function logout() {
    await api.post("/api/auth/logout");
    setAuthenticated(false, null);
    setView("dashboard");
  }

  if (authenticated === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        <p className="typo-subtitle">Chargement de StudyForge AI…</p>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginView />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex flex-1">
        {/* ── Barre latérale ── */}
        <aside
          className="hidden md:flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground sticky top-0 h-screen"
          aria-label="Navigation principale"
        >
          <div className="flex items-center gap-2.5 px-5 py-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <p className="typo-h3 leading-tight">StudyForge AI</p>
              <p className="typo-meta">Apprentissage assisté par IA</p>
            </div>
          </div>
          <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = view === item.id || (view === "session" && item.id === "generate");
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active ? "bg-primary text-primary-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="border-t px-4 py-3">
            <p className="typo-meta truncate">{user?.email}</p>
            <Button variant="ghost" size="sm" onClick={logout} className="mt-1 w-full justify-start gap-2 text-muted-foreground">
              <LogOut className="h-4 w-4" aria-hidden /> Se déconnecter
            </Button>
          </div>
        </aside>

        {/* ── Zone principale ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Navigation mobile */}
          <header className="md:hidden sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5" aria-hidden />
                <span className="font-semibold">StudyForge AI</span>
              </div>
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <nav className="flex gap-1 overflow-x-auto px-2 pb-2" aria-label="Navigation mobile">
              {NAV.map((item) => {
                const Icon = item.icon;
                const active = view === item.id || (view === "session" && item.id === "generate");
                return (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden /> {item.label}
                  </button>
                );
              })}
            </nav>
          </header>

          <main className="flex-1 min-w-0">
            {view === "dashboard" && <DashboardView />}
            {view === "library" && <LibraryView />}
            {view === "generate" && <GenerateView onSessionCreated={openSession} />}
            {view === "session" && activeSessionId && <SessionView sessionId={activeSessionId} onExit={closeSession} />}
            {view === "code" && <CodeLabView />}
            {view === "sql" && <SqlLabView />}
            {view === "progress" && <ProgressView onGenerateRevision={(exerciseId, sessionId) => openSession(sessionId)} />}
            {view === "settings" && <SettingsView />}
          </main>

          {/* ── Pied de page collant ── */}
          <footer className="mt-auto border-t bg-muted/40">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-1 px-6 py-3">
              <p className="typo-meta">
                StudyForge AI — plateforme personnelle d&apos;apprentissage assistée par IA
              </p>
              <p className="typo-meta">Police : Bricolage Grotesque · Code : JetBrains Mono</p>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
