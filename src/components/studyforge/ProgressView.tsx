"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Award,
  ClipboardCheck,
  FilePlus2,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { api } from "@/lib/client-api";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/app-store";
import type { Difficulty } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ProgressViewProps {
  onGenerateRevision: (exerciseId: string, sessionId: string) => void;
}

interface StatsCounts {
  subjects: number;
  documents: number;
  documentsReady: number;
  documentsError: number;
  sessionsTotal: number;
  sessionsGraded: number;
  sessionsInProgress: number;
}

interface SubjectStat {
  id: string;
  name: string;
  color: string;
  documents: number;
  sessions: number;
  avg: number | null;
}

interface TimelineEntry {
  date: string;
  label: string;
  percentage: number;
  mode: string;
}

interface ExamResult {
  id: string;
  title: string;
  percentage: number | null;
  finishedAt: string | null;
}

interface Stats {
  counts: StatsCounts;
  overallAvg: number | null;
  bySubject: SubjectStat[];
  timeline: TimelineEntry[];
  workMinutes: number;
  conceptStats: ConceptStat[];
  recommendations: Recommendation[];
  recentSessions: {
    id: string;
    title: string;
    mode: string;
    status: string;
    percentage: number | null;
    score: number | null;
    maxScore: number | null;
    startedAt: string;
    subject: { name: string; color: string } | null;
  }[];
  ai: {
    calls: number;
    errors: number;
    recentErrors: { id: string; op: string; error: string | null; createdAt: string }[];
  };
  examResults: ExamResult[];
}

interface Recommendation {
  id: string;
  notion: string;
  reason: string;
  priority: number;
  status: string;
  createdAt: string;
}

interface ConceptStat {
  notion: string;
  mastery: number;
  attempts: number;
  correct: number;
  lastSeen: string;
}

interface RecommendationsResponse {
  recommendations: Recommendation[];
  conceptStats: ConceptStat[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: "decouverte", label: "Découverte" },
  { value: "facile", label: "Facile" },
  { value: "moyen", label: "Moyen" },
  { value: "difficile", label: "Difficile" },
  { value: "expert", label: "Expert" },
];

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return dateFormatter.format(parsed);
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

// ─────────────────────────────────────────────────────────────────────────────
// Sous-composants
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"
          aria-hidden="true"
        >
          <Icon className="size-5 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <p className="tnum truncate text-2xl font-bold leading-tight">{value}</p>
          <p className="typo-meta truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Card key={index}>
            <CardContent className="flex items-center gap-3 p-4">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue Progression
// ─────────────────────────────────────────────────────────────────────────────

