"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ChapterReaderView — Vue pleine page style "Notebook" pour lire et analyser
// les documents d'un chapitre.
//
// Layout 3 panneaux (redimensionnables) :
//   [Sidebar doc list] | [Contenu du document (collapsible)] | [IA + Chat]
//
// Fonctionnalités :
//  - Sélection et navigation entre plusieurs documents d'un chapitre
//  - Lecture simultanée multi-docs (onglets comme Google Notebook)
//  - Panneau contenu rétractable via menu burger
//  - Panneau IA : résumé, notions, méthodes, mots-clés extraits par l'analyse
//  - Chat contextuel : porte sur le(s) document(s) sélectionné(s)
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileCode,
  FileText,
  FileType,
  Loader2,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Send,
  Sparkles,
  X,
  XCircle,
  Presentation,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type DocStatus = "PENDING" | "PROCESSING" | "READY" | "ERROR";

interface DocSummary {
  id: string;
  name: string;
  originalName: string;
  type: string;
  size: number;
  status: DocStatus;
  pageCount?: number | null;
  createdAt: string;
  _count: { chunks: number };
}

interface ChapterData {
  id: string;
  name: string;
  description: string | null;
  subject: { id: string; name: string; color: string };
  documents: DocSummary[];
  _count: { documents: number };
}

interface DocChunk {
  id: string;
  section: string | null;
  content: string;
}

interface DocAnalysis {
  summary?: string | null;
  subjectGuess?: string | null;
  notions?: string | null;
  definitions?: string | null;
  methods?: string | null;
  formulas?: string | null;
  pitfalls?: string | null;
  prerequisites?: string | null;
  evaluable?: string | null;
  codeExcerpts?: string | null;
  model?: string | null;
}

