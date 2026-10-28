"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SqlLabView — Laboratoire SQL de StudyForge AI.
// - Chaque exécution crée une base SQLite EN MÉMOIRE isolée côté serveur
//   (la base applicative n'est jamais touchée).
// - Jeux de données (fixtures), introspection du schéma, résultats par
//   instruction, historique local de session (15 requêtes).
// - Raccourci clavier : Ctrl/Cmd + Entrée.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client-api";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  HelpCircle,
  Loader2,
  Play,
  RotateCcw,
  ShieldAlert,
  Table2,
  XCircle,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { sql as sqlLanguage } from "@codemirror/lang-sql";

// ── Types de l'API ───────────────────────────────────────────────────────────

interface Fixture {
  id: string;
  label: string;
  description: string;
}

type StatementKind = "select" | "write" | "ddl" | "pragma" | "other";

interface SqlStatementResult {
  sql: string;
  kind: StatementKind;
  rows?: Record<string, unknown>[];
  columns?: string[];
  error?: string;
}

interface SqlRunResponse {
  ok: boolean;
  statements: SqlStatementResult[];
  error?: string;
  durationMs: number;
}

interface SchemaRow {
  table_name: string;
  column_name: string;
  type: string;
  pk: number;
}

interface HistoryItem {
  id: string;
  sql: string;
  ok: boolean;
  at: Date;
}

// ── Constantes ───────────────────────────────────────────────────────────────

const DEFAULT_FIXTURE = "bibliotheque";
const INITIAL_SQL = `-- Écrivez vos requêtes SQL ici, puis Ctrl+Entrée pour exécuter.\nSELECT 1 AS essai;`;
const PLACEHOLDER_SQL = "-- Écrivez votre requête SQL ici…";

const KIND_LABELS: Record<StatementKind, string> = {
  select: "SELECT",
  write: "écriture",
  ddl: "DDL",
  pragma: "PRAGMA",
  other: "autre",
};

/** Introspection du schéma en une seule requête (fonction table pragma_table_info). */
const SCHEMA_QUERY =
  "SELECT m.name AS table_name, p.name AS column_name, p.type, p.pk " +
  "FROM sqlite_master m JOIN pragma_table_info(m.name) p " +
  "WHERE m.type='table' ORDER BY m.name;";

const SQL_NOTIONS = [
  "SELECT, DISTINCT, alias",
  "WHERE, AND / OR, IN, LIKE",
  "ORDER BY, LIMIT, OFFSET",
  "GROUP BY, HAVING",
  "Jointures INNER / LEFT / CROSS",
  "Sous-requêtes, CTE (WITH)",
  "Agrégats COUNT, SUM, AVG, MIN, MAX",
  "CREATE TABLE, ALTER, DROP",
  "INSERT, UPDATE, DELETE",
  "Contraintes PK, FK, UNIQUE, CHECK",
  "Vues (CREATE VIEW)",
  "PRAGMA (lecture)",
];

