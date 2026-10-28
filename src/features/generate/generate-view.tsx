"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/app-store";
import { QUESTION_TYPES, QUESTION_TYPE_LABELS, MODE_LABELS } from "@/lib/types";
import type { Difficulty, QuestionType, SessionMode } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BookOpen, FileX, History, Loader2, Play, Sparkles, TriangleAlert, X } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types locaux
// ─────────────────────────────────────────────────────────────────────────────

interface SubjectDto {
  id: string;
  name: string;
  color: string;
  chapters: { id: string; name: string }[];
  _count: { documents: number };
}

interface DocumentDto {
  id: string;
  name: string;
  type: string;
  status: string;
  subjectId: string | null;
  chapterId: string | null;
  subject: { name: string; color: string } | null;
  chapter: { name: string } | null;
}

interface HistoryExerciseDto {
  id: string;
  title: string;
  subject: { name: string; color: string } | null;
  config: { difficulty?: Difficulty; mode?: SessionMode; themes?: string[] };
  questionCount: number;
  status: string;
  createdAt: string;
}

interface ConfigState {
  subjectId: string; // "all" = toutes les matières
  difficulty: Difficulty;
  questionCount: number;
  mode: SessionMode;
  durationMin?: number;
  pointsPerQuestion: number;
  theoryPracticeMix: number; // 0..100 % théorie
  hintsEnabled: boolean;
  correctionTiming: "immediate" | "end";
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

const ALL_SUBJECT = "all";
const MAX_THEMES = 10;
const MAX_QUESTIONS = 20;

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: "decouverte", label: "Découverte" },
  { value: "facile", label: "Facile" },
  { value: "moyen", label: "Moyen (défaut)" },
  { value: "difficile", label: "Difficile" },
  { value: "expert", label: "Expert" },
];

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  decouverte: "Découverte",
  facile: "Facile",
  moyen: "Moyen",
  difficile: "Difficile",
  expert: "Expert",
};

const TYPE_PRESETS: { label: string; types: QuestionType[] }[] = [
  { label: "QCM & Vrai/Faux", types: ["qcm_single", "qcm_multiple", "true_false"] },
  { label: "Code", types: ["error_identification", "code_output", "code_write", "code_fix", "debug"] },
  { label: "SQL", types: ["sql_query", "sql_create_table", "sql_database"] },
  {
    label: "Réflexion",
    types: [
      "matching",
      "ordering",
      "fill_blank",
      "short_answer",
      "open_question",
      "data_modeling",
      "case_study",
      "combined",
      "exam_composite",
    ],
  },
  { label: "Tout", types: [...QUESTION_TYPES] },
];

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Date inconnue" : dateFormat.format(date);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue « Générer des exercices »
// ─────────────────────────────────────────────────────────────────────────────

