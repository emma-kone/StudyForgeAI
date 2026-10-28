"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Layers,
  Lightbulb,
  RefreshCw,
  Timer,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { api } from "@/lib/client-api";
import { useAppStore } from "@/store/app-store";
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
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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

interface ConceptStat {
  notion: string;
  mastery: number;
  attempts: number;
  correct: number;
  lastSeen: string;
}

interface Recommendation {
  id: string;
  notion: string;
  reason: string;
  priority: number;
  status: string;
  createdAt: string;
}

interface RecentSession {
  id: string;
  title: string;
  mode: string;
  status: string;
  percentage: number | null;
  score: number | null;
  maxScore: number | null;
  startedAt: string;
  subject: { name: string; color: string } | null;
}

interface AiStats {
  calls: number;
  errors: number;
  recentErrors: { id: string; op: string; error: string | null; createdAt: string }[];
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
  recentSessions: RecentSession[];
  ai: AiStats;
  examResults: ExamResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<string, string> = {
  apprentissage: "Apprentissage",
  entrainement: "Entraînement",
  examen: "Examen",
  revision: "Révision ciblée",
  personnalise: "Personnalisé",
};

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

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

interface StatusBadgeInfo {
  label: string;
  variant: BadgeVariant;
}

function sessionStatusBadge(status: string, percentage: number | null): StatusBadgeInfo {
  if (status === "IN_PROGRESS") return { label: "En cours", variant: "secondary" };
  if (status === "SUBMITTED") return { label: "Soumise", variant: "outline" };
  if (status === "GRADED") {
    const pct = percentage ?? 0;
    const label = `${Math.round(pct)} %`;
    if (pct >= 60) return { label, variant: "default" };
    if (pct < 40) return { label, variant: "destructive" };
    return { label, variant: "outline" };
  }
  return { label: status, variant: "outline" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sous-composants
// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  value,
  label,
  badge,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  badge?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"
          aria-hidden="true"
        >
          <Icon className="size-5 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="tnum truncate text-2xl font-bold leading-tight">{value}</p>
          <p className="typo-meta truncate">{label}</p>
        </div>
        {badge}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index}>
            <CardContent className="flex items-center gap-3 p-4">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-7 w-14" />
                <Skeleton className="h-3 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Vue Tableau de bord
// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardView() {
  const setView = useAppStore((s) => s.setView);
  const openSession = useAppStore((s) => s.openSession);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Stats>("/api/stats");
      setStats(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de charger les statistiques."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData, refreshCounter]);

  const isEmpty =
    stats !== null &&
    stats.counts.subjects === 0 &&
    stats.counts.documents === 0 &&
    stats.counts.sessionsTotal === 0;

  return (
    <section className="space-y-6" aria-labelledby="dashboard-title">
      <div>
        <h1 id="dashboard-title" className="typo-h1">
          Tableau de bord
        </h1>
        <p className="typo-subtitle">Vue d&apos;ensemble de votre apprentissage</p>
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
      ) : loading || !stats ? (
        <DashboardSkeleton />
      ) : isEmpty ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10"
                aria-hidden="true"
              >
                <GraduationCap className="size-6 text-primary" />
              </span>
              <CardTitle className="typo-h2">Bienvenue sur StudyForge AI</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <ol className="typo-subtitle space-y-2">
              <li>1. Importez un cours dans la Bibliothèque.</li>
              <li>2. Générez des exercices personnalisés.</li>
              <li>3. Suivez votre progression.</li>
            </ol>
            <Button onClick={() => setView("library")}>Aller à la Bibliothèque</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Indicateurs clés */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard icon={Layers} value={String(stats.counts.subjects)} label="Matières" />
            <KpiCard
              icon={FileText}
              value={`${stats.counts.documentsReady}/${stats.counts.documents}`}
              label="Documents"
              badge={
                stats.counts.documentsError > 0 ? (
                  <Badge variant="destructive">
                    erreur : {stats.counts.documentsError}
                  </Badge>
                ) : undefined
              }
            />
            <KpiCard
              icon={ClipboardCheck}
              value={`${stats.counts.sessionsGraded}/${stats.counts.sessionsTotal}`}
              label="Sessions corrigées"
            />
            <KpiCard
              icon={TrendingUp}
              value={stats.overallAvg === null ? "—" : `${Math.round(stats.overallAvg)} %`}
              label="Moyenne générale"
            />
          </div>

          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"
                aria-hidden="true"
              >
                <Timer className="size-5 text-muted-foreground" />
              </span>
              <div>
                <p className="tnum text-2xl font-bold leading-tight">
                  {stats.workMinutes} min
                </p>
                <p className="typo-meta">Temps de travail cumulé</p>
              </div>
            </CardContent>
          </Card>

          {/* Recommandations */}
          {stats.recommendations.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"
                    aria-hidden="true"
                  >
                    <Lightbulb className="size-4 text-muted-foreground" />
                  </span>
                  <CardTitle className="typo-h3">Recommandations d&apos;étude</CardTitle>
                </div>
                <Button size="sm" variant="outline" onClick={() => setView("progress")}>
                  Voir la progression
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.recommendations.map((rec) => (
                  <button
                    key={rec.id}
                    type="button"
                    onClick={() => setView("progress")}
                    className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={rec.priority > 0.75 ? "destructive" : "secondary"}>
                          {rec.priority > 0.75 ? "Priorité haute" : "Priorité normale"}
                        </Badge>
                        <span className="text-sm font-medium">{rec.notion}</span>
                      </div>
                      <p className="typo-subtitle">{rec.reason}</p>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Sessions récentes */}
          {stats.recentSessions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="typo-h3">Sessions récentes</CardTitle>
                <CardDescription className="typo-subtitle">
                  Vos dernières sessions d&apos;exercices, cliquez pour les rouvrir
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {stats.recentSessions.map((session) => {
                    const statusBadge = sessionStatusBadge(session.status, session.percentage);
                    return (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => openSession(session.id)}
                        className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {session.subject ? (
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: session.subject.color }}
                            aria-hidden="true"
                          />
                        ) : (
                          <span
                            className="size-2.5 shrink-0 rounded-full bg-muted-foreground/40"
                            aria-hidden="true"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {session.title}
                          </span>
                          <span className="typo-meta block truncate">
                            {session.subject ? session.subject.name : "Sans matière"} ·{" "}
                            {formatDateTime(session.startedAt)}
                          </span>
                        </span>
                        <Badge variant="outline" className="shrink-0">
                          {MODE_LABELS[session.mode] ?? session.mode}
                        </Badge>
                        <Badge variant={statusBadge.variant} className="tnum shrink-0">
                          {statusBadge.label}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Répartition par matière */}
          {stats.bySubject.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="typo-h3">Répartition par matière</CardTitle>
                <CardDescription className="typo-subtitle">
                  Moyenne obtenue pour chaque matière
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 space-y-4 overflow-y-auto pr-1">
                  {stats.bySubject.map((subject) => {
                    const pct = subject.avg === null ? 0 : clampPercent(subject.avg);
                    return (
                      <div key={subject.id} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: subject.color }}
                              aria-hidden="true"
                            />
                            <span className="truncate text-sm font-medium">{subject.name}</span>
                          </span>
                          <span className="tnum shrink-0 text-sm font-semibold">
                            {subject.avg === null ? "—" : `${Math.round(subject.avg)} %`}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: subject.color }}
                          />
                        </div>
                        <p className="typo-meta">
                          {subject.documents} document{subject.documents > 1 ? "s" : ""} ·{" "}
                          {subject.sessions} session{subject.sessions > 1 ? "s" : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Concepts */}
          {stats.conceptStats.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="typo-h3">Concepts</CardTitle>
                <CardDescription className="typo-subtitle">
                  Niveau de maîtrise estimé par notion
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {stats.conceptStats.slice(0, 6).map((concept) => (
                    <div key={concept.notion} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{concept.notion}</span>
                        <span className="tnum shrink-0 text-sm font-semibold">
                          {Math.round(clampPercent(concept.mastery * 100))} %
                        </span>
                      </div>
                      <Progress
                        value={clampPercent(concept.mastery * 100)}
                        aria-label={`Maîtrise de ${concept.notion}`}
                      />
                      <p className="typo-meta">
                        {concept.attempts} tentative{concept.attempts > 1 ? "s" : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Alertes IA */}
          {stats.ai.errors > 0 && stats.ai.recentErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertTitle>Dernières erreurs IA</AlertTitle>
              <AlertDescription>
                <ul className="space-y-1.5">
                  {stats.ai.recentErrors.map((aiError) => (
                    <li key={aiError.id} className="text-xs">
                      <span className="font-medium">{aiError.op}</span>
                      {aiError.error ? (
                        <span> — {truncateText(aiError.error, 140)}</span>
                      ) : null}
                      <span className="typo-meta block">
                        {formatDateTime(aiError.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </section>
  );
}