let uidCounter = 0;
function nextId(): string {
  uidCounter += 1;
  return `sql-${Date.now()}-${uidCounter}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function formatValue(v: unknown): { text: string; isNull: boolean } {
  if (v === null || v === undefined) return { text: "NULL", isNull: true };
  if (typeof v === "object") {
    if (v instanceof Uint8Array) return { text: "<BLOB>", isNull: false };
    return { text: JSON.stringify(v), isNull: false };
  }
  return { text: String(v), isNull: false };
}

/** Détecte le thème sombre (classe .dark sur <html>) sans dépendre d'un provider. */
function useIsDarkTheme(): boolean {
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

// ── Table de résultats pour une instruction SELECT ──────────────────────────

function RowsTable({ rows, columns }: { rows: Record<string, unknown>[]; columns: string[] }) {
  const shown = rows.slice(0, 50);
  return (
    <div className="space-y-1.5">
      <div className="max-h-72 overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((c, i) => (
                <TableHead key={`${c}-${i}`} className="font-code text-[11.5px] whitespace-nowrap">
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row, ri) => (
              <TableRow key={ri}>
                {columns.map((c, ci) => {
                  const { text, isNull } = formatValue(row[c]);
                  return (
                    <TableCell key={`${c}-${ci}`} className="font-code max-w-[22rem] truncate text-[12px]">
                      {isNull ? <span className="italic text-muted-foreground">{text}</span> : text}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="typo-meta tnum">
        {rows.length} ligne{rows.length > 1 ? "s" : ""}
        {rows.length > 50 ? " · 50 affichées" : ""}
      </p>
    </div>
  );
}

// ── Résultat d'une instruction individuelle ─────────────────────────────────

function StatementBlock({ st }: { st: SqlStatementResult }) {
  const columns = st.columns ?? (st.rows && st.rows.length > 0 ? Object.keys(st.rows[0]) : []);
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-code px-1.5 py-0 text-[10px] uppercase">
          {KIND_LABELS[st.kind] ?? st.kind}
        </Badge>
        {(st.kind === "write" || st.kind === "ddl") && !st.error && (
          <Badge variant="outline" className="text-emerald-700 dark:text-emerald-400">
            OK — instruction exécutée
          </Badge>
        )}
        <span className="typo-meta min-w-0 flex-1 truncate font-code" title={st.sql}>
          {truncate(st.sql, 100)}
        </span>
      </div>

      {st.error ? (
        <Alert variant="destructive">
          <XCircle aria-hidden />
          <AlertTitle>Erreur SQL</AlertTitle>
          <AlertDescription>{st.error}</AlertDescription>
        </Alert>
      ) : st.rows && st.rows.length > 0 ? (
        <RowsTable rows={st.rows} columns={columns} />
      ) : st.kind === "select" ? (
        <p className="typo-meta">Aucune ligne retournée.</p>
      ) : (
        <p className="typo-meta">Instruction exécutée sans jeu de résultats.</p>
      )}
    </div>
  );
}

// ── Vue principale ───────────────────────────────────────────────────────────

export default function SqlLabView() {
  const isDark = useIsDarkTheme();

  // Requête et fixture PERSISTÉES : changer de vue ne perd plus le travail SQL.
  const storedSql = useAppStore((s) => s.sqlLabSql);
  const storedFixture = useAppStore((s) => s.sqlLabFixture);
  const setSqlLab = useAppStore((s) => s.setSqlLab);

  // ── Fixtures ──
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [fixturesError, setFixturesError] = useState<string | null>(null);
  const [fixture, setFixtureState] = useState<string>(storedFixture.trim() ? storedFixture : DEFAULT_FIXTURE);
  function setFixture(value: string) {
    setFixtureState(value);
    setSqlLab({ fixture: value });
  }

  // ── Éditeur & exécution ──
  const [sql, setSqlState] = useState<string>(storedSql.trim() ? storedSql : INITIAL_SQL);
  function setSql(value: string) {
    setSqlState(value);
    setSqlLab({ sql: value });
  }
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SqlRunResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // ── Schéma ──
  const [schemaRows, setSchemaRows] = useState<SchemaRow[] | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  // ── Historique & aide ──
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);

  // ── Chargement des jeux de données ──
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ fixtures: Fixture[] }>("/api/sql/run")
      .then((res) => {
        if (cancelled) return;
        setFixtures(res.fixtures);
        if (res.fixtures.length > 0 && !res.fixtures.some((f) => f.id === DEFAULT_FIXTURE)) {
          setFixture(res.fixtures[0].id);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setFixturesError(err instanceof Error ? err.message : "Impossible de charger les jeux de données.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentFixture = useMemo(
    () => fixtures?.find((f) => f.id === fixture) ?? null,
    [fixtures, fixture],
  );

  // ── Exécution des requêtes ──
  const runSql = useCallback(async () => {
    if (running || !sql.trim()) return;
    setRunning(true);
    setRunError(null);
    try {
      const res = await api.post<SqlRunResponse>("/api/sql/run", { sql, fixture });
      setResult(res);
      setHistory((h) => [{ id: nextId(), sql, ok: res.ok, at: new Date() }, ...h].slice(0, 15));
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : "Une erreur réseau est survenue pendant l'exécution.");
    } finally {
      setRunning(false);
    }
  }, [running, sql, fixture]);

  // ── Raccourci clavier : Ctrl/Cmd + Entrée ──
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void runSql();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runSql]);

  // ── Introspection du schéma (setup du fixture inclus côté serveur) ──
  const loadSchema = useCallback(async () => {
    setSchemaLoading(true);
    setSchemaError(null);
    try {
      const res = await api.post<SqlRunResponse>("/api/sql/run", { sql: SCHEMA_QUERY, fixture });
      const first = res.statements[0];
      if (res.error) {
        setSchemaError(res.error);
        setSchemaRows(null);
      } else if (first?.error) {
        setSchemaError(first.error);
        setSchemaRows(null);
      } else {
        setSchemaRows(((first?.rows ?? []) as unknown) as SchemaRow[]);
      }
    } catch (err: unknown) {
      setSchemaError(err instanceof Error ? err.message : "Impossible de récupérer le schéma.");
      setSchemaRows(null);
    } finally {
      setSchemaLoading(false);
    }
  }, [fixture]);

  // Changement de fixture : si le schéma est déjà affiché, il est actualisé automatiquement.
  useEffect(() => {
    if (schemaRows !== null) void loadSchema();
  }, [loadSchema]);

  const tables = useMemo(() => {
    const map = new Map<string, { name: string; cols: { name: string; type: string; pk: boolean }[] }>();
    for (const r of schemaRows ?? []) {
      const name = String(r.table_name);
      if (!map.has(name)) map.set(name, { name, cols: [] });
      map.get(name)?.cols.push({ name: String(r.column_name), type: String(r.type ?? ""), pk: Number(r.pk) > 0 });
    }
    return Array.from(map.values());
  }, [schemaRows]);

  // ── Actions éditeur ──
  function insertTableQuery(table: string) {
    const q = `SELECT * FROM "${table}" LIMIT 20;`;
    setSql(sql.trim() ? `${sql.trimEnd()}\n${q}` : q);
  }

  return (
    <section aria-labelledby="sqllab-title" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      {/* ── En-tête ── */}
      <header className="mb-6 flex items-start gap-3">
        <div className="mt-1 hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground sm:flex">
          <Database className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 id="sqllab-title" className="typo-h1">
            Laboratoire SQL
          </h1>
          <p className="typo-subtitle mt-1 max-w-2xl">
            Chaque exécution s&apos;effectue dans une base SQLite en mémoire ISOLÉE — la base applicative n&apos;est jamais
            touchée.
          </p>
        </div>
      </header>

      {fixturesError && (
        <Alert variant="destructive" className="mb-4">
          <XCircle aria-hidden />
          <AlertTitle>Jeux de données indisponibles</AlertTitle>
          <AlertDescription>{fixturesError}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[330px_minmax(0,1fr)] lg:items-start">
        {/* ── a) Choix du jeu de données ── */}
        <Card className="order-1 lg:col-start-1 lg:row-start-1">
          <CardHeader className="pb-3">
            <CardTitle className="typo-h3">Jeu de données</CardTitle>
            <CardDescription>Environnement reinstallé à chaque exécution.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="sql-fixture" className="sr-only">
              Jeu de données
            </Label>
            <Select value={fixture} onValueChange={setFixture}>
              <SelectTrigger id="sql-fixture" className="h-11 w-full" aria-label="Choisir le jeu de données">
                <SelectValue placeholder="Choisir un jeu de données" />
              </SelectTrigger>
              <SelectContent>
                {(fixtures ?? [{ id: DEFAULT_FIXTURE, label: "Bibliothèque", description: "" }]).map((f) => (
                  <SelectItem key={f.id} value={f.id} className="min-h-11">
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentFixture?.description && <p className="typo-meta leading-relaxed">{currentFixture.description}</p>}
          </CardContent>
        </Card>

        {/* ── Éditeur SQL ── */}
        <Card className="order-2 lg:col-start-2 lg:row-start-1">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="typo-h3">Éditeur SQL</CardTitle>
                <CardDescription>Plusieurs instructions séparées par des points-virgules sont acceptées.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="h-11 gap-2" disabled={running}>
                      <RotateCcw className="h-4 w-4" aria-hidden />
                      Réinitialiser
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Vider l&apos;éditeur ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Le contenu actuel de l&apos;éditeur sera effacé. L&apos;historique de la session est conservé.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction onClick={() => setSql("")}>Réinitialiser</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button onClick={() => void runSql()} disabled={running || !sql.trim()} className="h-11 min-w-[7.5rem] gap-2 font-semibold">
                  {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                  {running ? "Exécution…" : "Exécuter"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="overflow-hidden rounded-lg border">
              <CodeMirror
                value={sql}
                onChange={setSql}
                height="300px"
                theme={isDark ? oneDark : "light"}
                extensions={[sqlLanguage()]}
                aria-label="Éditeur SQL"
                placeholder={PLACEHOLDER_SQL}
              />
            </div>
            <p className="flex items-center gap-1.5" aria-hidden>
              <span className="typo-meta">Raccourci :</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-code text-[10px]">Ctrl</kbd>
              <span className="typo-meta">+</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-code text-[10px]">Entrée</kbd>
            </p>
          </CardContent>
        </Card>

        {/* ── Résultats ── */}
        <Card className="order-3 lg:col-start-2 lg:row-start-2">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="typo-h3">Résultats</CardTitle>
              {result && (
                <span className="flex items-center gap-2">
                  <Badge variant={result.ok ? "outline" : "destructive"} className="text-[10px]">
                    {result.ok ? "Succès" : "Échec"}
                  </Badge>
                  <span className="typo-meta tnum">{result.durationMs} ms</span>
                </span>
              )}
            </div>
            <CardDescription>Un bloc par instruction exécutée, dans l&apos;ordre du script.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {runError && (
              <Alert variant="destructive">
                <XCircle aria-hidden />
                <AlertTitle>Erreur réseau</AlertTitle>
                <AlertDescription>{runError}</AlertDescription>
              </Alert>
            )}

            {!result && !runError && <p className="typo-meta">Les résultats de vos requêtes apparaîtront ici.</p>}

            {result && (
              <>
                {result.error && (
                  <Alert variant="destructive">
                    <XCircle aria-hidden />
                    <AlertTitle>Erreur du script</AlertTitle>
                    <AlertDescription>{result.error}</AlertDescription>
                  </Alert>
                )}
                {result.statements.length === 0 && !result.error && (
                  <p className="typo-meta">Aucune instruction détectée dans le script.</p>
                )}
                {result.statements.map((st, i) => (
                  <StatementBlock key={`${i}-${st.sql.slice(0, 24)}`} st={st} />
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* ── b) Schéma ── */}
        <Card className="order-4 lg:col-start-1 lg:row-start-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="typo-h3">Schéma</CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2"
                onClick={() => {
                  void loadSchema();
                }}
                disabled={schemaLoading}
              >
                {schemaLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Table2 className="h-3.5 w-3.5" aria-hidden />
                )}
                {schemaRows === null ? "Afficher le schéma" : "Actualiser"}
              </Button>
            </div>
            <CardDescription>Tables et colonnes du jeu de données choisi. Cliquez sur une table pour insérer une requête.</CardDescription>
          </CardHeader>
          <CardContent>
            {schemaError && (
              <Alert variant="destructive" className="mb-3">
                <XCircle aria-hidden />
                <AlertTitle>Erreur</AlertTitle>
                <AlertDescription>{schemaError}</AlertDescription>
              </Alert>
            )}
            {schemaRows === null && !schemaError && (
              <p className="typo-meta">Lancez l&apos;introspection pour découvrir les tables disponibles.</p>
            )}
            {schemaRows !== null && tables.length === 0 && !schemaError && (
              <p className="typo-meta">Aucune table dans cette base (jeu de données vide).</p>
            )}
            {tables.length > 0 && (
              <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {tables.map((t) => (
                  <li key={t.name} className="rounded-lg border">
                    <button
                      type="button"
                      onClick={() => insertTableQuery(t.name)}
                      className="flex w-full items-center gap-2 rounded-t-lg px-3 py-2 text-left transition-colors hover:bg-muted/70"
                      title={`Insérer SELECT * FROM ${t.name} LIMIT 20;`}
                    >
                      <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="font-code truncate text-[13px] font-semibold">{t.name}</span>
                      <span className="typo-meta tnum ml-auto shrink-0">
                        {t.cols.length} col.
                      </span>
                    </button>
                    <ul className="border-t px-3 py-2">
                      {t.cols.map((c) => (
                        <li key={c.name} className="flex items-center gap-1.5 py-0.5">
                          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="font-code truncate text-[12px]">{c.name}</span>
                          <span className="typo-meta shrink-0">{c.type}</span>
                          {c.pk && (
                            <Badge variant="outline" className="ml-auto shrink-0 px-1 py-0 text-[9px]">
                              PK
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Historique ── */}
        <Card className="order-5 lg:col-start-1 lg:row-start-3">
          <CardHeader className="pb-3">
            <CardTitle className="typo-h3">Historique de la session</CardTitle>
            <CardDescription>Les 15 dernières requêtes, la plus récente en premier. Cliquez pour restaurer.</CardDescription>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="typo-meta">Aucune requête exécutée pour le moment.</p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => setSql(h.sql)}
                      className="w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/70"
                      title="Restaurer cette requête dans l'éditeur"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-code truncate text-[12px]">{truncate(h.sql.replace(/\s+/g, " "), 64)}</span>
                        {h.ok ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" aria-hidden />
                        ) : (
                          <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
                        )}
                      </span>
                      <span className="typo-meta tnum mt-0.5 block">{h.at.toLocaleTimeString("fr-FR")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Bloc d'aide ── */}
        <Card className="order-6 lg:col-start-2 lg:row-start-3">
          <Collapsible open={helpOpen} onOpenChange={setHelpOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-t-xl px-6 py-4 text-left">
              <span className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span className="typo-h3">Notions SQL prises en charge</span>
              </span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", helpOpen && "rotate-180")} aria-hidden />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-3 pt-0">
                <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                  {SQL_NOTIONS.map((n) => (
                    <li key={n} className="flex items-center gap-1.5">
                      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="typo-meta text-foreground/90">{n}</span>
                    </li>
                  ))}
                </ul>
                <Alert className="border-amber-600/40 text-amber-700 dark:text-amber-400">
                  <ShieldAlert aria-hidden />
                  <AlertTitle>Instructions bloquées</AlertTitle>
                  <AlertDescription className="text-amber-700/90 dark:text-amber-400/90">
                    ATTACH, LOAD EXTENSION et VACUUM INTO sont bloqués.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      </div>
    </section>
  );
}
