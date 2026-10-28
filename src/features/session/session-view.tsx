"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SessionView — déroulé d'une session d'exercices StudyForge AI.
// - 20 types de questions (QCM, textes à trous, association, code, SQL…)
// - Mode Apprentissage : correction immédiate + réessai autorisé + indices
// - Modes Entraînement / Examen : correction en fin de session
// - Rapport final : note justifiée, maîtrise par notion, corrections détaillées
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Extension } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { sql as sqlLang } from "@codemirror/lang-sql";

import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/app-store";
import {
  CODE_TYPES,
  SQL_TYPES,
  QUESTION_TYPE_LABELS,
  MODE_LABELS,
  type Question,
  type SessionMode,
  type CorrectionFeedback,
  type SessionSummary,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Info,
  Lightbulb,
  ListChecks,
  Loader2,
  MinusCircle,
  Play,
  Send,
  XCircle,
} from "lucide-react";

// ── Types de l'API ───────────────────────────────────────────────────────────

interface SessionConfig {
  hintsEnabled?: boolean;
  correctionTiming?: "immediate" | "end";
  durationMin?: number;
  difficulty?: string;
  documentIds?: string[];
}

interface ItemState {
  id: string;
  questionIdx: number;
  maxPoints: number;
  points: number | null;
  status: string;
  graded: boolean;
  hintsUsed: number;
  lastAnswer: unknown;
  feedback: CorrectionFeedback | null;
}

interface SessionData {
  session: {
    id: string;
    title: string;
    mode: SessionMode;
    status: string;
    config: SessionConfig | null;
    startedAt: string;
    finishedAt: string | null;
    durationSec: number | null;
    score: number | null;
    maxScore: number | null;
    percentage: number | null;
    summary: SessionSummary | null;
    hintsUsed: number;
  };
  questions: Question[];
  items: ItemState[];
}

interface ExecResponse {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  note?: string;
}

interface SqlStatementResult {
  sql: string;
  kind: string;
  rows?: Record<string, unknown>[];
  columns?: string[];
  error?: string;
  changes?: number;
}

interface SqlRunResponse {
  ok: boolean;
  statements: SqlStatementResult[];
  error?: string;
  durationMs: number;
}

interface SessionViewProps {
  sessionId: string;
}