export default function GenerateView() {
  const { toast } = useToast();
  const router = useRouter();

  // Données distantes
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<SubjectDto[]>([]);
  const [allDocuments, setAllDocuments] = useState<DocumentDto[]>([]);
  const [history, setHistory] = useState<HistoryExerciseDto[]>([]);

  // Configuration PERSISTÉE (zustand + localStorage) : changer de vue ne
  // réinitialise plus la sélection en cours.
  const config = useAppStore((s) => s.generateConfig);
  const setConfig = useAppStore((s) => s.setGenerateConfig);
  const documentIds = useAppStore((s) => s.generateDocumentIds);
  const setDocumentIds = useAppStore((s) => s.setGenerateDocumentIds);
  const types = useAppStore((s) => s.generateTypes) as QuestionType[];
  const setTypes = useAppStore((s) => s.setGenerateTypes);
  const themes = useAppStore((s) => s.generateThemes);
  const setThemes = useAppStore((s) => s.setGenerateThemes);
  const [themeInput, setThemeInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);

  // Chargement initial (matières + documents + historique)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api.get<{ subjects: SubjectDto[] }>("/api/subjects"),
      api.get<{ documents: DocumentDto[] }>("/api/documents"),
      api.get<{ exercises: HistoryExerciseDto[] }>("/api/exercises/list"),
    ])
      .then(([subjectsRes, documentsRes, historyRes]) => {
        if (cancelled) return;
        setSubjects(subjectsRes.subjects);
        setAllDocuments(documentsRes.documents);
        setHistory(historyRes.exercises);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Impossible de charger les matières, documents et exercices."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Données dérivées
  const readyDocuments = useMemo(() => allDocuments.filter((d) => d.status === "READY"), [allDocuments]);
  const selectedSubject =
    config.subjectId === ALL_SUBJECT ? null : (subjects.find((s) => s.id === config.subjectId) ?? null);
  const visibleDocuments = useMemo(
    () =>
      readyDocuments.filter((d) => {
        // Filtre par IDENTIFIANTS (jamais par nom de matière) + périmètre chapitre
        if (selectedSubject && d.subjectId !== selectedSubject.id) return false;
        if (config.chapterId && d.chapterId !== config.chapterId) return false;
        return true;
      }),
    [readyDocuments, selectedSubject, config.chapterId]
  );

  const missingHint =
    documentIds.length === 0
      ? "Sélectionnez au moins un document"
      : types.length === 0
        ? "Choisissez au moins un type d’exercice"
        : null;
  const canSubmit = missingHint === null && !generating;

  // ── Handlers ──

  function updateConfig(patch: Partial<ConfigState>) {
    setConfig(patch);
  }

  /** Changement de matière : réinitialise le chapitre et purge les documents
   *  sélectionnés qui n'appartiennent pas à la nouvelle matière. */
  function changeSubject(newSubjectId: string) {
    setConfig({ subjectId: newSubjectId, chapterId: null });
    if (newSubjectId !== ALL_SUBJECT) {
      setDocumentIds(documentIds.filter((id) => allDocuments.find((d) => d.id === id)?.subjectId === newSubjectId));
    }
  }

  function changeChapter(newChapterId: string | null) {
    setConfig({ chapterId: newChapterId });
    if (newChapterId) {
      setDocumentIds(documentIds.filter((id) => allDocuments.find((d) => d.id === id)?.chapterId === newChapterId));
    }
  }

  function toggleDocument(id: string, checked: boolean) {
    setDocumentIds(checked ? (documentIds.includes(id) ? documentIds : [...documentIds, id]) : documentIds.filter((docId) => docId !== id));
  }

  function toggleType(type: QuestionType, checked: boolean) {
    setTypes(checked ? (types.includes(type) ? types : [...types, type]) : types.filter((t) => t !== type));
  }

  function selectAllVisible() {
    setDocumentIds(Array.from(new Set([...documentIds, ...visibleDocuments.map((d) => d.id)])));
  }

  function addTheme() {
    const trimmed = themeInput.trim();
    if (!trimmed) return;
    if (themes.length >= MAX_THEMES) {
      toast({ title: "Limite atteinte", description: `Maximum ${MAX_THEMES} notions ciblées.` });
      return;
    }
    if (!themes.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setThemes([...themes, trimmed]);
    }
    setThemeInput("");
  }

  function removeTheme(theme: string) {
    setThemes(themes.filter((t) => t !== theme));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (documentIds.length === 0 || types.length === 0 || generating) return;
    setGenerating(true);
    try {
      const exercise = await api.post<{ ok: boolean; exerciseId: string; questionCount: number }>("/api/exercises", {
        subjectId: config.subjectId === ALL_SUBJECT ? undefined : config.subjectId,
        chapterId: config.chapterId ?? undefined,
        documentIds,
        themes,
        difficulty: config.difficulty,
        questionCount: config.questionCount,
        types,
        mode: config.mode,
        durationMin: config.mode === "examen" ? config.durationMin : undefined,
        pointsPerQuestion: config.pointsPerQuestion,
        theoryPracticeMix: config.theoryPracticeMix,
        hintsEnabled: config.hintsEnabled,
        correctionTiming: config.correctionTiming,
      });
      const session = await api.post<{ ok: boolean; sessionId: string }>("/api/sessions", {
        exerciseId: exercise.exerciseId,
        mode: config.mode,
      });
      toast({
        title: "Exercices générés",
        description: `${exercise.questionCount} question(s) prête(s).`,
      });
      router.push(routes.session(session.sessionId));
    } catch (err) {
      toast({
        title: "Échec de la génération",
        description: err instanceof Error ? err.message : "Une erreur inattendue est survenue.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }

  async function startExercise(exerciseId: string, mode: SessionMode) {
    setStartingId(exerciseId);
    try {
      const session = await api.post<{ ok: boolean; sessionId: string }>("/api/sessions", { exerciseId, mode });
      router.push(routes.session(session.sessionId));
    } catch (err) {
      toast({
        title: "Impossible de démarrer la session",
        description: err instanceof Error ? err.message : "Une erreur inattendue est survenue.",
        variant: "destructive",
      });
    } finally {
      setStartingId(null);
    }
  }

  // ── Rendu ──

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8" aria-labelledby="generate-title">
      {/* 1. En-tête */}
      <header className="space-y-1">
        <h1 id="generate-title" className="typo-h1">
          Générer des exercices
        </h1>
        <p className="typo-subtitle max-w-2xl">
          Configurez votre session : l’IA s’appuie sur vos documents importés pour créer des exercices corrigés
          automatiquement.
        </p>
      </header>

      {loadError ? (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" aria-hidden />
          <AlertTitle>Erreur de chargement</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>{loadError}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setRefresh((r) => r + 1)}>
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      ) : loading ? (
        <p className="sr-only" role="status">
          Chargement des matières, documents et exercices…
        </p>
      ) : null}

      {loading && !loadError ? (
        /* Squelettes de chargement */
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3" aria-hidden>
          <Card className="rounded-xl border bg-card lg:col-span-2">
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-44 w-full" />
              </div>
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
          <Card className="rounded-xl border bg-card">
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        </div>
      ) : !loadError ? (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          {/* 2. Formulaire de génération */}
          <Card className="rounded-xl border bg-card lg:col-span-2">
            <CardContent>
              <form
                className="space-y-6"
                onSubmit={submit}
                aria-label="Configuration de génération d’exercices"
              >
                {/* Documents sources (requis) */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="typo-h3">Documents sources</h3>
                    <Badge variant="outline">Requis</Badge>
                  </div>

                  {readyDocuments.length === 0 ? (
                    <Alert>
                      <TriangleAlert className="h-4 w-4" aria-hidden />
                      <AlertTitle>Aucun document prêt</AlertTitle>
                      <AlertDescription className="flex flex-col items-start gap-3">
                        <p>Importez d’abord un cours dans la Bibliothèque.</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => router.push(routes.library)}
                        >
                          <BookOpen className="h-3.5 w-3.5" aria-hidden />
                          Aller à la Bibliothèque
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Select value={config.subjectId} onValueChange={changeSubject}>
                          <SelectTrigger className="w-full sm:w-64" aria-label="Filtrer les documents par matière">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ALL_SUBJECT}>Toutes les matières</SelectItem>
                            {subjects.map((subject) => (
                              <SelectItem key={subject.id} value={subject.id}>
                                {subject.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {selectedSubject && (
                          <Select
                            value={config.chapterId ?? "all"}
                            onValueChange={(v) => changeChapter(v === "all" ? null : v)}
                          >
                            <SelectTrigger className="w-full sm:w-56" aria-label="Filtrer les documents par chapitre">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Tout le cours (matière entière)</SelectItem>
                              {selectedSubject.chapters.map((chapter) => (
                                <SelectItem key={chapter.id} value={chapter.id}>
                                  {chapter.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary">
                            <span className="tnum">{documentIds.length}</span> sélectionné(s)
                          </Badge>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={visibleDocuments.length === 0}
                            onClick={selectAllVisible}
                          >
                            Tout sélectionner
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={documentIds.length === 0}
                            onClick={() => setDocumentIds([])}
                          >
                            Effacer
                          </Button>
                        </div>
                      </div>

                      {visibleDocuments.length === 0 ? (
                        <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed py-6 text-center">
                          <FileX className="h-5 w-5 text-muted-foreground" aria-hidden />
                          <p className="typo-h3">Aucun document</p>
                          <p className="typo-subtitle">Aucun document prêt pour cette matière.</p>
                        </div>
                      ) : (
                        <div
                          className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-3"
                          role="group"
                          aria-label="Documents prêts pour la génération"
                        >
                          {visibleDocuments.map((doc) => {
                            const checked = documentIds.includes(doc.id);
                            return (
                              <label
                                key={doc.id}
                                htmlFor={`doc-${doc.id}`}
                                className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 transition-colors hover:bg-accent/60"
                              >
                                <Checkbox
                                  id={`doc-${doc.id}`}
                                  checked={checked}
                                  onCheckedChange={(c) => toggleDocument(doc.id, c === true)}
                                />
                                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={doc.name}>
                                  {doc.name}
                                </span>
                                {doc.subject && (
                                  <Badge variant="outline" className="shrink-0 gap-1.5">
                                    <span
                                      className="h-2 w-2 rounded-full"
                                      style={{ backgroundColor: doc.subject.color }}
                                      aria-hidden
                                    />
                                    {doc.subject.name}
                                  </Badge>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Notions à cibler */}
                <div className="space-y-2">
                  <Label htmlFor="theme-input">Notions à cibler (optionnel)</Label>
                  <Input
                    id="theme-input"
                    type="text"
                    value={themeInput}
                    placeholder="Ex. : récursivité, complexité, jointures…"
                    onChange={(e) => setThemeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTheme();
                      }
                    }}
                  />
                  <p className="typo-meta">
                    Appuyez sur Entrée pour ajouter. Laissez vide pour couvrir tout le document.
                  </p>
                  {themes.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5" aria-label="Notions ciblées">
                      {themes.map((theme) => (
                        <li key={theme}>
                          <Badge variant="secondary" className="gap-1 pr-1">
                            {theme}
                            <button
                              type="button"
                              aria-label={`Retirer la notion ${theme}`}
                              className="rounded-full p-0.5 transition-colors hover:bg-foreground/15"
                              onClick={() => removeTheme(theme)}
                            >
                              <X className="h-3 w-3" aria-hidden />
                            </button>
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Difficulté + nombre de questions */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="difficulty">Difficulté</Label>
                    <Select
                      value={config.difficulty}
                      onValueChange={(v) => updateConfig({ difficulty: v as Difficulty })}
                    >
                      <SelectTrigger id="difficulty" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DIFFICULTY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="question-count">Nombre de questions</Label>
                    <Input
                      id="question-count"
                      type="number"
                      min={1}
                      max={MAX_QUESTIONS}
                      value={config.questionCount}
                      onChange={(e) =>
                        updateConfig({ questionCount: clampInt(e.target.value, 1, MAX_QUESTIONS, 5) })
                      }
                    />
                  </div>
                </div>

                {/* Types d’exercices (requis) */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="typo-h3">Types d’exercices</h3>
                    <Badge variant="outline">Requis</Badge>
                    <Badge variant="secondary" className="ml-auto">
                      <span className="tnum">{types.length}</span> type(s)
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Ensembles prédéfinis de types">
                    {TYPE_PRESETS.map((preset) => (
                      <Button
                        key={preset.label}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setTypes(preset.types)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                  <div
                    className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2"
                    role="group"
                    aria-label="Types d’exercices disponibles"
                  >
                    {QUESTION_TYPES.map((type) => {
                      const checked = types.includes(type);
                      return (
                        <label
                          key={type}
                          htmlFor={`type-${type}`}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent/60"
                        >
                          <Checkbox
                            id={`type-${type}`}
                            checked={checked}
                            onCheckedChange={(c) => toggleType(type, c === true)}
                          />
                          <span className="min-w-0 truncate text-sm" title={QUESTION_TYPE_LABELS[type]}>
                            {QUESTION_TYPE_LABELS[type]}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Mode de session + durée */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="mode">Mode de session</Label>
                    <Select value={config.mode} onValueChange={(v) => updateConfig({ mode: v as SessionMode })}>
                      <SelectTrigger id="mode" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(MODE_LABELS) as SessionMode[]).map((mode) => (
                          <SelectItem key={mode} value={mode}>
                            {MODE_LABELS[mode]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {config.mode === "examen" && (
                    <div className="space-y-2">
                      <Label htmlFor="duration-min">Durée (minutes)</Label>
                      <Input
                        id="duration-min"
                        type="number"
                        min={1}
                        max={240}
                        placeholder="Optionnel"
                        value={config.durationMin ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          updateConfig({ durationMin: raw === "" ? undefined : clampInt(raw, 1, 240, 60) });
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Points + correction */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="points-per-question">Points par question</Label>
                    <Input
                      id="points-per-question"
                      type="number"
                      min={1}
                      max={MAX_QUESTIONS}
                      value={config.pointsPerQuestion}
                      onChange={(e) =>
                        updateConfig({ pointsPerQuestion: clampInt(e.target.value, 1, MAX_QUESTIONS, 1) })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="correction-timing">Correction</Label>
                    <Select
                      value={config.correctionTiming}
                      onValueChange={(v) => updateConfig({ correctionTiming: v === "end" ? "end" : "immediate" })}
                    >
                      <SelectTrigger id="correction-timing" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="immediate">Immédiate</SelectItem>
                        <SelectItem value="end">À la fin de la session</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Équilibre théorie / pratique */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="theory-mix">Équilibre théorie / pratique</Label>
                    <span className="typo-meta tnum">
                      Théorie {config.theoryPracticeMix} % · Pratique {100 - config.theoryPracticeMix} %
                    </span>
                  </div>
                  <Slider
                    id="theory-mix"
                    value={[config.theoryPracticeMix]}
                    min={0}
                    max={100}
                    step={5}
                    onValueChange={(values) => updateConfig({ theoryPracticeMix: values[0] ?? 50 })}
                    aria-label="Équilibre théorie / pratique"
                  />
                  <p className="typo-meta">
                    0 % = uniquement de la pratique · 100 % = uniquement de la théorie.
                  </p>
                </div>

                {/* Indices */}
                <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="hints-enabled">Autoriser les indices</Label>
                    <p className="typo-meta">Propose des indices consultables pendant la session.</p>
                  </div>
                  <Switch
                    id="hints-enabled"
                    checked={config.hintsEnabled}
                    onCheckedChange={(v) => updateConfig({ hintsEnabled: v })}
                    aria-label="Autoriser les indices"
                  />
                </div>

                <Separator />

                {/* Soumission */}
                <div className="space-y-2">
                  {missingHint && (
                    <p className="typo-meta" role="status">
                      {missingHint}
                    </p>
                  )}
                  <Button type="submit" size="lg" className="w-full gap-2 font-semibold" disabled={!canSubmit}>
                    {generating ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="h-4 w-4" aria-hidden />
                    )}
                    {generating ? "Génération en cours… (IA, 30 à 90 s)" : "Générer et démarrer la session"}
                  </Button>
                  {generating && (
                    <Alert className="w-full">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      <AlertTitle className="typo-subtitle">
                        L’IA analyse vos documents et rédige les exercices…
                      </AlertTitle>
                    </Alert>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          {/* 3. Exercices précédents */}
          <Card className="rounded-xl border bg-card">
            <CardHeader>
              <CardTitle className="typo-h3 flex items-center gap-2">
                <History className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
                Exercices précédents
              </CardTitle>
              <CardDescription className="typo-meta">Relancez une session générée précédemment.</CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                  <History className="h-6 w-6 text-muted-foreground" aria-hidden />
                  <p className="typo-h3">Aucun exercice</p>
                  <p className="typo-subtitle">Vos exercices générés apparaîtront ici.</p>
                </div>
              ) : (
                <ul
                  className="max-h-[32rem] space-y-3 overflow-y-auto pr-1"
                  aria-label="Exercices générés précédemment"
                >
                  {history.map((exercise) => (
                    <li key={exercise.id} className="space-y-2 rounded-lg border p-3">
                      <p className="truncate text-sm font-medium" title={exercise.title}>
                        {exercise.title}
                      </p>
                      <p className="typo-meta">
                        <span className="tnum">{exercise.questionCount}</span> question(s) ·{" "}
                        {formatDate(exercise.createdAt)}
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          {exercise.subject && (
                            <span className="typo-meta flex min-w-0 items-center gap-1.5">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: exercise.subject.color }}
                                aria-hidden
                              />
                              <span className="truncate">{exercise.subject.name}</span>
                            </span>
                          )}
                          {exercise.config?.difficulty && (
                            <Badge variant="outline">{DIFFICULTY_LABELS[exercise.config.difficulty]}</Badge>
                          )}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="shrink-0 gap-1.5"
                          disabled={startingId !== null}
                          onClick={() => startExercise(exercise.id, exercise.config?.mode ?? "apprentissage")}
                        >
                          {startingId === exercise.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Play className="h-3.5 w-3.5" aria-hidden />
                          )}
                          Démarrer
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
