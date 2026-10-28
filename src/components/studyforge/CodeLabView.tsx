"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CodeLabView — Éditeur de code libre de StudyForge AI.
// - Exécution réelle via POST /api/execute (processus enfant isolé côté serveur)
// - Langages non exécutables : annoncés honnêtement (correction par IA)
// - Historique local de la session (10 dernières exécutions)
// - Raccourci clavier : Ctrl/Cmd + Entrée
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Loader2, Play, Terminal, XCircle } from "lucide-react";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";

// ── Types de l'API ───────────────────────────────────────────────────────────

interface ApiLanguage {
  id: string;
  label: string;
  executable: boolean;
}

interface LangsResponse {
  languages: ApiLanguage[];
  note: string;
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

interface HistoryItem {
  id: string;
  languageLabel: string;
  ok: boolean;
  durationMs: number;
  at: Date;
}

interface LanguageDef {
  id: string;
  label: string;
  ext: Extension | null;
  skeleton: string;
}

interface LanguageOption extends LanguageDef {
  executable: boolean;
}

// ── Catalogue de langages (extensions CodeMirror + squelettes) ──────────────

const LANGUAGES: LanguageDef[] = [
  {
    id: "javascript",
    label: "JavaScript (Node.js)",
    ext: javascript(),
    skeleton: `// Écrivez votre code JavaScript\nconsole.log("Bonjour StudyForge !");`,
  },
  {
    id: "typescript",
    label: "TypeScript (transpilé)",
    ext: javascript({ typescript: true }),
    skeleton: `// Écrivez votre code TypeScript\nconst message: string = "Bonjour StudyForge !";\nconsole.log(message);`,
  },
  {
    id: "python",
    label: "Python 3",
    ext: python(),
    skeleton: `# Écrivez votre code Python\nprint("Bonjour StudyForge !")`,
  },
  {
    id: "java",
    label: "Java",
    ext: java(),
    skeleton: `// Écrivez votre code Java\nclass Main {\n    public static void main(String[] args) {\n        System.out.println("Bonjour StudyForge !");\n    }\n}`,
  },
  {
    id: "c",
    label: "C",
    ext: cpp(),
    skeleton: `#include <stdio.h>\n\nint main(void) {\n    printf("Bonjour StudyForge !\\n");\n    return 0;\n}`,
  },
  {
    id: "cpp",
    label: "C++",
    ext: cpp(),
    skeleton: `#include <iostream>\n\nint main() {\n    std::cout << "Bonjour StudyForge !" << std::endl;\n    return 0;\n}`,
  },
  {
    id: "csharp",
    label: "C#",
    ext: cpp(),
    skeleton: `// Écrivez votre code C#\nusing System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Bonjour StudyForge !");\n    }\n}`,
  },
  {
    id: "sql",
    label: "SQL (SQLite)",
    ext: sqlLang(),
    skeleton: `-- Écrivez votre requête SQL\nSELECT 'Bonjour StudyForge !' AS message;`,
  },
  {
    id: "html",
    label: "HTML",
    ext: html(),
    skeleton: `<!-- Écrivez votre HTML -->\n<h1>Bonjour StudyForge !</h1>`,
  },
  {
    id: "css",
    label: "CSS",
    ext: css(),
    skeleton: `/* Écrivez votre CSS */\nbody {\n  font-family: sans-serif;\n}`,
  },
];

function skeletonOf(id: string): string {
  return LANGUAGES.find((l) => l.id === id)?.skeleton ?? `// Écrivez votre code ${id}`;
}

// Compteur local pour des identifiants d'historique uniques
let uidCounter = 0;
function nextId(): string {
  uidCounter += 1;
  return `run-${Date.now()}-${uidCounter}`;
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

export default function CodeLabView() {
  const isDark = useIsDarkTheme();

  // Code PERSISTÉ dans le store (localStorage) : quitter l'éditeur ne perd
  // plus le code saisi, quel que soit le langage.
  const storedLang = useAppStore((s) => s.codeLabLang);
  const storedCodeByLang = useAppStore((s) => s.codeLabCode);
  const setStoredLang = useAppStore((s) => s.setCodeLabLang);
  const setStoredCode = useAppStore((s) => s.setCodeLabCode);

  // ── État ──
  const [lang, setLang] = useState(() => (storedCodeByLang[storedLang] !== undefined ? storedLang : "javascript"));
  const [code, setCode] = useState<string>(() => storedCodeByLang[lang] ?? skeletonOf(lang));
  const codeByLangRef = useRef<Record<string, string>>({ ...storedCodeByLang });
  const [apiLanguages, setApiLanguages] = useState<ApiLanguage[] | null>(null);
  const [apiNote, setApiNote] = useState<string | null>(null);
  const [langsError, setLangsError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // ── Chargement de la liste des langages exécutables ──
  useEffect(() => {
    let cancelled = false;
    api
      .get<LangsResponse>("/api/execute")
      .then((res) => {
        if (cancelled) return;
        setApiLanguages(res.languages);
        setApiNote(res.note ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLangsError(err instanceof Error ? err.message : "Impossible de charger la liste des langages.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Fusion catalogue statique + informations d'exécutabilité de l'API ──
  const languages = useMemo<LanguageOption[]>(() => {
    const byApi = new Map((apiLanguages ?? []).map((l) => [l.id, l]));
    const merged: LanguageOption[] = LANGUAGES.map((def) => ({
      ...def,
      label: byApi.get(def.id)?.label ?? def.label,
      executable: byApi.get(def.id)?.executable ?? false,
    }));
    for (const l of apiLanguages ?? []) {
      if (!merged.some((m) => m.id === l.id)) {
        merged.push({ id: l.id, label: l.label, ext: null, skeleton: `// Écrivez votre code ${l.label}\n`, executable: l.executable });
      }
    }
    return merged;
  }, [apiLanguages]);

  const current = useMemo(() => languages.find((l) => l.id === lang) ?? languages[0], [languages, lang]);

  const extensions = useMemo<Extension[]>(() => (current?.ext ? [current.ext] : []), [current]);

  // ── Changement de langage : squelette neuf, code préservé si déjà tapé ──
  function selectLanguage(next: string) {
    if (next === lang || !next) return;
    const untouched = codeByLangRef.current[lang] === code;
    codeByLangRef.current[lang] = code;
    setStoredCode(lang, code);
    const stored = codeByLangRef.current[next];
    if (stored !== undefined && !untouched) {
      // Retour sur un langage déjà visité : restauration de son contenu.
      setCode(stored);
    } else if (!untouched && code.trim().length > 10) {
      // L'utilisateur a déjà tapé plus de 10 caractères : on préserve son code.
      codeByLangRef.current[next] = code;
    } else {
      // Sinon : squelette du nouveau langage.
      const sk = skeletonOf(next);
      codeByLangRef.current[next] = sk;
      setCode(sk);
    }
    setStoredCode(next, codeByLangRef.current[next]);
    setLang(next);
    setStoredLang(next);
  }

  // ── Exécution du code ──
  const runCode = useCallback(async () => {
    if (running || !code.trim()) return;
    setRunning(true);
    setRunError(null);
    try {
      const res = await api.post<ExecResponse>("/api/execute", { language: lang, code });
      setResult(res);
      setHistory((h) =>
        [{ id: nextId(), languageLabel: current?.label ?? lang, ok: res.ok, durationMs: res.durationMs, at: new Date() }, ...h].slice(0, 10),
      );
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : "Une erreur réseau est survenue pendant l'exécution.");
    } finally {
      setRunning(false);
    }
  }, [running, code, lang, current]);

  // ── Raccourci clavier : Ctrl/Cmd + Entrée ──
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void runCode();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runCode]);

  return (
    <section aria-labelledby="codelab-title" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      {/* ── En-tête ── */}
      <header className="mb-6 flex items-start gap-3">
        <div className="mt-1 hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground sm:flex">
          <Terminal className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 id="codelab-title" className="typo-h1">
            Éditeur de code
          </h1>
          <p className="typo-subtitle mt-1 max-w-2xl">
            Écrivez librement votre code et exécutez-le : JavaScript, TypeScript et Python tournent réellement côté serveur
            dans un processus isolé. Les autres langages sont pris en charge par la correction IA.
          </p>
        </div>
      </header>

      {langsError && (
        <Alert variant="destructive" className="mb-4">
          <XCircle aria-hidden />
          <AlertTitle>Liste des langages indisponible</AlertTitle>
          <AlertDescription>{langsError}</AlertDescription>
        </Alert>
      )}

      {/* ── Éditeur ── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full space-y-1.5 sm:max-w-xs">
              <Label htmlFor="codelab-language">Langage</Label>
              <Select value={lang} onValueChange={selectLanguage}>
                <SelectTrigger id="codelab-language" className="h-11 w-full" aria-label="Choisir le langage">
                  <SelectValue placeholder="Choisir un langage" />
                </SelectTrigger>
                <SelectContent>
                  {languages.map((l) => (
                    <SelectItem key={l.id} value={l.id} className="min-h-11">
                      <span className="flex items-center gap-2">
                        <span className="truncate">{l.label}</span>
                        {!l.executable && (
                          <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                            correction IA
                          </Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-1.5 sm:flex" aria-hidden>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-code text-[10px]">Ctrl</kbd>
                <span className="typo-meta">+</span>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-code text-[10px]">Entrée</kbd>
              </span>
              <Button onClick={() => void runCode()} disabled={running || !code.trim()} className="h-11 min-w-[7.5rem] gap-2 font-semibold">
                {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                {running ? "Exécution…" : "Exécuter"}
              </Button>
            </div>
          </div>

          {/* Note pour les langages non exécutables + note de l'API */}
          {current && !current.executable && (
            <div className="mt-3 rounded-lg border border-dashed bg-muted/50 px-3 py-2.5">
              <p className="typo-meta leading-relaxed">
                <Badge variant="outline" className="mr-1.5 px-1.5 py-0 text-[10px]">
                  correction IA
                </Badge>
                L&apos;exécution réelle n&apos;est pas disponible pour ce langage. Utilisez le bouton Exécuter pour vérifier :
                un message l&apos;indiquera honnêtement.
              </p>
            </div>
          )}
          {apiNote && <p className="typo-meta mt-3 leading-relaxed">{apiNote}</p>}
        </CardHeader>

        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <CodeMirror
              value={code}
              onChange={(value: string) => {
                setCode(value);
                codeByLangRef.current[lang] = value;
                setStoredCode(lang, value);
              }}
              height="340px"
              theme={isDark ? oneDark : "light"}
              extensions={extensions}
              aria-label="Éditeur de code"
              placeholder="// Écrivez votre code ici…"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Console de sortie ── */}
      <Card className="mt-4">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="typo-h3">Console de sortie</CardTitle>
            {result?.timedOut && (
              <Badge variant="outline" className="text-destructive">
                Délai dépassé
              </Badge>
            )}
            {result?.note && <Badge variant="outline">limitation</Badge>}
          </div>
          <CardDescription>
            Sortie standard, erreurs et métadonnées de la dernière exécution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div aria-live="polite">
            <pre className="font-code max-h-64 overflow-x-auto overflow-y-auto rounded-lg bg-muted p-4 text-[13px] leading-relaxed">
              {result ? (
                result.stdout || result.stderr ? (
                  <>
                    {result.stdout && <span className="whitespace-pre-wrap">{result.stdout}</span>}
                    {result.stderr && (
                      <span className={`block whitespace-pre-wrap text-destructive ${result.stdout ? "mt-2" : ""}`}>{result.stderr}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">(aucune sortie produite)</span>
                )
              ) : (
                <span className="text-muted-foreground">La sortie de l&apos;exécution apparaîtra ici.</span>
              )}
            </pre>
          </div>

          {result && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="typo-meta tnum">Durée : {result.durationMs} ms</span>
              <span className="typo-meta tnum">Code de sortie : {result.exitCode ?? "—"}</span>
              <Badge variant={result.ok ? "outline" : "destructive"} className="text-[10px]">
                {result.ok ? "Succès" : "Échec"}
              </Badge>
            </div>
          )}
          {result?.note && <p className="typo-meta leading-relaxed">{result.note}</p>}
          {runError && (
            <Alert variant="destructive">
              <XCircle aria-hidden />
              <AlertTitle>Erreur réseau</AlertTitle>
              <AlertDescription>{runError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* ── Historique de la session ── */}
      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="typo-h3">Historique des exécutions</CardTitle>
          <CardDescription>Les 10 dernières exécutions de cette session, la plus récente en premier.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="typo-meta">Aucune exécution pour le moment. Lancez votre code avec le bouton Exécuter ou Ctrl+Entrée.</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    {h.ok ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" aria-hidden />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
                    )}
                    <span className="truncate text-sm font-medium">{h.languageLabel}</span>
                    <Badge variant="outline" className="hidden shrink-0 px-1.5 py-0 text-[10px] sm:inline-flex">
                      {h.ok ? "réussi" : "erreur"}
                    </Badge>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="typo-meta tnum">{h.durationMs} ms</span>
                    <span className="typo-meta tnum hidden sm:inline">{h.at.toLocaleTimeString("fr-FR")}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