// ── Utilitaires ──────────────────────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mélange déterministe (même graine → même ordre, stable entre rendus). */
function seedShuffle<T>(arr: T[], seed: number): T[] {
  const copy = [...arr];
  let state = seed || 1;
  const rand = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function langExtension(language?: string): Extension | null {
  switch ((language ?? "").toLowerCase()) {
    case "javascript":
    case "js":
      return javascript();
    case "typescript":
    case "ts":
      return javascript({ typescript: true });
    case "python":
    case "py":
      return python();
    case "java":
      return java();
    case "c":
    case "cpp":
    case "c++":
    case "csharp":
      return cpp();
    case "sql":
      return sqlLang();
    default:
      return null;
  }
}

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function defaultDraft(q: Question): unknown {
  switch (q.type) {
    case "qcm_multiple":
      return [];
    case "fill_blank":
      return (q.blanks ?? []).map(() => "");
    case "matching":
      return {} as Record<string, string>;
    case "ordering":
      return undefined; // géré par OrderedListInput (mélange déterministe)
    case "error_identification":
      return { line: "", explanation: "" };
    case "code_output":
      return "";
    case "code_write":
    case "code_fix":
    case "debug":
      return q.starterCode ?? "";
    case "sql_query":
    case "sql_create_table":
    case "sql_database":
      return q.starterCode ?? "";
    default:
      return "";
  }
}

function hasAnswer(q: Question, draft: unknown): boolean {
  if (draft == null) return false;
  switch (q.type) {
    case "qcm_single":
      return typeof draft === "string" && draft.length > 0;
    case "qcm_multiple":
      return Array.isArray(draft) && draft.length > 0;
    case "true_false":
      return draft === "true" || draft === "false";
    case "fill_blank":
      return Array.isArray(draft) && draft.some((v) => String(v ?? "").trim() !== "");
    case "matching":
      return typeof draft === "object" && Object.values(draft as Record<string, string>).some((v) => v);
    case "ordering":
      return Array.isArray(draft) && draft.length > 0;
    case "error_identification":
      return typeof draft === "object" && String((draft as { line?: string }).line ?? "").trim() !== "";
    case "open_question":
    case "case_study":
    case "data_modeling":
    case "combined":
    case "exam_composite":
    case "short_answer":
    case "code_output":
      return typeof draft === "string" && draft.trim().length > 0;
    case "code_write":
    case "code_fix":
    case "debug":
    case "sql_query":
    case "sql_create_table":
    case "sql_database":
      return typeof draft === "string" && draft.trim().length > 0;
    default:
      return String(draft).trim().length > 0;
  }
}

const VERDICT_BADGE: Record<string, { label: string; className: string }> = {
  correct: { label: "Correcte", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  partial: { label: "Partiellement correcte", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  incorrect: { label: "Incorrecte", className: "bg-destructive text-destructive-foreground" },
  skipped: { label: "Sans réponse", className: "bg-muted text-muted-foreground" },
};

// ── Panneau de correction détaillée ──────────────────────────────────────────

function FeedbackPanel({
  question,
  maxPoints,
  feedback,
}: {
  question: Question;
  maxPoints: number;
  feedback: CorrectionFeedback;
}) {
  const verdict = VERDICT_BADGE[feedback.verdict] ?? VERDICT_BADGE.skipped;
  const mono =
    CODE_TYPES.includes(question.type) || SQL_TYPES.includes(question.type) || question.type === "code_output";
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={verdict.className}>{verdict.label}</Badge>
        <span className="tnum text-sm font-semibold">
          {feedback.points} / {maxPoints} pt(s)
        </span>
        {feedback.uncertain && (
          <Badge variant="outline" className="gap-1">
            <AlertCircle className="h-3 w-3" aria-hidden /> Correction incertaine
          </Badge>
        )}
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed">{feedback.explanation}</p>

      {feedback.criteria && feedback.criteria.length > 0 && (
        <div className="space-y-1.5">
          <p className="typo-meta font-medium uppercase tracking-wide">Grille d&apos;évaluation</p>
          {feedback.criteria.map((c, i) => (
            <div key={i} className="rounded-md border bg-background p-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{c.criterion}</span>
                <span className="tnum text-sm font-semibold">
                  {c.awarded} / {c.max}
                </span>
              </div>
              {c.comment && <p className="typo-meta mt-1">{c.comment}</p>}
            </div>
          ))}
        </div>
      )}

      {feedback.expectedAnswer && (
        <div className="space-y-1">
          <p className="typo-meta font-medium uppercase tracking-wide">Réponse attendue</p>
          {mono ? (
            <pre className="font-code max-h-48 overflow-auto rounded-md border bg-background p-3 text-xs leading-relaxed">
              {feedback.expectedAnswer}
            </pre>
          ) : (
            <p className="whitespace-pre-wrap rounded-md border bg-background p-3 text-sm">{feedback.expectedAnswer}</p>
          )}
        </div>
      )}

      {feedback.sources && feedback.sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {feedback.sources.map((s, i) => (
            <span key={i} className="typo-meta inline-flex items-center gap-1">
              <FileText className="h-3 w-3" aria-hidden />
              {s.document}
              {s.section ? ` — ${s.section}` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Saisies par type de question ─────────────────────────────────────────────

function QcmSingleInput({ q, value, onChange }: { q: Question; value: unknown; onChange: (v: string) => void }) {
  const selected = typeof value === "string" ? value : "";
  return (
    <RadioGroup value={selected} onValueChange={onChange} className="gap-2" aria-label="Options de réponse">
      {(q.options ?? []).map((o) => (
        <Label
          key={o.id}
          htmlFor={`opt-${o.id}`}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm font-normal transition-colors hover:bg-muted/60",
            selected === o.id && "border-primary bg-primary/5"
          )}
        >
          <RadioGroupItem id={`opt-${o.id}`} value={o.id} className="mt-0.5" />
          <span>{o.label}</span>
        </Label>
      ))}
    </RadioGroup>
  );
}

function QcmMultipleInput({ q, value, onChange }: { q: Question; value: unknown; onChange: (v: string[]) => void }) {
  const picked = Array.isArray(value) ? (value as string[]) : [];
  const toggle = (id: string) => onChange(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);
  return (
    <div className="space-y-2" role="group" aria-label="Options de réponse (plusieurs choix possibles)">
      {(q.options ?? []).map((o) => (
        <Label
          key={o.id}
          htmlFor={`opt-${o.id}`}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm font-normal transition-colors hover:bg-muted/60",
            picked.includes(o.id) && "border-primary bg-primary/5"
          )}
        >
          <Checkbox id={`opt-${o.id}`} checked={picked.includes(o.id)} onCheckedChange={() => toggle(o.id)} className="mt-0.5" />
          <span>{o.label}</span>
        </Label>
      ))}
      <p className="typo-meta">Plusieurs réponses possibles — les réponses erronées retirent des points.</p>
    </div>
  );
}

function TrueFalseInput({ value, onChange }: { value: unknown; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-3" role="group" aria-label="Réponse vrai ou faux">
      <Button
        type="button"
        variant={value === "true" ? "default" : "outline"}
        onClick={() => onChange("true")}
        className="h-12 flex-1 gap-2 font-semibold"
        aria-pressed={value === "true"}
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden /> Vrai
      </Button>
      <Button
        type="button"
        variant={value === "false" ? "default" : "outline"}
        onClick={() => onChange("false")}
        className="h-12 flex-1 gap-2 font-semibold"
        aria-pressed={value === "false"}
      >
        <XCircle className="h-4 w-4" aria-hidden /> Faux
      </Button>
    </div>
  );
}

function FillBlankInput({ q, value, onChange }: { q: Question; value: unknown; onChange: (v: string[]) => void }) {
  const answers = Array.isArray(value) ? (value as string[]) : [];
  const blanks = q.blanks ?? [];
  const segments = q.segments ?? [];
  const set = (i: number, v: string) => {
    const next = [...answers];
    while (next.length < blanks.length) next.push("");
    next[i] = v;
    onChange(next);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm leading-loose">
        {segments.map((seg, i) => (
          <span key={i} className="contents">
            <span className="whitespace-pre-wrap">{seg}</span>
            {i < blanks.length && (
              <Input
                value={answers[i] ?? ""}
                onChange={(e) => set(i, e.target.value)}
                className="inline-block w-40 font-medium"
                aria-label={`Trou ${i + 1}`}
                autoComplete="off"
              />
            )}
          </span>
        ))}
      </div>
      {blanks.length > segments.length - 1 && (
        <div className="space-y-2">
          {blanks.slice(Math.max(0, segments.length - 1)).map((_, j) => {
            const idx = Math.max(0, segments.length - 1) + j;
            return (
              <Input
                key={idx}
                value={answers[idx] ?? ""}
                onChange={(e) => set(idx, e.target.value)}
                placeholder={`Réponse ${idx + 1}`}
                aria-label={`Trou ${idx + 1}`}
                autoComplete="off"
              />
            );
          })}
        </div>
      )}
      <p className="typo-meta">{blanks.length} trou(s) à compléter. Les variantes orthographiques raisonnables sont acceptées.</p>
    </div>
  );
}

function MatchingInput({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: unknown;
  onChange: (v: Record<string, string>) => void;
}) {
  const pairs = q.pairs ?? [];
  const rights = useMemo(() => seedShuffle(pairs.map((p) => p.right), hashStr(q.statement) || 7), [pairs, q.statement]);
  const current = (typeof value === "object" && value !== null ? value : {}) as Record<string, string>;
  return (
    <div className="space-y-3">
      {pairs.map((p, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <span className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">{p.left}</span>
          <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden />
          <Select value={current[p.left] ?? ""} onValueChange={(v) => onChange({ ...current, [p.left]: v })}>
            <SelectTrigger className="w-full sm:w-64" aria-label={`Association pour ${p.left}`}>
              <SelectValue placeholder="Choisir la définition…" />
            </SelectTrigger>
            <SelectContent>
              {rights.map((r, j) => (
                <SelectItem key={`${r}-${j}`} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      <p className="typo-meta">Associez chaque notion à la bonne définition.</p>
    </div>
  );
}

function OrderedListInput({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: unknown;
  onChange: (v: string[]) => void;
}) {
  const items = useMemo(
    () => seedShuffle(q.orderedItems ?? [], hashStr(q.statement) || 11),
    [q.orderedItems, q.statement]
  );
  const list = Array.isArray(value) && value.length > 0 ? (value as string[]) : items;
  const move = (i: number, dir: -1 | 1) => {
    const next = [...list];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {list.map((item, i) => (
        <div key={`${item}-${i}`} className="flex items-center gap-2 rounded-lg border p-2.5">
          <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            {i + 1}
          </span>
          <span className="flex-1 text-sm">{item}</span>
          <div className="flex shrink-0 gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Monter « ${item} »`}>
              ↑
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Descendre « ${item} »`}>
              ↓
            </Button>
          </div>
        </div>
      ))}
      <p className="typo-meta">Remettez les étapes dans le bon ordre avec les flèches.</p>
    </div>
  );
}

function ErrorIdentificationInput({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: unknown;
  onChange: (v: { line: string; explanation: string }) => void;
}) {
  const current = (typeof value === "object" && value !== null ? value : { line: "", explanation: "" }) as {
    line: string;
    explanation: string;
  };
  const lines = (q.buggyCode ?? "").split("\n");
  return (
    <div className="space-y-4">
      <pre className="font-code max-h-72 overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
        {lines.map((l, i) => (
          <div key={i} className={cn("flex gap-3", Number(current.line) === i + 1 && "rounded bg-amber-100 dark:bg-amber-950")}>
            <span className="tnum inline-block w-8 shrink-0 select-none text-right text-muted-foreground">{i + 1}</span>
            <span className="whitespace-pre-wrap">{l || " "}</span>
          </div>
        ))}
      </pre>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="error-line">Numéro de ligne</Label>
          <Input
            id="error-line"
            type="number"
            min={1}
            value={current.line}
            onChange={(e) => onChange({ ...current, line: e.target.value })}
            placeholder="ex. 3"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="error-explanation">Explication de l&apos;erreur</Label>
          <Textarea
            id="error-explanation"
            rows={3}
            value={current.explanation}
            onChange={(e) => onChange({ ...current, explanation: e.target.value })}
            placeholder="Décrivez la nature de l'erreur et comment la corriger…"
          />
        </div>
      </div>
    </div>
  );
}

function CodeMirrorField({
  value,
  language,
  isSql,
  onChange,
}: {
  value: string;
  language?: string;
  isSql: boolean;
  onChange: (v: string) => void;
}) {
  const isDark = useIsDark();
  const ext = isSql ? sqlLang() : langExtension(language);
  return (
    <div className="overflow-hidden rounded-md border" aria-label="Éditeur de code">
      <CodeMirror
        value={value}
        theme={isDark ? oneDark : "light"}
        extensions={ext ? [ext] : []}
        onChange={onChange}
        basicSetup={{ foldGutter: false, highlightActiveLine: true }}
        className="text-[13.5px]"
        minHeight="220px"
      />
    </div>
  );
}

// ── Vue principale ───────────────────────────────────────────────────────────

export default function SessionView({ sessionId }: SessionViewProps) {
  const { toast } = useToast();
  const router = useRouter();
  const onExit = useCallback(() => {
    router.push(routes.home);
  }, [router]);
  // Brouillons PERSISTÉS : la position courante et les réponses non validées
  // survivent à un changement de vue ou à un rechargement (store + localStorage).
  const savedDraft = useAppStore((s) => s.sessionDrafts[sessionId]);
  const saveSessionDraft = useAppStore((s) => s.saveSessionDraft);
  const clearSessionDraft = useAppStore((s) => s.clearSessionDraft);
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(savedDraft?.current ?? 0);
  const [drafts, setDrafts] = useState<Record<number, unknown>>(savedDraft?.drafts ?? {});
  const [feedbacks, setFeedbacks] = useState<Record<number, CorrectionFeedback>>({});
  const [hints, setHints] = useState<Record<number, string[]>>({});
  const [hintRemaining, setHintRemaining] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<ExecResponse | null>(null);
  const [sqlResult, setSqlResult] = useState<SqlRunResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<SessionData>(`/api/sessions/${sessionId}`);
      setData(res);
      const restored: Record<number, unknown> = {};
      const fb: Record<number, CorrectionFeedback> = {};
      for (const it of res.items) {
        if (it.lastAnswer != null) restored[it.questionIdx] = it.lastAnswer;
        if (it.feedback) fb[it.questionIdx] = it.feedback;
      }
      // Les brouillons locaux (non encore validés) priment sur les dernières
      // réponses enregistrées : ils sont plus récents.
      const localDrafts = useAppStore.getState().sessionDrafts[sessionId]?.drafts ?? {};
      setDrafts({ ...restored, ...localDrafts });
      setFeedbacks(fb);
      setExecResult(null);
      setSqlResult(null);
      // Restauration des indices déjà révélés (compteur PAR question côté serveur)
      const revealed: Record<number, string[]> = {};
      const remaining: Record<number, number> = {};
      for (const it of res.items) {
        const qHints = res.questions[it.questionIdx]?.hints ?? [];
        if (it.hintsUsed > 0 && qHints.length > 0) {
          revealed[it.questionIdx] = qHints.slice(0, Math.min(it.hintsUsed, qHints.length));
          remaining[it.questionIdx] = Math.max(0, qHints.length - it.hintsUsed);
        }
      }
      if (Object.keys(revealed).length > 0) {
        setHints((prev) => ({ ...revealed, ...prev }));
        setHintRemaining((prev) => ({ ...remaining, ...prev }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement de la session.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const session = data?.session ?? null;
  const questions = data?.questions ?? [];
  const items = data?.items ?? [];
  const q = questions[current];
  const item = items.find((it) => it.questionIdx === current) ?? null;
  const inProgress = session?.status === "IN_PROGRESS";
  const immediate = inProgress && session?.mode === "apprentissage" && session?.config?.correctionTiming !== "end";
  const hintsAllowed = inProgress && session?.mode !== "examen" && session?.config?.hintsEnabled !== false;
  const feedback = inProgress ? feedbacks[current] : (item?.feedback ?? null);
  const answeredCount = inProgress
    ? questions.reduce((acc, qq, i) => acc + (hasAnswer(qq, drafts[i]) ? 1 : 0), 0)
    : questions.length;
  const isLast = current >= questions.length - 1;
  const feedbackForCurrentExists = feedback != null;

  function setDraft(value: unknown) {
    setDrafts((prev) => {
      const next = { ...prev, [current]: value };
      saveSessionDraft(sessionId, current, next);
      return next;
    });
  }

  function goTo(i: number) {
    const next = Math.max(0, Math.min(i, Math.max(0, questions.length - 1)));
    setCurrent(next);
    saveSessionDraft(sessionId, next, drafts);
    setExecResult(null);
    setSqlResult(null);
  }

  async function validateAnswer() {
    if (!session || !q) return;
    setSaving(true);
    try {
      const res = await api.post<{ ok: boolean; graded: boolean; feedback: CorrectionFeedback | null }>(
        `/api/sessions/${session.id}/answer`,
        { questionIdx: current, value: drafts[current] ?? null }
      );
      if (res.graded && res.feedback) {
        setFeedbacks((prev) => ({ ...prev, [current]: res.feedback as CorrectionFeedback }));
        const v = res.feedback.verdict;
        toast({
          title: v === "correct" ? "Réponse correcte" : v === "partial" ? "Réponse partiellement correcte" : "Réponse incorrecte",
          description: immediate ? "Vous pouvez améliorer votre réponse puis revalider." : undefined,
        });
      } else {
        toast({ title: "Réponse enregistrée", description: "Elle sera corrigée à la fin de la session." });
        if (!isLast) goTo(current + 1);
      }
    } catch (e) {
      toast({ title: "Échec de l'enregistrement", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function askHint() {
    if (!session || !q) return;
    try {
      const res = await api.post<{ hint: string | null; message?: string; remaining?: number }>(
        `/api/sessions/${session.id}/hint`,
        { questionIdx: current }
      );
      if (res.hint) {
        setHints((prev) => ({ ...prev, [current]: [...(prev[current] ?? []), res.hint as string] }));
        setHintRemaining((prev) => ({ ...prev, [current]: res.remaining ?? 0 }));
      } else {
        toast({ title: res.message ?? "Aucun indice disponible pour cette question." });
      }
    } catch (e) {
      toast({ title: "Indice indisponible", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  }

  async function runCode() {
    if (!q) return;
    const currentDraft: unknown = drafts[current];
    const code = typeof currentDraft === "string" ? currentDraft : String(defaultDraft(q) ?? "");
    if (!code.trim()) return;
    setExecuting(true);
    setExecResult(null);
    try {
      const res = await api.post<ExecResponse>("/api/execute", {
        language: q.language ?? "python",
        code,
      });
      setExecResult(res);
    } catch (e) {
      toast({ title: "Exécution impossible", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setExecuting(false);
    }
  }

  async function runSql() {
    if (!q) return;
    const currentDraft: unknown = drafts[current];
    const sqlText = typeof currentDraft === "string" ? currentDraft : String(defaultDraft(q) ?? "");
    if (!sqlText.trim()) return;
    setExecuting(true);
    setSqlResult(null);
    try {
      const res = await api.post<SqlRunResponse>("/api/sql/run", {
        sql: sqlText,
        setupSql: q.fixtureSql ?? undefined,
      });
      setSqlResult(res);
    } catch (e) {
      toast({ title: "Exécution impossible", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setExecuting(false);
    }
  }

  async function submitAll() {
    setSubmitting(true);
    try {
      await api.post(`/api/sessions/${sessionId}/submit`);
      toast({ title: "Session soumise", description: "Voici votre compte rendu détaillé." });
      clearSessionDraft(sessionId);
      await load();
      setCurrent(0);
    } catch (e) {
      toast({ title: "Échec de la soumission", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Rendu : chargement / erreur ──
  if (loading) {
    return (
      <section className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8" aria-label="Session en cours de chargement">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </section>
    );
  }
  if (error || !session) {
    return (
      <section className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6 lg:py-8" aria-label="Erreur">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden />
          <AlertTitle>Session indisponible</AlertTitle>
          <AlertDescription>{error ?? "Session introuvable."}</AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()}>
            Réessayer
          </Button>
          <Button variant="ghost" onClick={onExit}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> Retour
          </Button>
        </div>
      </section>
    );
  }

  // ── Rapport final (session corrigée) ──
  if (!inProgress) {
    return <SessionReport data={data as SessionData} onExit={onExit} />;
  }

  if (!q) {
    return (
      <section className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6 lg:py-8" aria-label="Session vide">
        <Alert>
          <Info className="h-4 w-4" aria-hidden />
          <AlertTitle>Session sans question</AlertTitle>
          <AlertDescription>Cette session ne contient aucune question exploitable.</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={onExit}>
          <ArrowLeft className="h-4 w-4" aria-hidden /> Retour au tableau de bord
        </Button>
      </section>
    );
  }

  const draft = drafts[current] ?? defaultDraft(q);
  const revealedHints = hints[current] ?? [];
  const remainingHints = hintRemaining[current] ?? Math.max(0, (q.hints ?? []).length);
  const isCodeType = CODE_TYPES.includes(q.type);
  const isSqlType = SQL_TYPES.includes(q.type);

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8" aria-labelledby="session-title">
      {/* ── En-tête ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onExit} aria-label="Quitter la session">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
          <div className="min-w-0">
            <h1 id="session-title" className="typo-h1 truncate">
              {session.title}
            </h1>
            <p className="typo-meta">
              {MODE_LABELS[session.mode] ?? session.mode} · Question {current + 1} sur {questions.length}
              {session.config?.durationMin ? ` · durée conseillée ${session.config.durationMin} min` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {immediate && <Badge variant="secondary" className="gap-1"><Lightbulb className="h-3 w-3" aria-hidden /> Correction immédiate</Badge>}
          {session.mode === "examen" && <Badge variant="destructive">Examen</Badge>}
        </div>
      </div>

      {/* ── Progression + navigation ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Progress value={questions.length ? (answeredCount / questions.length) * 100 : 0} className="h-2" />
          <span className="tnum shrink-0 text-xs font-medium text-muted-foreground">
            {answeredCount}/{questions.length} répondu(s)
          </span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Navigation entre les questions">
          {questions.map((qq, i) => {
            const answered = hasAnswer(qq, drafts[i]);
            const fb = feedbacks[i];
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === current}
                aria-label={`Question ${i + 1}${answered ? " (répondue)" : ""}`}
                onClick={() => goTo(i)}
                className={cn(
                  "tnum flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  i === current
                    ? "border-primary bg-primary text-primary-foreground"
                    : answered
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted"
                )}
              >
                {fb ? (
                  fb.verdict === "correct" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  ) : fb.verdict === "partial" ? (
                    <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
                  ) : fb.verdict === "skipped" ? (
                    <MinusCircle className="h-4 w-4" aria-hidden />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" aria-hidden />
                  )
                ) : (
                  i + 1
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Question ── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{QUESTION_TYPE_LABELS[q.type] ?? q.type}</Badge>
            <Badge variant="secondary" className="tnum">{q.points} pt(s)</Badge>
            {q.notions?.map((n) => (
              <Badge key={n} variant="outline" className="text-muted-foreground">{n}</Badge>
            ))}
          </div>
          <CardTitle className="whitespace-pre-wrap text-base font-semibold leading-relaxed sm:text-lg">
            {q.statement}
          </CardTitle>
          {q.instructions && <p className="typo-subtitle whitespace-pre-wrap">{q.instructions}</p>}
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Saisie de la réponse */}
          <div key={current}>
            {(q.type === "qcm_single" || q.type === "true_false" || q.type === "matching" || q.type === "ordering") && (
              <p className="mb-3 text-sm font-medium">Sélectionnez votre réponse :</p>
            )}
            {(q.type === "qcm_single" || q.type === "qcm_multiple") && (
              <div className="space-y-3">
                {q.options && q.options.length > 0 ? (
                  q.type === "qcm_single" ? (
                    <QcmSingleInput q={q} value={draft} onChange={setDraft} />
                  ) : (
                    <QcmMultipleInput q={q} value={draft} onChange={setDraft} />
                  )
                ) : (
                  <p className="typo-subtitle">Aucune option disponible pour cette question.</p>
                )}
              </div>
            )}
            {q.type === "true_false" && <TrueFalseInput value={draft} onChange={setDraft} />}
            {q.type === "fill_blank" && <FillBlankInput q={q} value={draft} onChange={setDraft} />}
            {q.type === "short_answer" && (
              <div className="space-y-1.5">
                <Label htmlFor="short-answer">Votre réponse</Label>
                <Input
                  id="short-answer"
                  value={typeof draft === "string" ? draft : ""}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Saisissez votre réponse…"
                  autoComplete="off"
                />
              </div>
            )}
            {(q.type === "open_question" || q.type === "case_study" || q.type === "data_modeling" || q.type === "combined" || q.type === "exam_composite") && (
              <div className="space-y-1.5">
                <Label htmlFor="open-answer">Votre réponse détaillée</Label>
                <Textarea
                  id="open-answer"
                  rows={7}
                  value={typeof draft === "string" ? draft : ""}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Rédigez votre réponse en vous appuyant sur le cours…"
                  className="leading-relaxed"
                />
              </div>
            )}
            {q.type === "matching" && <MatchingInput q={q} value={draft} onChange={setDraft} />}
            {q.type === "ordering" && <OrderedListInput q={q} value={draft} onChange={setDraft} />}
            {q.type === "error_identification" && <ErrorIdentificationInput q={q} value={draft} onChange={setDraft} />}
            {q.type === "code_output" && (
              <div className="space-y-3">
                {q.starterCode && (
                  <div className="space-y-1">
                    <p className="typo-meta font-medium uppercase tracking-wide">Programme ({q.language ?? "python"})</p>
                    <pre className="font-code max-h-60 overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">{q.starterCode}</pre>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="code-output">Sortie affichée par ce programme</Label>
                  <Textarea
                    id="code-output"
                    rows={4}
                    value={typeof draft === "string" ? draft : ""}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Écrivez la sortie exacte du programme…"
                    className="font-code text-xs"
                  />
                </div>
              </div>
            )}
            {isCodeType && q.type !== "code_output" && (
              <div className="space-y-3">
                <CodeMirrorField
                  value={typeof draft === "string" ? draft : ""}
                  language={q.language}
                  isSql={false}
                  onChange={setDraft}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => void runCode()} disabled={executing} className="gap-2 font-medium">
                  {executing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                  Exécuter le code
                </Button>
                {execResult && (
                  <div className="space-y-1.5 rounded-md border bg-muted/30 p-3">
                    <p className="typo-meta font-medium uppercase tracking-wide">
                      Console {execResult.ok ? "— exécution réussie" : "— échec d'exécution"} ({execResult.durationMs} ms)
                    </p>
                    {execResult.stdout && <pre className="font-code max-h-48 overflow-auto whitespace-pre-wrap text-xs">{execResult.stdout}</pre>}
                    {execResult.stderr && <pre className="font-code max-h-48 overflow-auto whitespace-pre-wrap text-xs text-destructive">{execResult.stderr}</pre>}
                    {!execResult.stdout && !execResult.stderr && <p className="typo-meta">Aucune sortie.</p>}
                    {execResult.note && <p className="typo-meta">{execResult.note}</p>}
                  </div>
                )}
              </div>
            )}
            {isSqlType && (
              <div className="space-y-3">
                {q.fixtureSql && q.fixtureSql.trim() !== "SELECT 1;" && (
                  <Alert>
                    <Info className="h-4 w-4" aria-hidden />
                    <AlertTitle className="text-sm font-semibold">Environnement de test fourni</AlertTitle>
                    <AlertDescription className="text-xs leading-relaxed">
                      Un schéma pré-rempli est chargé avant votre requête (ne le reproduisez pas dans votre réponse). Le bouton
                      « Exécuter » vous permet de tester dans cet environnement isolé.
                    </AlertDescription>
                  </Alert>
                )}
                <CodeMirrorField
                  value={typeof draft === "string" ? draft : ""}
                  language="sql"
                  isSql
                  onChange={setDraft}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => void runSql()} disabled={executing} className="gap-2 font-medium">
                  {executing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                  Exécuter la requête
                </Button>
                {sqlResult && (
                  <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                    <p className="typo-meta font-medium uppercase tracking-wide">Résultat ({sqlResult.durationMs} ms)</p>
                    {sqlResult.statements.map((st, i) => (
                      <div key={i} className="space-y-1">
                        {st.error ? (
                          <p className="text-xs font-medium text-destructive">Erreur : {st.error}</p>
                        ) : st.rows ? (
                          <div className="max-h-56 overflow-auto rounded border">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-muted/50">
                                <tr>
                                  {(st.columns ?? []).map((c) => (
                                    <th key={c} className="font-code whitespace-nowrap px-2 py-1.5 font-semibold">
                                      {c}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {st.rows.slice(0, 50).map((row, ri) => (
                                  <tr key={ri} className="border-t">
                                    {(st.columns ?? []).map((c) => (
                                      <td key={c} className="font-code whitespace-nowrap px-2 py-1.5">
                                        {String(row[c] ?? "")}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="typo-meta">Instruction exécutée{st.changes != null ? ` (${st.changes} ligne(s))` : ""}.</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Indices */}
          {hintsAllowed && (q.hints?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void askHint()} className="gap-2 font-medium">
                <Lightbulb className="h-4 w-4" aria-hidden />
                Indice {revealedHints.length + 1}/{q.hints?.length}
              </Button>
              {revealedHints.length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                  {revealedHints.map((h, i) => (
                    <p key={i} className="text-sm leading-relaxed">
                      <span className="font-semibold">Indice {i + 1} :</span> {h}
                    </p>
                  ))}
                  {remainingHints > 0 && <p className="typo-meta">{remainingHints} indice(s) restant(s).</p>}
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* Correction immédiate */}
          {feedbackForCurrentExists && item && (
            <FeedbackPanel question={q} maxPoints={item.maxPoints} feedback={feedback as CorrectionFeedback} />
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => goTo(current - 1)} disabled={current === 0} className="gap-1.5 font-medium">
              <ArrowLeft className="h-4 w-4" aria-hidden /> Précédente
            </Button>

            {immediate ? (
              <>
                <Button onClick={() => void validateAnswer()} disabled={saving} className="gap-2 font-semibold">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                  {saving ? "Correction en cours…" : feedbackForCurrentExists ? "Revalider ma réponse" : "Valider ma réponse"}
                </Button>
                {!isLast && (
                  <Button variant="outline" onClick={() => goTo(current + 1)} className="gap-1.5 font-medium">
                    Suivante <ArrowRight className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </>
            ) : (
              <Button onClick={() => void validateAnswer()} disabled={saving} className="gap-2 font-semibold">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                {saving ? "Enregistrement…" : isLast ? "Enregistrer et terminer" : "Enregistrer la réponse"}
              </Button>
            )}

            <div className="ms-auto">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="default" className="gap-2 font-semibold" disabled={submitting}>
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ListChecks className="h-4 w-4" aria-hidden />}
                    Terminer et corriger
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Soumettre la session ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {answeredCount}/{questions.length} question(s) ont une réponse. Les questions sans réponse seront
                      comptées comme échouées. La correction est définitive.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Continuer à travailler</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void submitAll()} className="font-semibold">
                      Corriger maintenant
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// ── Rapport final ────────────────────────────────────────────────────────────

function formatAnswerValue(q: Question, value: unknown): string {
  if (value == null) return "(aucune réponse)";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v, i) => `${i + 1}. ${String(v)}`).join("\n");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (q.type === "matching") return Object.entries(obj).map(([k, v]) => `${k} → ${String(v)}`).join("\n");
    if (q.type === "error_identification")
      return `Ligne : ${String(obj.line ?? "?")}\nExplication : ${String(obj.explanation ?? "?")}`;
    return Object.entries(obj).map(([k, v]) => `${k} : ${String(v)}`).join("\n");
  }
  return String(value);
}

function SessionReport({ data, onExit }: { data: SessionData; onExit: () => void }) {
  const { session, questions, items } = data;
  const summary = session.summary;
  const durationMin = session.durationSec != null ? Math.max(1, Math.round(session.durationSec / 60)) : null;

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8" aria-labelledby="report-title">
      {/* Note */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 id="report-title" className="typo-h1 truncate">
                {session.title}
              </h1>
              <p className="typo-meta">
                {MODE_LABELS[session.mode] ?? session.mode}
                {durationMin ? ` · ${durationMin} min` : ""}
                {session.finishedAt
                  ? ` · corrigée le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.finishedAt))}`
                  : ""}
              </p>
            </div>
            <Badge variant="secondary">Session corrigée</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <p className="typo-display tnum leading-none">{session.percentage != null ? `${session.percentage} %` : "—"}</p>
              <p className="typo-subtitle mt-1">
                Note : <span className="tnum font-semibold">{session.score ?? "—"}</span> / <span className="tnum">{session.maxScore ?? "—"}</span> points
              </p>
            </div>
            {summary && (
              <div className="max-w-xl flex-1 space-y-2">
                <p className="text-sm leading-relaxed">{summary.comment}</p>
                {summary.strengths.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {summary.strengths.map((s) => (
                      <Badge key={s} className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                        Acquis : {s}
                      </Badge>
                    ))}
                  </div>
                )}
                {summary.toReview.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {summary.toReview.map((s) => (
                      <Badge key={s} variant="destructive">
                        À revoir : {s}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {summary && summary.byNotion.length > 0 && (
            <div className="space-y-2">
              <p className="typo-h3">Maîtrise par notion</p>
              {summary.byNotion.map((n) => (
                <div key={n.notion} className="flex items-center gap-3">
                  <span className="w-40 truncate text-sm font-medium" title={n.notion}>
                    {n.notion}
                  </span>
                  <Progress value={(n.correct / Math.max(1, n.total)) * 100} className="h-2 flex-1" />
                  <span className="tnum shrink-0 text-xs font-semibold text-muted-foreground">
                    {n.correct}/{n.total}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onExit} className="gap-2 font-medium">
              <ArrowLeft className="h-4 w-4" aria-hidden /> Retour au tableau de bord
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Corrections détaillées */}
      <div className="space-y-4">
        <h2 className="typo-h2">Corrections détaillées</h2>
        {questions.map((qq, i) => {
          const it = items.find((x) => x.questionIdx === i);
          const fb = it?.feedback ?? null;
          const verdict = fb ? VERDICT_BADGE[fb.verdict] ?? VERDICT_BADGE.skipped : null;
          const mono =
            CODE_TYPES.includes(qq.type) || SQL_TYPES.includes(qq.type) || qq.type === "code_output";
          return (
            <Card key={i}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tnum flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold">{i + 1}</span>
                  <Badge variant="outline">{QUESTION_TYPE_LABELS[qq.type] ?? qq.type}</Badge>
                  {verdict && <Badge className={verdict.className}>{verdict.label}</Badge>}
                  <Badge variant="secondary" className="tnum">
                    {it?.points ?? 0} / {it?.maxPoints ?? qq.points} pt(s)
                  </Badge>
                </div>
                <CardTitle className="whitespace-pre-wrap text-base font-semibold leading-relaxed">{qq.statement}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <p className="typo-meta font-medium uppercase tracking-wide">Votre réponse</p>
                  {mono ? (
                    <pre className="font-code max-h-56 overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
                      {formatAnswerValue(qq, it?.lastAnswer)}
                    </pre>
                  ) : (
                    <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm leading-relaxed">
                      {formatAnswerValue(qq, it?.lastAnswer)}
                    </p>
                  )}
                </div>

                {fb && <FeedbackPanel question={qq} maxPoints={it?.maxPoints ?? qq.points} feedback={fb} />}

                {qq.explanation && !fb && (
                  <div className="space-y-1">
                    <p className="typo-meta font-medium uppercase tracking-wide">Explication</p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{qq.explanation}</p>
                  </div>
                )}

                {(qq.solutionCode || qq.referenceSql) && (
                  <div className="space-y-1">
                    <p className="typo-meta font-medium uppercase tracking-wide">Solution</p>
                    <pre className="font-code max-h-56 overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
                      {qq.solutionCode ?? qq.referenceSql}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