interface DocDetail {
  id: string;
  name: string;
  originalName: string;
  type: string;
  size: number;
  status: DocStatus;
  extractedText?: string | null;
  pageCount?: number | null;
  createdAt: string;
  analysis: DocAnalysis | null;
  chunks: DocChunk[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: { document: string; section: string }[] | null;
  createdAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DOC_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  pdf: FileText,
  docx: FileText,
  doc: FileText,
  txt: FileText,
  md: FileCode,
  pptx: Presentation,
  ppt: Presentation,
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

// ── Section Header ────────────────────────────────────────────────────────────

function SectionHeading({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-primary shrink-0" aria-hidden />
      <h2 className="font-semibold text-sm uppercase tracking-wide text-primary">{label}</h2>
    </div>
  );
}

// ── Analysis Panel ────────────────────────────────────────────────────────────

function AnalysisPanel({
  doc,
  onAnalyze,
  analyzing,
}: {
  doc: DocDetail;
  onAnalyze: () => void;
  analyzing: boolean;
}) {
  const a = doc.analysis;

  const sections: { key: keyof DocAnalysis; label: string }[] = [
    { key: "notions", label: "Notions clés" },
    { key: "definitions", label: "Définitions" },
    { key: "methods", label: "Méthodes / Algorithmes" },
    { key: "formulas", label: "Formules" },
    { key: "pitfalls", label: "Points de vigilance" },
    { key: "prerequisites", label: "Prérequis" },
    { key: "evaluable", label: "Points évaluables" },
    { key: "codeExcerpts", label: "Extraits de code" },
  ];

  if (!a) {
    return (
      <div className="flex flex-col items-start gap-3 p-4 rounded-xl border border-dashed">
        <p className="text-sm text-muted-foreground">Ce document n&apos;a pas encore été analysé par l&apos;IA.</p>
        <Button size="sm" onClick={onAnalyze} disabled={analyzing || doc.status !== "READY"}>
          {analyzing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          {analyzing ? "Analyse en cours…" : "Analyser ce document"}
        </Button>
        {doc.status !== "READY" && (
          <p className="text-xs text-amber-600">Le document doit être prêt (status READY) avant analyse.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Résumé */}
      {a.summary && (
        <div className="rounded-lg bg-muted/50 border p-4">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{a.summary}</p>
        </div>
      )}

      {/* Badges meta */}
      <div className="flex flex-wrap gap-2">
        {a.subjectGuess && (
          <Badge variant="secondary" className="text-xs">Matière : {a.subjectGuess}</Badge>
        )}
        {a.model && (
          <Badge variant="outline" className="text-xs font-mono">{a.model}</Badge>
        )}
      </div>

      {/* Sections liste */}
      {sections.map(({ key, label }) => {
        const items = parseJsonArray(a[key] as string | null);
        if (items.length === 0) return null;
        const isCode = key === "codeExcerpts";
        return (
          <div key={key} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
            {isCode ? (
              <div className="space-y-2">
                {items.slice(0, 4).map((code, i) => (
                  <pre key={i} className="overflow-x-auto rounded-lg bg-muted p-3 text-xs font-mono leading-relaxed">
                    {code}
                  </pre>
                ))}
              </div>
            ) : (
              <ul className="space-y-1 pl-4 list-disc text-sm">
                {items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Chat Panel ────────────────────────────────────────────────────────────────

function ChatPanel({ documentIds }: { documentIds: string[] }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Clé de conversation basée sur les IDs sélectionnés (triés)
  const convKey = [...documentIds].sort().join("|");

  useEffect(() => {
    if (documentIds.length === 0) return;
    let cancelled = false;
    setMessages(null);
    setError(null);
    const qs = documentIds.length === 1
      ? `documentId=${encodeURIComponent(documentIds[0])}`
      : `documentIds=${encodeURIComponent(convKey)}`;
    api
      .get<{ messages: ChatMessage[] }>(`/api/chat?${qs}`)
      .then((res) => { if (!cancelled) setMessages(res.messages); })
      .catch((err: unknown) => { if (!cancelled) setError(errorMessage(err, "Impossible de charger la conversation.")); });
    return () => { cancelled = true; };
  }, [convKey, documentIds]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending || documentIds.length === 0) return;
    setSending(true);
    setError(null);
    const optimistic: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      sources: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...(prev ?? []), optimistic]);
    setInput("");
    try {
      const body = documentIds.length === 1
        ? { documentId: documentIds[0], message: text }
        : { documentIds, message: text };
      const res = await api.post<{ message: ChatMessage }>("/api/chat", body);
      setMessages((prev) => [...(prev ?? []).filter((m) => m.id !== optimistic.id), res.message]);
    } catch (err: unknown) {
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== optimistic.id));
      setInput(text);
      setError(errorMessage(err, "L'envoi a échoué."));
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  async function clearChat() {
    try {
      const qs = documentIds.length === 1
        ? `documentId=${encodeURIComponent(documentIds[0])}`
        : `documentIds=${encodeURIComponent(convKey)}`;
      await api.del(`/api/chat?${qs}`);
      setMessages([]);
    } catch (err: unknown) {
      setError(errorMessage(err, "Impossible d'effacer la conversation."));
    }
  }

  if (documentIds.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Sélectionnez au moins un document pour démarrer le chat.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Contexte */}
      {documentIds.length > 1 && (
        <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2">
          <Bot className="inline h-3 w-3 mr-1" />
          Chat contextuel — {documentIds.length} document(s) sélectionné(s)
        </p>
      )}

      {/* Messages */}
      {messages === null && !error && (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement…
        </div>
      )}
      {error && (
        <Alert variant="destructive" className="text-sm">
          <XCircle className="h-4 w-4" aria-hidden />
          <AlertTitle>Erreur</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {messages !== null && (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                Posez une question sur le contenu des documents — l&apos;assistant répond à partir des extraits indexés.
              </p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-xl px-4 py-2.5 text-sm shadow-sm",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "border bg-background",
                    )}
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                    {m.sources && m.sources.length > 0 && (
                      <div className="mt-2 space-y-1 border-t pt-2 opacity-70">
                        {m.sources.map((s, i) => (
                          <p key={i} className="text-xs">
                            📄 {s.document}{s.section ? ` — ${s.section}` : ""}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {messages.length > 0 && (
            <Button size="sm" variant="ghost" className="self-end text-xs text-muted-foreground" onClick={() => void clearChat()}>
              <RotateCcw className="h-3 w-3 mr-1" /> Effacer la conversation
            </Button>
          )}
        </>
      )}

      {/* Input */}
      <div className="relative flex items-end gap-2 border rounded-xl p-2 bg-background shadow-sm">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Posez une question… (Entrée pour envoyer)"
          className="flex-1 min-h-[60px] max-h-32 resize-none border-0 shadow-none focus-visible:ring-0 p-0 text-sm"
          disabled={sending}
        />
        <Button
          size="icon"
          className="shrink-0 h-8 w-8 self-end"
          onClick={() => void send()}
          disabled={!input.trim() || sending}
          aria-label="Envoyer"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

// ── Content Panel ─────────────────────────────────────────────────────────────

function ContentPanel({ doc }: { doc: DocDetail | null; loading: boolean }) {
  if (!doc) return null;

  const hasText = doc.extractedText && doc.extractedText.trim().length > 0;
  const hasChunks = doc.chunks.length > 0;

  return (
    <div className="space-y-4 text-sm">
      {/* Métadonnées */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{doc.type.toUpperCase()}</Badge>
        <Badge variant="outline">{formatSize(doc.size)}</Badge>
        {doc.pageCount && <Badge variant="outline">{doc.pageCount} p.</Badge>}
        <Badge variant={doc.status === "READY" ? "default" : doc.status === "ERROR" ? "destructive" : "secondary"}>
          {doc.status === "READY" ? "✓ Prêt" : doc.status === "PROCESSING" ? "En traitement…" : doc.status === "ERROR" ? "Erreur" : "En attente"}
        </Badge>
      </div>

      <Separator />

      {/* Contenu extrait */}
      {hasText ? (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
            {doc.extractedText}
          </pre>
        </div>
      ) : hasChunks ? (
        <div className="space-y-4">
          {doc.chunks.map((chunk, i) => (
            <div key={chunk.id} className="space-y-1">
              {chunk.section && (
                <Badge variant="outline" className="text-xs">{chunk.section}</Badge>
              )}
              <p className="whitespace-pre-wrap leading-relaxed text-sm">{chunk.content}</p>
              {i < doc.chunks.length - 1 && <Separator className="mt-3" />}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <FileText className="h-8 w-8" aria-hidden />
          <p>Aucun contenu extrait disponible pour ce document.</p>
          {doc.status === "PENDING" && <p className="text-xs">Le document est en attente de traitement.</p>}
          {doc.status === "PROCESSING" && (
            <p className="text-xs flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> En cours d&apos;extraction…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Doc Tab ───────────────────────────────────────────────────────────────────

function DocTab({
  doc,
  active,
  selected,
  onClick,
  onToggleSelect,
  onRemove,
}: {
  doc: DocSummary;
  active: boolean;
  selected: boolean;
  onClick: () => void;
  onToggleSelect: () => void;
  onRemove?: () => void;
}) {
  const Icon = DOC_TYPE_ICONS[doc.type.toLowerCase()] ?? FileType;
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm border transition-all select-none",
        active ? "border-primary bg-primary/5 text-primary font-medium" : "border-transparent hover:bg-muted/60",
      )}
      onClick={onClick}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
        onClick={(e) => e.stopPropagation()}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
        aria-label={`Sélectionner ${doc.name} pour le chat`}
      />
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1 min-w-0 truncate">{doc.name}</span>
      {onRemove && (
        <button
          className="shrink-0 opacity-50 hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label="Fermer l'onglet"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ChapterReaderView({ chapterId, initialDocId }: { chapterId: string; initialDocId?: string }) {
  const router = useRouter();
  const { toast } = useToast();

  // ── State ──────────────────────────────────────────────────────────────────
  const [chapter, setChapter] = useState<ChapterData | null>(null);
  const [chapterLoading, setChapterLoading] = useState(true);
  const [chapterError, setChapterError] = useState<string | null>(null);

  // IDs des onglets ouverts (dans l'ordre)
  const [openDocIds, setOpenDocIds] = useState<string[]>([]);
  // ID du doc actif (affiché dans le panneau contenu)
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  // IDs cochés pour le chat
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);

  // Détails du doc actif
  const [docDetail, setDocDetail] = useState<DocDetail | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  // Panneau contenu replié
  const [contentCollapsed, setContentCollapsed] = useState(false);
  // Panel IA tab
  const [iaTab, setIaTab] = useState<"analysis" | "chat">("analysis");

  const [analyzing, setAnalyzing] = useState(false);

  // ── Chargement du chapitre ─────────────────────────────────────────────────
  useEffect(() => {
    setChapterLoading(true);
    api
      .get<{ chapter: ChapterData }>(`/api/chapters/${chapterId}/documents`)
      .then((res) => {
        setChapter(res.chapter);
        // Ouvrir automatiquement le document initial demandé ou le premier doc
        if (res.chapter.documents.length > 0) {
          const target = (initialDocId && res.chapter.documents.find((d) => d.id === initialDocId)) || res.chapter.documents[0];
          setOpenDocIds([target.id]);
          setActiveDocId(target.id);
          setSelectedDocIds([target.id]);
        }
      })
      .catch((err: unknown) => setChapterError(errorMessage(err, "Impossible de charger le chapitre.")))
      .finally(() => setChapterLoading(false));
  }, [chapterId, initialDocId]);

  // ── Chargement du doc actif ────────────────────────────────────────────────
  useEffect(() => {
    if (!activeDocId) { setDocDetail(null); return; }
    setDocLoading(true);
    api
      .get<{ document: DocDetail }>(`/api/documents/${activeDocId}`)
      .then((res) => setDocDetail(res.document))
      .catch(() => setDocDetail(null))
      .finally(() => setDocLoading(false));
  }, [activeDocId]);

  // ── Actions ────────────────────────────────────────────────────────────────

  function openDoc(id: string) {
    if (!openDocIds.includes(id)) setOpenDocIds((prev) => [...prev, id]);
    setActiveDocId(id);
  }

  function closeTab(id: string) {
    const remaining = openDocIds.filter((d) => d !== id);
    setOpenDocIds(remaining);
    setSelectedDocIds((prev) => prev.filter((d) => d !== id));
    if (activeDocId === id) setActiveDocId(remaining[remaining.length - 1] ?? null);
  }

  function toggleSelectDoc(id: string) {
    setSelectedDocIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  }

  async function analyzeActiveDoc() {
    if (!activeDocId) return;
    setAnalyzing(true);
    try {
      await api.post(`/api/documents/${activeDocId}/analyze`);
      // Re-fetch les détails
      const res = await api.get<{ document: DocDetail }>(`/api/documents/${activeDocId}`);
      setDocDetail(res.document);
      toast({ title: "Analyse terminée !", description: "Les résultats sont disponibles dans le panneau IA." });
      setIaTab("analysis");
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Erreur d'analyse",
        description: errorMessage(err, "L'analyse a échoué."),
      });
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Navigation doc précédent/suivant ──────────────────────────────────────
  const docs = chapter?.documents ?? [];
  const activeIdx = docs.findIndex((d) => d.id === activeDocId);

  function prevDoc() {
    if (activeIdx > 0) openDoc(docs[activeIdx - 1].id);
  }
  function nextDoc() {
    if (activeIdx < docs.length - 1) openDoc(docs[activeIdx + 1].id);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (chapterLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (chapterError || !chapter) {
    return (
      <div className="p-6 max-w-md mx-auto mt-8">
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Erreur de chargement</AlertTitle>
          <AlertDescription>{chapterError ?? "Chapitre introuvable."}</AlertDescription>
        </Alert>
        <Button className="mt-4" variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour
        </Button>
      </div>
    );
  }

  const activeDocMeta = docs.find((d) => d.id === activeDocId);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-background">
      {/* ── Barre d'en-tête ── */}
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Button variant="ghost" size="icon" onClick={() => router.push("/bibliotheque")} aria-label="Retour à la bibliothèque">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: chapter.subject.color }}
            aria-hidden
          />
          <span className="text-sm text-muted-foreground truncate">{chapter.subject.name}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold truncate">{chapter.name}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="text-xs hidden sm:flex">
            {docs.length} document{docs.length > 1 ? "s" : ""}
          </Badge>
          {/* Navigation rapide entre docs */}
          {docs.length > 1 && (
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={activeIdx <= 0} onClick={prevDoc} aria-label="Document précédent">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground min-w-[3ch] text-center">
                {activeIdx + 1}/{docs.length}
              </span>
              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={activeIdx >= docs.length - 1} onClick={nextDoc} aria-label="Document suivant">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* ── Corps : 3 colonnes ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Colonne 1 : liste des documents (sidebar fixe) ── */}
        <aside className="w-56 shrink-0 border-r flex flex-col bg-muted/20 overflow-hidden">
          <div className="px-3 py-3 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documents</p>
            {selectedDocIds.length > 1 && (
              <p className="text-xs text-primary mt-1">{selectedDocIds.length} sélectionnés pour le chat</p>
            )}
          </div>
          <ScrollArea className="flex-1 px-2 py-2">
            <div className="space-y-1">
              {docs.map((doc) => {
                const Icon = DOC_TYPE_ICONS[doc.type.toLowerCase()] ?? FileType;
                const isActive = doc.id === activeDocId;
                const isSelected = selectedDocIds.includes(doc.id);
                return (
                  <div
                    key={doc.id}
                    className={cn(
                      "group flex items-start gap-2 rounded-lg px-2 py-2 cursor-pointer transition-colors",
                      isActive ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
                    )}
                    onClick={() => openDoc(doc.id)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectDoc(doc.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
                      aria-label={`Inclure ${doc.name} dans le chat`}
                    />
                    <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-xs leading-snug truncate", isActive && "font-semibold")} title={doc.name}>
                        {doc.name}
                      </p>
                      <p className="text-xs text-muted-foreground">{doc.type.toUpperCase()} · {formatSize(doc.size)}</p>
                      {doc.status === "PROCESSING" && (
                        <span className="text-xs text-amber-600 flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> En traitement
                        </span>
                      )}
                      {doc.status === "READY" && doc._count.chunks > 0 && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> {doc._count.chunks} extraits
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </aside>

        {/* ── Colonne 2 : contenu du document (collapsible) ── */}
        <div
          className={cn(
            "flex flex-col border-r transition-all duration-300 overflow-hidden",
            contentCollapsed ? "w-10 min-w-10" : "flex-1 min-w-0",
          )}
        >
          {/* Toggle button */}
          <div className="flex shrink-0 items-center border-b px-2 py-2 gap-2 bg-muted/20">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              onClick={() => setContentCollapsed((v) => !v)}
              aria-label={contentCollapsed ? "Ouvrir le contenu" : "Réduire le contenu"}
            >
              {contentCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
            {!contentCollapsed && (
              <>
                <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                <span className="text-sm font-medium truncate flex-1">
                  {activeDocMeta?.name ?? "Document"}
                </span>
              </>
            )}
          </div>

          {/* Onglets si plusieurs docs ouverts */}
          {!contentCollapsed && openDocIds.length > 1 && (
            <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5 overflow-x-auto bg-muted/10">
              {openDocIds.map((id) => {
                const d = docs.find((x) => x.id === id);
                if (!d) return null;
                return (
                  <DocTab
                    key={id}
                    doc={d}
                    active={id === activeDocId}
                    selected={selectedDocIds.includes(id)}
                    onClick={() => setActiveDocId(id)}
                    onToggleSelect={() => toggleSelectDoc(id)}
                    onRemove={openDocIds.length > 1 ? () => closeTab(id) : undefined}
                  />
                );
              })}
            </div>
          )}

          {/* Contenu */}
          {!contentCollapsed && (
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-5">
                {docLoading ? (
                  <div className="space-y-3" aria-hidden>
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-32 w-full mt-4" />
                  </div>
                ) : (
                  <ContentPanel doc={docDetail} loading={docLoading} />
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* ── Colonne 3 : IA + Chat ── */}
        <div className="w-96 shrink-0 flex flex-col overflow-hidden">
          {/* Tabs IA / Chat */}
          <div className="flex shrink-0 border-b bg-muted/10">
            <button
              onClick={() => setIaTab("analysis")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-b-2",
                iaTab === "analysis"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Sparkles className="h-4 w-4" aria-hidden /> Analyse IA
            </button>
            <button
              onClick={() => setIaTab("chat")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-b-2",
                iaTab === "chat"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <MessageSquare className="h-4 w-4" aria-hidden /> Chat
              {selectedDocIds.length > 1 && (
                <Badge className="ml-1 text-xs h-4 px-1.5">{selectedDocIds.length}</Badge>
              )}
            </button>
          </div>

          {/* Contenu IA */}
          {iaTab === "analysis" && (
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-4">
                <SectionHeading icon={Sparkles} label="Analyse IA" />
                {docLoading ? (
                  <div className="space-y-3" aria-hidden>
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                ) : docDetail ? (
                  <AnalysisPanel
                    doc={docDetail}
                    onAnalyze={() => void analyzeActiveDoc()}
                    analyzing={analyzing}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Sélectionnez un document.</p>
                )}
              </div>
            </ScrollArea>
          )}

          {/* Contenu Chat */}
          {iaTab === "chat" && (
            <div className="flex flex-col flex-1 min-h-0 p-4 gap-3">
              <SectionHeading icon={MessageSquare} label="Chat documentaire" />
              <div className="flex-1 min-h-0 flex flex-col">
                <ChatPanel documentIds={selectedDocIds} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

