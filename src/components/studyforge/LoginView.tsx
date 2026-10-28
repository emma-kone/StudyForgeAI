"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GraduationCap, Loader2, ShieldCheck, Sparkles } from "lucide-react";

export default function LoginView() {
  const setAuthenticated = useAppStore((s) => s.setAuthenticated);
  const [email, setEmail] = useState("etudiante@studyforge.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ user: { id: string; email: string; name: string | null } }>("/api/auth/login", { email, password });
      setAuthenticated(true, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la connexion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center gap-3 text-center mb-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
              <GraduationCap className="h-7 w-7" aria-hidden />
            </div>
            <h1 className="typo-display">StudyForge AI</h1>
            <p className="typo-subtitle max-w-sm">
              Importez vos cours, générez des exercices personnalisés, codez, pratiquez le SQL et suivez votre progression.
            </p>
          </div>

          <form onSubmit={submit} className="rounded-xl border bg-card p-6 shadow-sm space-y-4" aria-labelledby="login-title">
            <h2 id="login-title" className="typo-h2">
              Connexion
            </h2>
            <div className="space-y-2">
              <Label htmlFor="email">Adresse e-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.fr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
              />
            </div>
            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full gap-2 font-semibold" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
              Se connecter
            </Button>
            <div className="rounded-lg bg-muted px-3 py-2.5">
              <p className="typo-meta leading-relaxed">
                <strong className="font-semibold">Compte personnel fourni :</strong> {`etudiante@studyforge.local`} · mot de passe{" "}
                <code className="font-code rounded bg-background px-1 py-0.5 text-[11px]">studyforge2025</code>
                <br />
                Modifiable dans les réglages une fois connectée.
              </p>
            </div>
          </form>

          <div className="mt-6 flex items-center justify-center gap-2 text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            <p className="typo-meta">Analyse IA · Génération d&apos;exercices · Correction hybride · SQL · Éditeur de code</p>
          </div>
        </div>
      </main>
      <footer className="mt-auto border-t bg-muted/40 px-6 py-3 text-center">
        <p className="typo-meta">StudyForge AI · Plateforme privée · Session sécurisée chiffrée (HMAC-SHA256, httpOnly)</p>
      </footer>
    </div>
  );
}
