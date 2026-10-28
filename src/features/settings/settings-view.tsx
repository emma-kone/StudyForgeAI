"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SettingsView — Réglages de StudyForge AI.
// - Apparence : thème clair / sombre / système. Aucun ThemeProvider n'existe
//   dans ce projet : la classe "dark" est appliquée manuellement sur <html>
//   (au montage après chargement, puis à chaque changement).
// - Exercices : mode par défaut et indices pendant les sessions.
// - Import : taille maximale par fichier (1–50 Mo).
// - Compte : informations en lecture seule (e-mail, nom, identifiant, modèle
//   IA, langue, conservation des données).
// - Charte typographique : spécimens Bricolage Grotesque + JetBrains Mono.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Loader2, Palette, PenLine, Type, Upload, User, XCircle } from "lucide-react";

// ── Types de l'API ───────────────────────────────────────────────────────────

type ThemeChoice = "light" | "dark" | "system";

interface AppSettings {
  theme: string;
  defaultMode: string;
  maxUploadMB: number;
  hintsEnabled: boolean;
  aiModel: string;
  exerciseLang: string;
  retentionDays: number;
}

interface AppUser {
  id: string;
  email: string;
  name: string | null;
}

interface SettingsResponse {
  settings: AppSettings;
  user: AppUser;
}

// ── Constantes ───────────────────────────────────────────────────────────────

interface ModeOption {
  value: string;
  label: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: "apprentissage", label: "Apprentissage" },
  { value: "entrainement", label: "Entraînement" },
  { value: "examen", label: "Examen" },
  { value: "revision", label: "Révision ciblée" },
  { value: "personnalise", label: "Personnalisé" },
];

const WEIGHT_SPECIMENS: { weight: number; className: string }[] = [
  { weight: 200, className: "font-extralight text-lg" },
  { weight: 400, className: "font-normal text-lg" },
  { weight: 500, className: "font-medium text-lg" },
  { weight: 600, className: "font-semibold text-lg" },
  { weight: 700, className: "font-bold text-lg" },
  { weight: 800, className: "font-extrabold text-lg" },
];

const TYPE_SPECIMEN = "StudyForge AI — typographie expressive et lisible";

const CODE_SPECIMEN = "const mastery = 0.87; // JetBrains Mono — réservée au code et à la console";

// ── Utilitaires ──────────────────────────────────────────────────────────────

function isThemeChoice(value: string): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