export default function ProgressView({ onGenerateRevision }: ProgressViewProps) {
  const { toast } = useToast();
  const setView = useAppStore((s) => s.setView);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recsData, setRecsData] = useState<RecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>("moyen");
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsData, recommendationsData] = await Promise.all([
        api.get<Stats>("/api/stats"),
        api.get<RecommendationsResponse>("/api/recommendations"),
      ]);
      setStats(statsData);
      setRecsData(recommendationsData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de charger la progression."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData, refreshCounter]);

  const handleGenerate = useCallback(
    async (rec: Recommendation) => {
      setGeneratingId(rec.id);
      try {
        const exercise = await api.post<{
          ok: boolean;
          exerciseId: string;
          questionCount: number;
        }>("/api/exercises/revision", { notion: rec.notion, difficulty });
        const session = await api.post<{ ok: boolean; sessionId: string }>(
          "/api/sessions",
          { exerciseId: exercise.exerciseId, mode: "revision" }
        );
        toast({
          title: "Révision ciblée prête",
          description: `${exercise.questionCount} exercice(s) généré(s) sur « ${rec.notion} ».`,
        });
        onGenerateRevision(exercise.exerciseId, session.sessionId);
      } catch (err) {
        toast({
          title: "Échec de la génération",
          description:
            err instanceof Error
              ? err.message
              : "Une erreur est survenue pendant la génération.",
          variant: "destructive",
        });
      } finally {
        setGeneratingId(null);
      }
    },
    [difficulty, onGenerateRevision, toast]
  );

  const handleDismiss = useCallback(
    async (rec: Recommendation) => {
      setDismissingId(rec.id);
      try {
        await api.patch("/api/recommendations", { id: rec.id, status: "DISMISSED" });
        setRefreshCounter((c) => c + 1);
      } catch (err) {
        toast({
          title: "Échec",
          description:
            err instanceof Error
              ? err.message
              : "Impossible d'ignorer cette recommandation.",
          variant: "destructive",
        });
      } finally {
        setDismissingId(null);
      }
    },
    [toast]
  );

  const openRecommendations =
    recsData?.recommendations.filter((rec) => rec.status === "OPEN") ?? [];
  const sortedConcepts = recsData
    ? [...recsData.conceptStats].sort((a, b) => a.mastery - b.mastery)
    : [];
  const weakestNotions = new Set(sortedConcepts.slice(0, 3).map((c) => c.notion));
  const busy = generatingId !== null || dismissingId !== null;

  return (
    <section className="space-y-6" aria-labelledby="progress-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 id="progress-title" className="typo-h1">
            Progression
          </h1>
          <p className="typo-subtitle">
            Analyse de votre maîtrise par notion et révisions ciblées
          </p>
        </div>
        <Button variant="outline" onClick={() => setView("generate")}>
          <FilePlus2 className="size-4" aria-hidden="true" />
          Nouvel exercice
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Erreur de chargement</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{error}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRefreshCounter((c) => c + 1)}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      ) : loading || !stats || !recsData ? (
        <ProgressSkeleton />
      ) : (
        <>
          {/* Synthèse */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              icon={TrendingUp}
              value={stats.overallAvg === null ? "—" : `${Math.round(stats.overallAvg)} %`}
              label="Moyenne générale"
            />
            <StatCard
              icon={ClipboardCheck}
              value={String(stats.counts.sessionsGraded)}
              label="Sessions corrigées"
            />
            <StatCard
              icon={Timer}
              value={`${stats.workMinutes} min`}
              label="Temps de travail"
            />
          </div>

          {/* Évolution des notes */}
          {stats.timeline.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"
                    aria-hidden="true"
                  >
                    <TrendingUp className="size-4 text-muted-foreground" />
                  </span>
                  <CardTitle className="typo-h3">Évolution des notes</CardTitle>
                </div>
                <CardDescription className="typo-subtitle">
                  Historique de vos sessions corrigées, les plus récentes en tête
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                  {[...stats.timeline].reverse().map((entry, index) => (
                    <div
                      key={`${entry.date}-${entry.label}-${index}`}
                      className="flex items-center gap-3"
                    >
                      <span
                        className="typo-meta w-32 shrink-0 truncate sm:w-44"
                        title={entry.label}
                      >
                        {formatDateTime(entry.date)}
                      </span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${clampPercent(entry.percentage)}%` }}
                        />
                      </div>
                      <span className="tnum w-12 shrink-0 text-right text-sm font-semibold">
                        {Math.round(entry.percentage)} %
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Maîtrise par notion */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"
                  aria-hidden="true"
                >
                  <Target className="size-4 text-muted-foreground" />
                </span>
                <CardTitle className="typo-h3">Maîtrise par notion</CardTitle>
              </div>
              <CardDescription className="typo-subtitle">
                Notions classées de la plus fragile à la mieux maîtrisée
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sortedConcepts.length === 0 ? (
                <p className="typo-subtitle">
                  Aucune donnée — terminez une session d&apos;exercices.
                </p>
              ) : (
                <div className="max-h-96 space-y-4 overflow-y-auto pr-1">
                  {sortedConcepts.map((concept) => {
                    const masteryPct = Math.round(clampPercent(concept.mastery * 100));
                    return (
                      <div key={concept.notion} className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {concept.notion}
                            </span>
                            {concept.mastery >= 0.75 ? (
                              <Badge variant="default">Acquis</Badge>
                            ) : concept.mastery < 0.5 ? (
                              <Badge variant="destructive">À revoir</Badge>
                            ) : (
                              <Badge variant="secondary">En cours</Badge>
                            )}
                          </span>
                          <span className="typo-meta shrink-0">
                            {concept.attempts} tentative{concept.attempts > 1 ? "s" : ""}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <Progress
                            value={masteryPct}
                            className="flex-1"
                            aria-label={`Maîtrise de ${concept.notion}`}
                          />
                          <span className="tnum w-12 shrink-0 text-right text-sm font-semibold">
                            {masteryPct} %
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Révisions ciblées */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"
                  aria-hidden="true"
                >
                  <Lightbulb className="size-4 text-muted-foreground" />
                </span>
                <CardTitle className="typo-h3">Révisions ciblées</CardTitle>
              </div>
              <CardDescription className="typo-subtitle">
                Générez un exercice court sur une notion à consolider
              </CardDescription>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Label htmlFor="revision-difficulty" className="typo-meta">
                  Difficulté
                </Label>
                <Select
                  value={difficulty}
                  onValueChange={(value) => setDifficulty(value as Difficulty)}
                >
                  <SelectTrigger id="revision-difficulty" size="sm" className="w-44">
                    <SelectValue placeholder="Choisir une difficulté" />
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
            </CardHeader>
            <CardContent>
              {openRecommendations.length === 0 ? (
                <p className="typo-subtitle">Aucune recommandation pour le moment.</p>
              ) : (
                <div className="space-y-3">
                  {openRecommendations.map((rec) => (
                    <div
                      key={rec.id}
                      className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{rec.notion}</span>
                          <Badge variant={rec.priority > 0.75 ? "destructive" : "secondary"}>
                            {rec.priority > 0.75 ? "Priorité haute" : "Priorité normale"}
                          </Badge>
                        </div>
                        <p className="typo-subtitle">{rec.reason}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Button size="sm" onClick={() => void handleGenerate(rec)} disabled={busy}>
                          {generatingId === rec.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Sparkles className="size-4" aria-hidden="true" />
                          )}
                          {generatingId === rec.id ? "Génération…" : "Générer une révision"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleDismiss(rec)}
                          disabled={busy}
                        >
                          {dismissingId === rec.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : null}
                          Ignorer
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Résultats d'examens */}
          {stats.examResults.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"
                    aria-hidden="true"
                  >
                    <Award className="size-4 text-muted-foreground" />
                  </span>
                  <CardTitle className="typo-h3">Résultats d&apos;examens</CardTitle>
                </div>
                <CardDescription className="typo-subtitle">
                  Vos derniers examens blancs corrigés
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {stats.examResults.map((exam) => (
                    <div
                      key={exam.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {exam.title}
                      </span>
                      <span className="tnum shrink-0 text-sm font-semibold">
                        {exam.percentage === null ? "—" : `${Math.round(exam.percentage)} %`}
                      </span>
                      <span className="typo-meta w-full shrink-0 sm:w-auto">
                        {exam.finishedAt ? formatDateTime(exam.finishedAt) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </section>
  );
}