/** Applique manuellement le thème : classe "dark" sur <html> (pas de ThemeProvider). */
function applyThemeClass(theme: string): void {
  if (typeof window === "undefined") return;
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Ligne d'information lisible (dl/dt/dd) des cartes en lecture seule. */
function InfoRow({
  label,
  value,
  tnum = false,
  mono = false,
  truncate = false,
}: {
  label: string;
  value: string;
  tnum?: boolean;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1.5">
      <dt className="typo-meta shrink-0">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-right text-sm font-medium",
          tnum && "tnum",
          mono && "font-code",
          truncate && "truncate",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// ── Vue principale ───────────────────────────────────────────────────────────

export default function SettingsView() {
  const { toast } = useToast();

  // ── Chargement ──
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Réglages modifiables (état local optimiste) ──
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [defaultMode, setDefaultMode] = useState("apprentissage");
  const [hintsEnabled, setHintsEnabled] = useState(true);
  const [maxUploadInput, setMaxUploadInput] = useState("10");
  const [savedMaxUploadMB, setSavedMaxUploadMB] = useState<number | null>(null);

  // ── Données en lecture seule ──
  const [user, setUser] = useState<AppUser | null>(null);
  const [info, setInfo] = useState<{
    aiModel: string;
    exerciseLang: string;
    retentionDays: number;
  } | null>(null);

  // ── États de sauvegarde ──
  const [savingTheme, setSavingTheme] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [savingHints, setSavingHints] = useState(false);
  const [savingMaxUpload, setSavingMaxUpload] = useState(false);

  // Chargement initial + application du thème au montage
  useEffect(() => {
    let cancelled = false;
    api
      .get<SettingsResponse>("/api/settings")
      .then((res) => {
        if (cancelled) return;
        const settings = res.settings;
        setTheme(isThemeChoice(settings.theme) ? settings.theme : "system");
        setDefaultMode(settings.defaultMode);
        setHintsEnabled(settings.hintsEnabled);
        setMaxUploadInput(String(settings.maxUploadMB));
        setSavedMaxUploadMB(settings.maxUploadMB);
        setInfo({
          aiModel: settings.aiModel,
          exerciseLang: settings.exerciseLang,
          retentionDays: settings.retentionDays,
        });
        setUser(res.user);
        applyThemeClass(settings.theme);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(errorMessage(err, "Impossible de charger les réglages."));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Thème « système » : suivi des préférences du système d'exploitation
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeClass("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  // Options de mode : valeur inconnue du serveur ajoutée défensivement
  const modeOptions: ModeOption[] =
    defaultMode === "" || MODE_OPTIONS.some((m) => m.value === defaultMode)
      ? MODE_OPTIONS
      : [...MODE_OPTIONS, { value: defaultMode, label: defaultMode }];

  // ── Thème ──
  const handleThemeChange = useCallback(
    async (value: string) => {
      if (!isThemeChoice(value) || savingTheme) return;
      const previous = theme;
      setTheme(value);
      applyThemeClass(value);
      setSavingTheme(true);
      try {
        await api.put<{ settings: AppSettings }>("/api/settings", { theme: value });
        toast({ title: "Réglages enregistrés", description: "Le thème a été appliqué." });
      } catch (err: unknown) {
        setTheme(previous);
        applyThemeClass(previous);
        toast({
          title: "Enregistrement impossible",
          description: errorMessage(err, "Le thème n'a pas pu être enregistré."),
          variant: "destructive",
        });
      } finally {
        setSavingTheme(false);
      }
    },
    [theme, savingTheme, toast],
  );

  // ── Mode d'exercice par défaut ──
  const handleModeChange = useCallback(
    async (value: string) => {
      if (savingMode || value === defaultMode) return;
      const previous = defaultMode;
      setDefaultMode(value);
      setSavingMode(true);
      try {
        await api.put<{ settings: AppSettings }>("/api/settings", { defaultMode: value });
        toast({
          title: "Réglages enregistrés",
          description: "Le mode d'exercice par défaut a été mis à jour.",
        });
      } catch (err: unknown) {
        setDefaultMode(previous);
        toast({
          title: "Enregistrement impossible",
          description: errorMessage(err, "Le mode par défaut n'a pas pu être enregistré."),
          variant: "destructive",
        });
      } finally {
        setSavingMode(false);
      }
    },
    [defaultMode, savingMode, toast],
  );

  // ── Indices pendant les sessions ──
  const handleHintsChange = useCallback(
    async (checked: boolean) => {
      if (savingHints) return;
      const previous = hintsEnabled;
      setHintsEnabled(checked);
      setSavingHints(true);
      try {
        await api.put<{ settings: AppSettings }>("/api/settings", { hintsEnabled: checked });
        toast({
          title: "Réglages enregistrés",
          description: checked
            ? "Les indices seront disponibles pendant les sessions."
            : "Les indices seront masqués pendant les sessions.",
        });
      } catch (err: unknown) {
        setHintsEnabled(previous);
        toast({
          title: "Enregistrement impossible",
          description: errorMessage(err, "La préférence d'indices n'a pas pu être enregistrée."),
          variant: "destructive",
        });
      } finally {
        setSavingHints(false);
      }
    },
    [hintsEnabled, savingHints, toast],
  );

  // ── Taille maximale d'import ──
  const parsedMaxUpload = Number.parseInt(maxUploadInput, 10);
  const maxUploadValid =
    Number.isFinite(parsedMaxUpload) && parsedMaxUpload >= 1 && parsedMaxUpload <= 50;
  const maxUploadDirty = savedMaxUploadMB !== null && parsedMaxUpload !== savedMaxUploadMB;

  const handleSaveMaxUpload = useCallback(async () => {
    if (savingMaxUpload || !maxUploadValid) return;
    const previous = savedMaxUploadMB;
    setSavingMaxUpload(true);
    try {
      const res = await api.put<{ settings: AppSettings }>("/api/settings", {
        maxUploadMB: parsedMaxUpload,
      });
      setSavedMaxUploadMB(res.settings.maxUploadMB);
      setMaxUploadInput(String(res.settings.maxUploadMB));
      toast({
        title: "Réglages enregistrés",
        description: `Taille maximale : ${res.settings.maxUploadMB} Mo par fichier.`,
      });
    } catch (err: unknown) {
      if (previous !== null) {
        setSavedMaxUploadMB(previous);
        setMaxUploadInput(String(previous));
      }
      toast({
        title: "Enregistrement impossible",
        description: errorMessage(err, "La taille maximale n'a pas pu être enregistrée."),
        variant: "destructive",
      });
    } finally {
      setSavingMaxUpload(false);
    }
  }, [savingMaxUpload, maxUploadValid, parsedMaxUpload, savedMaxUploadMB, toast]);

  // ── Rendu ──
  return (
    <section
      aria-labelledby="settings-title"
      className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6 lg:py-8"
    >
      {/* ── En-tête ── */}
      <header>
        <h1 id="settings-title" className="typo-h1">
          Réglages
        </h1>
        <p className="typo-subtitle mt-1 max-w-2xl">
          Personnalisez l&apos;application selon vos préférences.
        </p>
      </header>

      {loadError && (
        <Alert variant="destructive">
          <XCircle aria-hidden />
          <AlertTitle>Chargement impossible</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {/* ── Apparence ── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="typo-h2 flex items-center gap-2">
            <Palette className="h-4 w-4 text-muted-foreground" aria-hidden />
            Apparence
          </CardTitle>
          <CardDescription>Choisissez l&apos;ambiance de l&apos;interface.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-9 w-56" aria-hidden />
          ) : (
            <div className="w-full max-w-xs space-y-1.5">
              <Label htmlFor="settings-theme">Thème</Label>
              <Select value={theme} onValueChange={(value) => void handleThemeChange(value)}>
                <SelectTrigger id="settings-theme" className="w-full" aria-label="Choisir le thème">
                  <SelectValue placeholder="Choisir un thème" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">Système</SelectItem>
                  <SelectItem value="light">Clair</SelectItem>
                  <SelectItem value="dark">Sombre</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Exercices ── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="typo-h2 flex items-center gap-2">
            <PenLine className="h-4 w-4 text-muted-foreground" aria-hidden />
            Exercices
          </CardTitle>
          <CardDescription>Mode par défaut et aides pendant les sessions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <Skeleton className="h-9 w-56" aria-hidden />
          ) : (
            <div className="w-full max-w-xs space-y-1.5">
              <Label htmlFor="settings-mode">Mode d&apos;exercice par défaut</Label>
              <Select
                value={defaultMode === "" ? undefined : defaultMode}
                onValueChange={(value) => void handleModeChange(value)}
              >
                <SelectTrigger id="settings-mode" className="w-full" aria-label="Choisir le mode par défaut">
                  <SelectValue placeholder="Choisir un mode" />
                </SelectTrigger>
                <SelectContent>
                  {modeOptions.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {loading ? (
            <Skeleton className="h-14 w-full max-w-md" aria-hidden />
          ) : (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="min-w-0">
                <Label htmlFor="settings-hints" className="text-sm font-medium">
                  Indices disponibles pendant les sessions
                </Label>
                <p className="typo-meta mt-0.5">
                  Affiche des aides progressives pour chaque question d&apos;exercice.
                </p>
              </div>
              <Switch
                id="settings-hints"
                checked={hintsEnabled}
                onCheckedChange={(checked) => void handleHintsChange(checked)}
                disabled={savingHints}
                aria-label="Indices disponibles pendant les sessions"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Import des documents ── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="typo-h2 flex items-center gap-2">
            <Upload className="h-4 w-4 text-muted-foreground" aria-hidden />
            Import des documents
          </CardTitle>
          <CardDescription>Limite de taille appliquée à chaque fichier importé.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <Skeleton className="h-9 w-56" aria-hidden />
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="w-full max-w-[10rem] space-y-1.5">
                <Label htmlFor="settings-max-upload">Taille maximale (Mo)</Label>
                <Input
                  id="settings-max-upload"
                  type="number"
                  min={1}
                  max={50}
                  value={maxUploadInput}
                  onChange={(e) => setMaxUploadInput(e.target.value)}
                  disabled={savingMaxUpload}
                  className="tnum"
                />
              </div>
              <Button
                onClick={() => void handleSaveMaxUpload()}
                disabled={savingMaxUpload || !maxUploadDirty || !maxUploadValid}
              >
                {savingMaxUpload && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Enregistrer
              </Button>
            </div>
          )}
          {!loading && !maxUploadValid && (
            <p className="typo-meta text-destructive">Saisissez une valeur entière entre 1 et 50.</p>
          )}
          <p className="typo-meta">
            Taille maximale acceptée pour chaque fichier importé (1–50 Mo).
          </p>
        </CardContent>
      </Card>

      {/* ── Compte ── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="typo-h2 flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" aria-hidden />
            Compte
          </CardTitle>
          <CardDescription>
            Informations du compte et paramètres de plateforme (lecture seule).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading || user === null || info === null ? (
            <div className="space-y-2" aria-hidden>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (
            <dl className="space-y-1.5">
              <InfoRow label="Adresse e-mail" value={user.email} />
              <InfoRow label="Nom" value={user.name ?? "—"} />
              <InfoRow label="Identifiant" value={user.id} mono truncate />
              <Separator className="my-3" />
              <InfoRow label="Modèle IA" value={info.aiModel} />
              <InfoRow
                label="Langue des exercices"
                value={info.exerciseLang === "fr" ? "Français" : info.exerciseLang}
              />
              <InfoRow
                label="Conservation des données"
                value={info.retentionDays === 0 ? "Illimitée" : `${info.retentionDays} jours`}
                tnum
              />
            </dl>
          )}
        </CardContent>
      </Card>

      {/* ── Charte typographique ── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="typo-h2 flex items-center gap-2">
            <Type className="h-4 w-4 text-muted-foreground" aria-hidden />
            Charte typographique
          </CardTitle>
          <CardDescription>
            Spécimens des polices utilisées dans l&apos;interface.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="typo-meta">
            Police principale de l&apos;interface : Bricolage Grotesque. Police de code : JetBrains
            Mono (éditeurs, console, SQL).
          </p>
          <div className="space-y-3">
            {WEIGHT_SPECIMENS.map((specimen) => (
              <div
                key={specimen.weight}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5"
              >
                <p className={cn(specimen.className, "min-w-0 truncate")}>{TYPE_SPECIMEN}</p>
                <span className="typo-meta tnum shrink-0">
                  Bricolage Grotesque — {specimen.weight}
                </span>
              </div>
            ))}
          </div>
          <Separator />
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            <p className="font-code min-w-0 truncate text-sm">{CODE_SPECIMEN}</p>
            <span className="typo-meta tnum shrink-0">JetBrains Mono — 400</span>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
