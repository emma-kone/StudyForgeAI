"use client";

// ─────────────────────────────────────────────────────────────────────────────
// LibraryView — Bibliothèque de documents de StudyForge AI.
// - Navigation hiérarchique : Matière → Chapitres → Documents (fil d'Ariane)
// - Import guidé en 5 étapes (matière → chapitre → fichiers → récap → import)
// - Gestion complète : créer / renommer / colorer / supprimer une matière,
//   créer / renommer / décrire / réordonner / déplacer / supprimer un chapitre
// - Section « À classer » pour les documents orphelins (données existantes)
// - Vue « Tous les documents » : recherche plein texte, statut, matière (filtres)
// - Dialogue de détails : informations, renommage, déplacement cohérent,
//   chat documentaire, analyse IA, extraits indexés
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAppStore, type FileMeta } from "@/store/app-store";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FileCode,
  FileText,
  FileType,
  FolderPlus,
  Loader2,
  MessageSquare,
  MoreVertical,
  Palette,
  Pencil,
  Presentation,
  RotateCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
  FolderTree,
  List,
} from "lucide-react";

// ── Types de l'API ───────────────────────────────────────────────────────────

type DocStatus = "PENDING" | "PROCESSING" | "READY" | "ERROR";

interface ApiChapter {
  id: string;
  name: string;
  description: string | null;
  position: number;
  _count: { documents: number };
}

interface ApiSubject {
  id: string;
  name: string;
  color: string;
  chapters: ApiChapter[];
  _count: { documents: number; exercises: number; sessions: number };
}

interface SubjectsResponse {
  subjects: ApiSubject[];
}

interface ApiDocument {
  id: string;
  name: string;
  originalName: string;
  type: string;
  size: number;
  status: DocStatus;
  pageCount: number | null;
  error: string | null;
  subjectId: string | null;
  chapterId: string | null;
  createdAt: string;
  subject: { name: string; color: string } | null;
  chapter: { name: string } | null;
  _count: { chunks: number };
}

interface DocumentsResponse {
  documents: ApiDocument[];
}

interface UploadResultItem {
  name: string;
  ok: boolean;
  id?: string;
  error?: string;
  warnings?: string[];
}

interface UploadResponse {
  ok: boolean;
  results: UploadResultItem[];
}

interface DocumentAnalysis {
  summary: string | null;
  subjectGuess: string | null;
  chapters: string | null;
  notions: string | null;
  definitions: string | null;
  methods: string | null;
  formulas: string | null;
  codeExcerpts: string | null;
  pitfalls: string | null;
  prerequisites: string | null;
  model: string | null;
}

interface ApiChunk {
  id: string;
  section: string | null;
  content: string;
  words: number;
}

interface ApiDocumentDetail extends ApiDocument {
  extractedText: string | null;
  analysis: DocumentAnalysis | null;
  chunks: ApiChunk[];
}

interface DocumentDetailResponse {
  document: ApiDocumentDetail;
}

interface ChatMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: { document: string; section?: string }[] | null;
  createdAt: string;
}

// ── Constantes et utilitaires ────────────────────────────────────────────────

/** Sentinelle pour les Select Radix (value="" est interdit) ↔ état local "". */
const NONE = "none";
/** Sentinelle du filtre de statut « tous ». */
const ALL = "all";

const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".pptx"];
const ACCEPT_ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(",");

const SUBJECT_COLORS = [
  "#8b5cf6",
  "#059669",
  "#d97706",
  "#dc2626",
  "#0891b2",
  "#be185d",
  "#4d7c0f",
  "#a16207",
];

type AnalysisListKey =
  | "notions"
  | "definitions"
  | "methods"
  | "formulas"
  | "pitfalls"
  | "prerequisites";

const ANALYSIS_LISTS: { key: AnalysisListKey; label: string }[] = [
  { key: "notions", label: "Notions clés" },
  { key: "definitions", label: "Définitions" },
  { key: "methods", label: "Méthodes" },
  { key: "formulas", label: "Formules" },
  { key: "pitfalls", label: "Pièges à éviter" },
  { key: "prerequisites", label: "Prérequis" },
];

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} o`;
  return size < 1024 * 1024 ? `${Math.round(size / 1024)} Ko` : `${(size / 1024 / 1024).toFixed(1)} Mo`;
}

function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Analyse défensive d'un champ d'analyse encodé en JSON (tableau de chaînes). */
function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item).trim()).filter((item) => item.length > 0);
  } catch {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
}

/** Icône par type de fichier (table de correspondance statique). */
const DOC_TYPE_ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  docx: FileText,
  pptx: Presentation,
  md: FileCode,
};

function statusMeta(status: DocStatus): {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
} {
  switch (status) {
    case "READY":
      return { label: "Prêt", variant: "default" };
    case "ERROR":
      return { label: "Erreur", variant: "destructive" };
    case "PROCESSING":
      return { label: "Traitement…", variant: "secondary" };
    default:
      return { label: "En attente", variant: "outline" };
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Validation d'un fichier côté client (miroir des règles serveur). */
function validateFile(file: File, maxMb: number): string | null {
  const lower = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return `Format non pris en charge (${file.name.split(".").pop() || "?"}). Formats acceptés : PDF, DOCX, TXT, MD, PPTX.`;
  }
  if (file.size === 0) return "Fichier vide.";
  if (file.size > maxMb * 1024 * 1024) {
    return `Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} Mo, max ${maxMb} Mo — modifiable dans les Réglages).`;
  }
  return null;
}

// ── Ligne d'information (dl/dt/dd) ───────────────────────────────────────────

function InfoRow({
  label,
  value,
  tnum = false,
  mono = false,
}: {
  label: string;
  value: string;
  tnum?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1.5">
      <dt className="typo-meta shrink-0">{label}</dt>
      <dd className={cn("min-w-0 truncate text-right text-sm font-medium", tnum && "tnum", mono && "font-code")}>
        {value}
      </dd>
    </div>
  );
}

// ── Carte document (partagée entre les vues) ─────────────────────────────────

interface DocumentCardProps {
  doc: ApiDocument;
  analyzing: boolean;
  retrying: boolean;
  onAnalyze: (id: string) => void;
  onRetry: (id: string) => void;
  onOpen: (id: string) => void;
  onDelete: (doc: ApiDocument) => void;
}

function DocumentCard({
  doc,
  analyzing,
  retrying,
  onAnalyze,
  onRetry,
  onOpen,
  onDelete,
}: DocumentCardProps) {
  const Icon = DOC_TYPE_ICONS[doc.type.toLowerCase()] ?? FileType;
  const status = statusMeta(doc.status);

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={doc.originalName}>
              {doc.name}
            </p>
            <Badge variant={status.variant} className="mt-1">
              {status.label}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-1.5 pt-0">
        <p className="typo-meta tnum">
          {doc.type.toUpperCase()} · {formatSize(doc.size)}
          {doc.pageCount ? ` · ${doc.pageCount} p.` : ""}
        </p>
        <p className="typo-meta tnum">Importé le {formatDate(doc.createdAt)}</p>
        {doc.subject ? (
          <p className="typo-meta flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: doc.subject.color }}
              aria-hidden
            />
            <span className="truncate">
              {doc.subject.name}
              {doc.chapter ? ` · ${doc.chapter.name}` : ""}
            </span>
          </p>
        ) : (
          <p className="typo-meta flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
            À classer (aucun emplacement)
          </p>
        )}
        <p className="typo-meta tnum">{doc._count.chunks} extrait(s) indexé(s)</p>

        {doc.status === "ERROR" && doc.error && (
          <p className="typo-meta line-clamp-2 text-destructive">{doc.error}</p>
        )}
        {doc.status === "ERROR" && (
          <div className="pt-1">
            <Button size="sm" variant="outline" onClick={() => onRetry(doc.id)} disabled={retrying}>
              {retrying ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RotateCw className="h-4 w-4" aria-hidden />
              )}
              Réessayer
            </Button>
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
          {doc.status === "READY" && (
            <Button size="sm" variant="outline" onClick={() => onAnalyze(doc.id)} disabled={analyzing}>
              {analyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              {analyzing ? "Analyse…" : "Analyser (IA)"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onOpen(doc.id)}>
            Détails
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto size-8 text-muted-foreground hover:text-destructive"
            aria-label="Supprimer"
            onClick={() => onDelete(doc)}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Formulaire matière (création / édition) ──────────────────────────────────

interface SubjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject?: ApiSubject | null; // présent = édition
  onSaved: () => Promise<void> | void;
  onCreated?: (subject: ApiSubject) => void;
}

function SubjectFormDialog({ open, onOpenChange, subject, onSaved, onCreated }: SubjectFormDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(SUBJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(subject?.name ?? "");
      setColor(subject?.color ?? SUBJECT_COLORS[0]);
      setError(null);
    }
  }, [open, subject]);

  async function submit() {
    const clean = name.trim();
    if (!clean || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (subject) {
        await api.patch(`/api/subjects/${subject.id}`, { name: clean, color });
        toast({ title: "Matière modifiée", description: `La matière s'appelle désormais « ${clean} ».` });
      } else {
        const res = await api.post<{ subject: ApiSubject }>("/api/subjects", { name: clean, color });
        toast({ title: "Matière créée", description: `« ${clean} » est désormais disponible.` });
        onCreated?.(res.subject);
      }
      await onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(errorMessage(err, "L'enregistrement a échoué."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="typo-h3">{subject ? "Modifier la matière" : "Nouvelle matière"}</DialogTitle>
          <DialogDescription>
            {subject
              ? "Renommez la matière ou changez sa couleur. Les documents et chapitres sont conservés."
              : "La matière est créée indépendamment de tout document. Elle apparaît immédiatement dans la bibliothèque."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="subject-form-name">Nom de la matière</Label>
            <Input
              id="subject-form-name"
              placeholder="Ex. : Bases de données"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              disabled={saving}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Couleur</Label>
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Couleur de la matière">
              {SUBJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={`Couleur ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                    color === c ? "border-foreground" : "border-transparent",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Annuler
            </Button>
            <Button onClick={() => void submit()} disabled={saving || name.trim() === ""}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {subject ? "Enregistrer" : "Créer la matière"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Formulaire chapitre (création / édition) ─────────────────────────────────

interface ChapterFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: ApiSubject;
  chapter?: ApiChapter | null; // présent = édition
  onSaved: () => Promise<void> | void;
  onCreated?: (chapter: ApiChapter) => void;
}

function ChapterFormDialog({ open, onOpenChange, subject, chapter, onSaved, onCreated }: ChapterFormDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(chapter?.name ?? "");
      setDescription(chapter?.description ?? "");
      setError(null);
    }
  }, [open, chapter]);

  async function submit() {
    const clean = name.trim();
    if (!clean || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (chapter) {
        await api.patch(`/api/chapters/${chapter.id}`, {
          name: clean,
          description: description.trim() ? description.trim() : null,
        });
        toast({ title: "Chapitre modifié", description: `Le chapitre s'appelle désormais « ${clean} ».` });
      } else {
        const res = await api.post<{ chapter: ApiChapter }>("/api/chapters", {
          subjectId: subject.id,
          name: clean,
          description: description.trim() ? description.trim() : undefined,
        });
        toast({
          title: "Chapitre ajouté",
          description: `« ${clean} » a été ajouté à « ${subject.name} ».`,
        });
        onCreated?.(res.chapter);
      }
      await onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(errorMessage(err, "L'enregistrement a échoué."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="typo-h3">{chapter ? "Modifier le chapitre" : "Nouveau chapitre"}</DialogTitle>
          <DialogDescription>
            {chapter
              ? `Chapitre de la matière « ${subject.name} ». Les documents rattachés sont conservés.`
              : `Le chapitre sera rattaché à la matière « ${subject.name} ».`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="chapter-form-name">Nom du chapitre</Label>
            <Input
              id="chapter-form-name"
              placeholder="Ex. : Chapitre 1 — Introduction"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              disabled={saving}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chapter-form-desc">Description (facultatif)</Label>
            <Textarea
              id="chapter-form-desc"
              placeholder="Contenu, objectifs, notes…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              rows={2}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Annuler
            </Button>
            <Button onClick={() => void submit()} disabled={saving || name.trim() === ""}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {chapter ? "Enregistrer" : "Créer le chapitre"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Suppression d'une matière avec conséquences ──────────────────────────────

interface DeleteSubjectDialogProps {
  subject: ApiSubject | null;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
}

function DeleteSubjectDialog({ subject, onClose, onDeleted }: DeleteSubjectDialogProps) {
  const { toast } = useToast();
  const [consequences, setConsequences] = useState<{ chapters: number; documents: number; exercises: number; sessions: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!subject) {
      setConsequences(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<{ consequences: { chapters: number; documents: number; exercises: number; sessions: number } }>(
        `/api/subjects/${subject.id}`,
      )
      .then((res) => {
        if (!cancelled) setConsequences(res.consequences);
      })
      .catch(() => {
        if (!cancelled) setConsequences({ chapters: subject.chapters.length, documents: subject._count.documents, exercises: subject._count.exercises, sessions: subject._count.sessions });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [subject]);

  async function confirmDelete() {
    if (!subject || deleting) return;
    setDeleting(true);
    try {
      await api.del(`/api/subjects/${subject.id}?confirmDelete=true`);
      toast({ title: "Matière supprimée", description: `« ${subject.name} » a été supprimée.` });
      await onDeleted();
      onClose();
    } catch (err: unknown) {
      toast({ title: "Suppression impossible", description: errorMessage(err, "La suppression a échoué."), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  const hasContent = consequences && (consequences.chapters > 0 || consequences.documents > 0 || consequences.exercises > 0 || consequences.sessions > 0);

  return (
    <AlertDialog open={subject !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer la matière « {subject?.name} » ?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {loading || !consequences ? (
                <p className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Calcul des conséquences…
                </p>
              ) : hasContent ? (
                <>
                  <p>Cette suppression entraînera la perte définitive de :</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    <li>
                      <span className="tnum font-medium">{consequences.chapters}</span> chapitre(s)
                    </li>
                    <li>
                      <span className="tnum font-medium">{consequences.documents}</span> document(s) et leur analyse IA
                    </li>
                    <li>
                      <span className="tnum font-medium">{consequences.exercises}</span> exercice(s) lié(s)
                    </li>
                    <li>
                      <span className="tnum font-medium">{consequences.sessions}</span> session(s) d'exercices liée(s)
                    </li>
                  </ul>
                  <p>
                    Pour conserver les documents, déplacez-les vers une autre matière avant la suppression
                    (dialogue « Détails » de chaque document).
                  </p>
                </>
              ) : (
                <p>La matière est vide : aucune donnée associée ne sera perdue.</p>
              )}
              <p className="font-medium text-destructive">Cette action est irréversible.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void confirmDelete();
            }}
            disabled={deleting || loading}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
            Supprimer définitivement
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Suppression d'un chapitre avec conséquences ──────────────────────────────

interface DeleteChapterDialogProps {
  subject: ApiSubject | null;
  chapter: ApiChapter | null;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
}

function DeleteChapterDialog({ subject, chapter, onClose, onDeleted }: DeleteChapterDialogProps) {
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!chapter || deleting) return;
    setDeleting(true);
    try {
      await api.del(`/api/chapters/${chapter.id}?confirmDelete=true`);
      toast({ title: "Chapitre supprimé", description: `« ${chapter.name} » a été supprimé.` });
      await onDeleted();
      onClose();
    } catch (err: unknown) {
      toast({ title: "Suppression impossible", description: errorMessage(err, "La suppression a échoué."), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={chapter !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer le chapitre « {chapter?.name} » ?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                Ce chapitre contient <span className="tnum font-medium">{chapter?._count.documents ?? 0}</span> document(s).
                Ils seront définitivement supprimés, ainsi que leurs extraits indexés et leurs analyses IA.
              </p>
              <p>
                Pour les conserver, déplacez d'abord les documents vers un autre chapitre, ou déplacez ce chapitre
                vers une autre matière.
              </p>
              <p className="font-medium text-destructive">Cette action est irréversible.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void confirmDelete();
            }}
            disabled={deleting}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
            Supprimer définitivement
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Déplacement d'un chapitre vers une autre matière ─────────────────────────

interface MoveChapterDialogProps {
  subjects: ApiSubject[];
  chapter: (ApiChapter & { subjectId: string }) | null;
  onClose: () => void;
  onMoved: () => Promise<void> | void;
}

function MoveChapterDialog({ subjects, chapter, onClose, onMoved }: MoveChapterDialogProps) {
  const { toast } = useToast();
  const [targetId, setTargetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (chapter) {
      setTargetId("");
      setError(null);
    }
  }, [chapter]);

  const target = subjects.find((s) => s.id === targetId) ?? null;
  const duplicate = target?.chapters.some(
    (c) => chapter && c.id !== chapter.id && normalizeName(c.name) === normalizeName(chapter.name),
  );

  async function submit() {
    if (!chapter || !targetId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/chapters/${chapter.id}`, { subjectId: targetId });
      toast({
        title: "Chapitre déplacé",
        description: `« ${chapter.name} » a été déplacé. Ses documents ont suivi.`,
      });
      await onMoved();
      onClose();
    } catch (err: unknown) {
      setError(errorMessage(err, "Le déplacement a échoué."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={chapter !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="typo-h3">Déplacer le chapitre</DialogTitle>
          <DialogDescription>
            « {chapter?.name} » sera déplacé vers la matière choisie. Les documents rattachés suivent le chapitre
            et restent cohérents.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Matière de destination</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger aria-label="Matière de destination">
                <SelectValue placeholder="Choisir une matière" />
              </SelectTrigger>
              <SelectContent>
                {subjects
                  .filter((s) => s.id !== chapter?.subjectId)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {duplicate && (
            <Alert>
              <AlertTitle>Attention</AlertTitle>
              <AlertDescription>
                La matière « {target?.name} » contient déjà un chapitre « {chapter?.name} ». Renommez l'un des deux
                avant le déplacement.
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Annuler
            </Button>
            <Button onClick={() => void submit()} disabled={saving || !targetId || duplicate}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Déplacer
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Chat documentaire (dialogue de détails) ──────────────────────────────────

function DocChatPanel({ documentId }: { documentId: string }) {
  const [messages, setMessages] = useState<ChatMessageDto[] | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setError(null);
    api
      .get<{ messages: ChatMessageDto[] }>(`/api/chat?documentId=${encodeURIComponent(documentId)}`)
      .then((res) => {
        if (!cancelled) setMessages(res.messages);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err, "Impossible de charger la conversation."));
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const optimistic: ChatMessageDto = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      sources: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...(prev ?? []), optimistic]);
    setInput("");
    try {
      const res = await api.post<{ message: ChatMessageDto }>("/api/chat", { documentId, message: text });
      setMessages((prev) => [...(prev ?? []).filter((m) => m.id !== optimistic.id), res.message]);
    } catch (err: unknown) {
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== optimistic.id));
      setInput(text);
      setError(errorMessage(err, "L'envoi a échoué."));
    } finally {
      setSending(false);
    }
  }

  async function clearConversation() {
    try {
      await api.del(`/api/chat?documentId=${encodeURIComponent(documentId)}`);
      setMessages([]);
    } catch (err: unknown) {
      setError(errorMessage(err, "La suppression a échoué."));
    }
  }

  return (
    <div className="space-y-3">
      {messages === null && !error && (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement de la conversation…
        </div>
      )}
      {error && (
        <Alert variant="destructive">
          <XCircle aria-hidden />
          <AlertTitle>Erreur</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {messages !== null && (
        <>
          {messages.length === 0 ? (
            <p className="typo-meta">
              Posez une question sur ce document : l'assistant répond à partir de son contenu uniquement.
            </p>
          ) : (
            <div ref={scrollRef} className="max-h-72 space-y-3 overflow-y-auto rounded-lg border bg-muted/30 p-3 pr-1">
              {messages.map((m) => (
                <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                      m.role === "user" ? "bg-primary text-primary-foreground" : "border bg-background",
                    )}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {m.sources && m.sources.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {m.sources.map((s, i) => (
                          <Badge key={i} variant="outline" className="max-w-full truncate">
                            {s.document}
                            {s.section ? ` · ${s.section}` : ""}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> L'assistant rédige…
                </div>
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Votre question sur ce document…"
              rows={2}
              disabled={sending}
              aria-label="Message pour le chat documentaire"
            />
            <Button size="icon" onClick={() => void send()} disabled={sending || input.trim() === ""} aria-label="Envoyer">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
          {messages.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => void clearConversation()} className="text-muted-foreground">
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Effacer la conversation
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ── Parcours d'import guidé (5 étapes) ───────────────────────────────────────

const IMPORT_STEPS = ["Matière", "Chapitre", "Fichiers", "Récapitulatif", "Import"];

interface ImportStepperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: ApiSubject[];
  maxUploadMb: number;
  onImported: () => Promise<void> | void;
  /** Préremplissage (ex. import depuis un chapitre). */
  prefill?: { subjectId: string; chapterId: string } | null;
  /** Navigation vers un chapitre après l'import. */
  onGoToChapter?: (subjectId: string, chapterId: string) => void;
}

function ImportStepper({
  open,
  onOpenChange,
  subjects,
  maxUploadMb,
  onImported,
  prefill,
  onGoToChapter,
}: ImportStepperProps) {
  const { toast } = useToast();
  const draft = useAppStore((s) => s.importDraft);
  const setImportDraft = useAppStore((s) => s.setImportDraft);
  const resetImportDraft = useAppStore((s) => s.resetImportDraft);
  const fileHandles = useAppStore((s) => s.importFileHandles);
  const setImportFileHandles = useAppStore((s) => s.setImportFileHandles);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectColor, setNewSubjectColor] = useState(SUBJECT_COLORS[0]);
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [newChapterName, setNewChapterName] = useState("");
  const [creatingChapter, setCreatingChapter] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResultItem[] | null>(null);

  // Ouverture : appliquer le préremplissage ou repartir d'un brouillon existant
  useEffect(() => {
    if (!open) return;
    setResults(null);
    if (prefill) {
      setImportDraft({ step: 3, subjectId: prefill.subjectId, chapterId: prefill.chapterId, files: [] });
      setImportFileHandles([]);
    } else {
      // Si aucun fichier réel n'est en mémoire mais qu'on était à l'étape 4 ou 5, revenir à l'étape 3
      const targetStep = fileHandles.length === 0 && draft.step >= 4 ? 3 : Math.min(Math.max(draft.step, 1), 4);
      setImportDraft({ step: targetStep, subjectId: draft.subjectId, chapterId: draft.chapterId });
    }
  }, [open, prefill?.subjectId, prefill?.chapterId]);

  const selectedSubject = subjects.find((s) => s.id === draft.subjectId) ?? null;
  const chapters = [...(selectedSubject?.chapters ?? [])].sort((a, b) => a.position - b.position);
  const selectedChapter = chapters.find((c) => c.id === draft.chapterId) ?? null;

  // Métadonnées affichées : handles vivants si disponibles, sinon métadonnées persistées
  const files: FileMeta[] = useMemo(() => {
    return fileHandles.length
      ? fileHandles.map((f) => ({ name: f.name, size: f.size, type: f.type, lastModified: f.lastModified }))
      : draft.files;
  }, [fileHandles, draft.files]);
  const filesLostAfterReload = !fileHandles.length && draft.files.length > 0;

  // Validation des fichiers (ext, taille, doublons internes) calculée de façon dérivée
  const fileErrors = useMemo<Record<string, string>>(() => {
    const errors: Record<string, string> = {};
    const seen = new Map<string, number>();
    files.forEach((f) => {
      const key = `${f.name}:${f.size}`;
      const synthetic = new File([], f.name, { type: f.type, lastModified: f.lastModified });
      Object.defineProperty(synthetic, "size", { value: f.size });
      const err = validateFile(synthetic as unknown as File, maxUploadMb);
      if (err) errors[key] = err;
      if (seen.has(key)) errors[key] = "Fichier en double dans la sélection.";
      seen.set(key, 1);
    });
    return errors;
  }, [files, maxUploadMb]);

  const validCount = files.filter((f) => !fileErrors[`${f.name}:${f.size}`]).length;

  function goStep(step: number) {
    setImportDraft({ step });
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const merged = [...fileHandles];
    for (const f of incoming) {
      if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f);
    }
    setImportFileHandles(merged);
    setImportDraft({
      files: merged.map((f) => ({ name: f.name, size: f.size, type: f.type, lastModified: f.lastModified })),
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    const next = [...fileHandles];
    next.splice(index, 1);
    setImportFileHandles(next);
    setImportDraft({
      files: next.map((f) => ({ name: f.name, size: f.size, type: f.type, lastModified: f.lastModified })),
    });
  }

  async function createSubjectInline() {
    const name = newSubjectName.trim();
    if (!name || creatingSubject) return;
    setCreatingSubject(true);
    try {
      const res = await api.post<{ subject: ApiSubject }>("/api/subjects", { name, color: newSubjectColor });
      await onImported(); // recharge les matières
      setImportDraft({ subjectId: res.subject.id, chapterId: "", step: 2 });
      setNewSubjectName("");
      toast({ title: "Matière créée", description: `« ${name} » est sélectionnée pour cet import.` });
    } catch (err: unknown) {
      toast({ title: "Création impossible", description: errorMessage(err, "La création de la matière a échoué."), variant: "destructive" });
    } finally {
      setCreatingSubject(false);
    }
  }

  async function createChapterInline() {
    const name = newChapterName.trim();
    if (!name || !draft.subjectId || creatingChapter) return;
    setCreatingChapter(true);
    try {
      const res = await api.post<{ chapter: ApiChapter }>("/api/chapters", { subjectId: draft.subjectId, name });
      await onImported();
      setImportDraft({ chapterId: res.chapter.id, step: 3 });
      setNewChapterName("");
      toast({ title: "Chapitre créé", description: `« ${name} » est sélectionné pour cet import.` });
    } catch (err: unknown) {
      toast({ title: "Création impossible", description: errorMessage(err, "La création du chapitre a échoué."), variant: "destructive" });
    } finally {
      setCreatingChapter(false);
    }
  }

  async function startUpload() {
    if (uploading) return;
    if (fileHandles.length === 0) {
      toast({
        title: "Fichiers à resélectionner",
        description: "Veuillez choisir à nouveau vos fichiers (les sélections précédentes ont été effacées par le rechargement).",
        variant: "destructive",
      });
      setImportDraft({ step: 3 });
      return;
    }
    if (!draft.subjectId || !draft.chapterId) {
      toast({
        title: "Emplacement manquant",
        description: "Veuillez choisir une matière et un chapitre.",
        variant: "destructive",
      });
      setImportDraft({ step: 1 });
      return;
    }
    setUploading(true);
    setResults(null);
    try {
      const formData = new FormData();
      for (const f of fileHandles) formData.append("files", f);
      formData.append("subjectId", draft.subjectId);
      formData.append("chapterId", draft.chapterId);
      const res = await api.post<UploadResponse>("/api/documents", formData);
      setResults(res.results);
      const okCount = res.results.filter((r) => r.ok).length;
      const failCount = res.results.length - okCount;
      await onImported();
      setImportDraft({ step: 5 });
      if (failCount === 0) {
        toast({ title: "Import terminé", description: `${okCount} document(s) importé(s) et rangé(s).` });
      } else if (okCount > 0) {
        toast({ title: "Import partiel", description: `${okCount} importé(s), ${failCount} en échec.`, variant: "destructive" });
      } else {
        toast({ title: "Import impossible", description: "Aucun fichier n'a pu être importé. Consultez les erreurs ci-dessous.", variant: "destructive" });
      }
    } catch (err: unknown) {
      toast({ title: "Erreur d'import", description: errorMessage(err, "L'import a échoué. Votre sélection est conservée."), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function finish(goToChapter: boolean) {
    if (goToChapter && draft.subjectId && draft.chapterId) {
      onGoToChapter?.(draft.subjectId, draft.chapterId);
    }
    resetImportDraft();
    onOpenChange(false);
  }

  const step = Math.min(Math.max(draft.step, 1), 5);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !uploading) { onOpenChange(false); } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="typo-h3">Ajouter des cours</DialogTitle>
          <DialogDescription>Parcours guidé : chaque document sera rangé à l'emplacement choisi.</DialogDescription>
        </DialogHeader>

        {/* Fil d'étapes */}
        <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Étapes de l'import">
          {IMPORT_STEPS.map((label, i) => {
            const n = i + 1;
            const active = n === step;
            const done = n < step;
            return (
              <li key={label} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border tnum",
                    active && "border-primary bg-primary text-primary-foreground",
                    done && "border-primary/40 bg-primary/10 text-foreground",
                    !active && !done && "border-border text-muted-foreground",
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  {n}
                </span>
                <span className={cn(active ? "font-medium" : "text-muted-foreground")}>{label}</span>
                {n < IMPORT_STEPS.length && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
              </li>
            );
          })}
        </ol>

        <Separator />

        {/* Étape 1 — matière */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="typo-subtitle">Choisissez la matière existante ou créez-en une — l'import ne crée jamais de matière automatiquement.</p>
            {subjects.length === 0 && (
              <p className="typo-meta">Aucune matière pour le moment : créez la première ci-dessous.</p>
            )}
            {subjects.length > 0 && (
              <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1" aria-label="Matières existantes">
                {subjects.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setImportDraft({ subjectId: s.id, chapterId: "", step: 2 })}
                      className="flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/50"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      <span className="typo-meta tnum shrink-0">{s.chapters.length} chapitre(s)</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="stepper-new-subject">Ou créer une nouvelle matière</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="stepper-new-subject"
                  placeholder="Nom de la matière"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  disabled={creatingSubject}
                />
                <div className="flex items-center gap-1" role="radiogroup" aria-label="Couleur de la nouvelle matière">
                  {SUBJECT_COLORS.slice(0, 5).map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={newSubjectColor === c}
                      aria-label={`Couleur ${c}`}
                      onClick={() => setNewSubjectColor(c)}
                      className={cn("h-6 w-6 rounded-full border-2", newSubjectColor === c ? "border-foreground" : "border-transparent")}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <Button variant="outline" onClick={() => void createSubjectInline()} disabled={creatingSubject || newSubjectName.trim() === ""}>
                  {creatingSubject ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FolderPlus className="h-4 w-4" aria-hidden />}
                  Créer
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Étape 2 — chapitre */}
        {step === 2 && selectedSubject && (
          <div className="space-y-3">
            <p className="typo-subtitle">
              Chapitres de « {selectedSubject.name} » — seuls les chapitres de cette matière sont proposés.
            </p>
            {chapters.length === 0 && <p className="typo-meta">Cette matière n'a pas encore de chapitre.</p>}
            {chapters.length > 0 && (
              <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1" aria-label="Chapitres de la matière">
                {chapters.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setImportDraft({ chapterId: c.id, step: 3 })}
                      className="flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/50"
                    >
                      <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.name}</span>
                        {c.description && <span className="typo-meta block truncate">{c.description}</span>}
                      </span>
                      <span className="typo-meta tnum shrink-0">{c._count.documents} doc.</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="stepper-new-chapter">Ou créer un nouveau chapitre</Label>
              <div className="flex gap-2">
                <Input
                  id="stepper-new-chapter"
                  placeholder="Ex. : Chapitre 2 — Modèle relationnel"
                  value={newChapterName}
                  onChange={(e) => setNewChapterName(e.target.value)}
                  disabled={creatingChapter}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void createChapterInline();
                  }}
                />
                <Button variant="outline" onClick={() => void createChapterInline()} disabled={creatingChapter || newChapterName.trim() === ""}>
                  {creatingChapter ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FolderPlus className="h-4 w-4" aria-hidden />}
                  Créer
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Étape 3 — fichiers */}
        {step === 3 && (
          <div className="space-y-3">
            <p className="typo-subtitle">Sélectionnez un ou plusieurs fichiers (PDF, DOCX, PPTX, TXT, MD — {maxUploadMb} Mo max/fichier).</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full">
              <Upload className="h-4 w-4" aria-hidden /> Choisir des fichiers
            </Button>
            {filesLostAfterReload && (
              <Alert>
                <AlertTitle>Sélection à renouveler</AlertTitle>
                <AlertDescription>
                  Votre navigation a interrompu l'import : les fichiers choisis avant doivent être resélectionnés
                  (l'emplacement matière/chapitre est conservé).
                </AlertDescription>
              </Alert>
            )}
            {files.length > 0 && (
              <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1" aria-label="Fichiers sélectionnés">
                {files.map((f, index) => {
                  const err = fileErrors[`${f.name}:${f.size}`];
                  return (
                    <li key={`${f.name}-${f.size}-${index}`} className="flex items-start gap-2 rounded-lg border px-3 py-2">
                      {err ? (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-500" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{f.name}</span>
                        <span className="typo-meta block tnum">
                          {(f.type || "fichier").replace("application/", "")} · {formatSize(f.size)}
                          {err ? ` — ${err}` : " — valide"}
                        </span>
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Retirer ${f.name}`}
                        onClick={() => removeFile(index)}
                      >
                        <XCircle className="h-4 w-4" aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Étape 4 — récapitulatif */}
        {step === 4 && (
          <div className="space-y-3">
            <p className="typo-subtitle">Vérifiez le classement avant l'enregistrement.</p>
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: selectedSubject?.color }} aria-hidden />
                <span className="font-medium">{selectedSubject?.name ?? "—"}</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <span className="font-medium">{selectedChapter?.name ?? "—"}</span>
              </div>
              <p className="typo-meta tnum">
                {validCount} fichier(s) valide(s) sur {files.length} sélectionné(s) · {formatSize(files.reduce((a, f) => a + f.size, 0))} au total
              </p>
            </div>
            <ul className="max-h-40 space-y-1 overflow-y-auto pr-1 text-sm">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                  {fileErrors[`${f.name}:${f.size}`] ? (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-500" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="typo-meta tnum shrink-0">{formatSize(f.size)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Étape 5 — import / résultats */}
        {step === 5 && (
          <div className="space-y-3">
            {uploading && (
              <p className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Import et analyse en cours, vous pouvez
                quitter cette fenêtre sans perdre le classement…
              </p>
            )}
            {results && (
              <ul className="space-y-1.5" aria-label="Résultat de l'import">
                {results.map((r, i) => (
                  <li key={`${r.name}-${i}`} className="flex items-start gap-2 text-sm">
                    {r.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-500" aria-hidden />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.name}</span>
                      {r.error && <span className="typo-meta block text-destructive">{r.error}</span>}
                      {r.ok && r.warnings && r.warnings.length > 0 && (
                        <span className="typo-meta block">{r.warnings.join(" · ")}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {!uploading && !results && (
              <p className="typo-meta">Aucun import lancé pour le moment.</p>
            )}
          </div>
        )}

        {/* Navigation entre les étapes */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1.5">
            {step > 1 && step < 5 && !uploading && (
              <Button variant="ghost" onClick={() => goStep(step - 1)}>
                <ArrowLeft className="h-4 w-4" aria-hidden /> Retour
              </Button>
            )}
            {step < 5 && !uploading && (draft.subjectId || fileHandles.length > 0) && (
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => resetImportDraft()}>
                Recommencer
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 3 && (
              <Button onClick={() => goStep(4)} disabled={validCount === 0 || fileHandles.length === 0}>
                Vérifier ({validCount})
              </Button>
            )}
            {step === 4 && (
              <Button onClick={() => void startUpload()} disabled={uploading || validCount === 0 || fileHandles.length === 0}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                {fileHandles.length === 0 ? "Fichiers à resélectionner" : `Importer ${validCount} fichier(s)`}
              </Button>
            )}
            {step === 5 && !uploading && results && (
              <>
                <Button variant="ghost" onClick={() => finish(false)}>
                  Fermer
                </Button>
                <Button onClick={() => finish(true)} disabled={results.every((r) => !r.ok)}>
                  <BookOpen className="h-4 w-4" aria-hidden /> Voir le chapitre
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Vue principale ───────────────────────────────────────────────────────────

export default function LibraryView() {
  const { toast } = useToast();

  // État persistant (conservé entre les changements de vue)
  const libraryMode = useAppStore((s) => s.libraryMode);
  const setLibraryMode = useAppStore((s) => s.setLibraryMode);
  const librarySubjectId = useAppStore((s) => s.librarySubjectId);
  const openSubject = useAppStore((s) => s.openSubject);
  const libraryChapterId = useAppStore((s) => s.libraryChapterId);
  const openChapter = useAppStore((s) => s.openChapter);
  const librarySearch = useAppStore((s) => s.librarySearch);
  const setLibrarySearch = useAppStore((s) => s.setLibrarySearch);
  const libraryStatus = useAppStore((s) => s.libraryStatus);
  const setLibraryStatus = useAppStore((s) => s.setLibraryStatus);
  const librarySubjectFilter = useAppStore((s) => s.librarySubjectFilter);
  const setLibrarySubjectFilter = useAppStore((s) => s.setLibrarySubjectFilter);
  const resetLibraryFilters = useAppStore((s) => s.resetLibraryFilters);

  // ── Données ──
  const [subjects, setSubjects] = useState<ApiSubject[] | null>(null);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);
  const [docs, setDocs] = useState<ApiDocument[] | null>(null);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [maxUploadMb, setMaxUploadMb] = useState(20);

  // ── Import guidé ──
  const [importOpen, setImportOpen] = useState(false);
  const [importPrefill, setImportPrefill] = useState<{ subjectId: string; chapterId: string } | null>(null);

  // ── Actions par document ──
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Détails (dialogue) ──
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [details, setDetails] = useState<ApiDocumentDetail | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [moveSubjectId, setMoveSubjectId] = useState("");
  const [moveChapterId, setMoveChapterId] = useState("");
  const [savingMove, setSavingMove] = useState(false);

  // ── Gestion des matières / chapitres ──
  const [subjectFormOpen, setSubjectFormOpen] = useState(false);
  const [subjectToEdit, setSubjectToEdit] = useState<ApiSubject | null>(null);
  const [subjectToDelete, setSubjectToDelete] = useState<ApiSubject | null>(null);
  const [chapterFormOpen, setChapterFormOpen] = useState(false);
  const [chapterToEdit, setChapterToEdit] = useState<ApiChapter | null>(null);
  const [chapterToDelete, setChapterToDelete] = useState<ApiChapter | null>(null);
  const [chapterToMove, setChapterToMove] = useState<(ApiChapter & { subjectId: string }) | null>(null);
  const [reordering, setReordering] = useState(false);

  /** Référence synchrone des matières pour préremplir le dialogue de détails. */
  const subjectsRef = useRef<ApiSubject[]>([]);

  // ── Chargement des matières ──
  const loadSubjects = useCallback(async () => {
    try {
      const res = await api.get<SubjectsResponse>("/api/subjects");
      setSubjects(res.subjects);
      subjectsRef.current = res.subjects;
      setSubjectsError(null);
    } catch (err: unknown) {
      setSubjectsError(errorMessage(err, "Impossible de charger les matières."));
    }
  }, []);

  // ── Chargement des documents (liste complète, filtres appliqués côté client) ──
  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    setDocsError(null);
    try {
      const res = await api.get<DocumentsResponse>("/api/documents");
      setDocs(res.documents);
    } catch (err: unknown) {
      setDocsError(errorMessage(err, "Impossible de charger les documents."));
    } finally {
      setDocsLoading(false);
    }
  }, []);

  const reloadAll = useCallback(async () => {
    await Promise.all([loadSubjects(), loadDocs()]);
  }, [loadSubjects, loadDocs]);

  // Réglages : taille max d'upload
  useEffect(() => {
    api
      .get<{ settings: { maxUploadMB: number } }>("/api/settings")
      .then((res) => setMaxUploadMb(Math.min(50, Math.max(1, res.settings.maxUploadMB ?? 20))))
      .catch(() => {});
  }, []);

  // Chargement initial
  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  // ── Dérivés ──
  const selectedSubject = subjects?.find((s) => s.id === librarySubjectId) ?? null;
  const selectedChapter = selectedSubject?.chapters.find((c) => c.id === libraryChapterId) ?? null;

  const orphanDocs = useMemo(() => docs?.filter((d) => !d.subjectId || !d.chapterId) ?? [], [docs]);

  // Filtres appliqués côté client (mêmes règles de recherche pour tous les modes)
  const filteredDocs = useMemo(() => {
    if (!docs) return null;
    const q = librarySearch.trim().toLowerCase();
    return docs.filter((d) => {
      if (libraryStatus !== ALL && d.status !== libraryStatus) return false;
      if (librarySubjectFilter && d.subjectId !== librarySubjectFilter) return false;
      if (q && !d.name.toLowerCase().includes(q) && !d.originalName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [docs, librarySearch, libraryStatus, librarySubjectFilter]);

  const chapterDocs = useMemo(
    () => docs?.filter((d) => d.chapterId === libraryChapterId) ?? [],
    [docs, libraryChapterId],
  );

  const filtersActive = librarySearch.trim() !== "" || libraryStatus !== ALL || librarySubjectFilter !== "";

  // ── Détails : ouverture / fermeture / chargement ──
  const refreshDetails = useCallback(async () => {
    if (!detailsId) return;
    try {
      const res = await api.get<DocumentDetailResponse>(`/api/documents/${detailsId}`);
      setDetails(res.document);
    } catch {
      // Rafraîchissement silencieux : le dialogue conserve l'état affiché.
    }
  }, [detailsId]);

  const closeDetails = useCallback(() => {
    setDetailsId(null);
    setDetails(null);
    setDetailsError(null);
  }, []);

  useEffect(() => {
    if (!detailsId) return;
    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError(null);
    api
      .get<DocumentDetailResponse>(`/api/documents/${detailsId}`)
      .then((res) => {
        if (cancelled) return;
        setDetails(res.document);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDetailsError(errorMessage(err, "Impossible de charger les détails du document."));
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailsId]);

  // Préremplissage du renommage et du déplacement à la réception des détails (par ID, pas par nom)
  useEffect(() => {
    if (!details) return;
    setRenameName(details.name);
    setMoveSubjectId(details.subjectId ?? "");
    setMoveChapterId(details.chapterId ?? "");
  }, [details]);

  // ── Analyse IA ──
  const analyzeDocument = useCallback(
    async (docId: string) => {
      if (analyzingId) return;
      setAnalyzingId(docId);
      try {
        await api.post<{ ok: boolean }>(`/api/documents/${docId}/analyze`);
        toast({ title: "Analyse terminée", description: "Le document a été analysé par l'IA." });
        if (detailsId === docId) await refreshDetails();
        await loadDocs();
      } catch (err: unknown) {
        toast({
          title: "Analyse impossible",
          description: errorMessage(err, "L'analyse IA a échoué."),
          variant: "destructive",
        });
      } finally {
        setAnalyzingId(null);
      }
    },
    [analyzingId, detailsId, refreshDetails, loadDocs, toast],
  );

  // ── Retraitement après erreur ──
  const retryDocument = useCallback(
    async (docId: string) => {
      if (retryingId) return;
      setRetryingId(docId);
      try {
        await api.post<{ ok: boolean }>(`/api/documents/${docId}/retry`);
        toast({ title: "Traitement relancé", description: "Le document va être retraité." });
        await loadDocs();
      } catch (err: unknown) {
        toast({
          title: "Nouvel essai impossible",
          description: errorMessage(err, "Le retraitement du document a échoué."),
          variant: "destructive",
        });
      } finally {
        setRetryingId(null);
      }
    },
    [retryingId, loadDocs, toast],
  );

  // ── Suppression d'un document ──
  const confirmDeleteDoc = useCallback(async () => {
    const target = deleteTarget;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      await api.del<{ ok: boolean }>(`/api/documents/${target.id}`);
      toast({ title: "Document supprimé", description: `« ${target.name} » a été supprimé.` });
      setDeleteTarget(null);
      if (detailsId === target.id) closeDetails();
      await reloadAll();
    } catch (err: unknown) {
      toast({
        title: "Suppression impossible",
        description: errorMessage(err, "La suppression du document a échoué."),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleting, detailsId, closeDetails, reloadAll, toast]);

  // ── Renommage / déplacement (dialogue) ──
  const handleRename = useCallback(async () => {
    if (!details || savingRename) return;
    const name = renameName.trim();
    if (!name || name === details.name) return;
    setSavingRename(true);
    try {
      await api.patch<{ document: ApiDocument }>(`/api/documents/${details.id}`, { name });
      toast({ title: "Document renommé", description: `Le document s'appelle désormais « ${name} ».` });
      await Promise.all([loadDocs(), refreshDetails()]);
    } catch (err: unknown) {
      toast({
        title: "Renommage impossible",
        description: errorMessage(err, "Le renommage a échoué."),
        variant: "destructive",
      });
    } finally {
      setSavingRename(false);
    }
  }, [details, savingRename, renameName, loadDocs, refreshDetails, toast]);

  const moveChapters = useMemo(() => {
    const subject = subjects?.find((s) => s.id === moveSubjectId) ?? null;
    return [...(subject?.chapters ?? [])].sort((a, b) => a.position - b.position);
  }, [subjects, moveSubjectId]);

  const handleMove = useCallback(async () => {
    if (!details || savingMove) return;
    setSavingMove(true);
    try {
      await api.patch<{ document: ApiDocument }>(`/api/documents/${details.id}`, {
        subjectId: moveSubjectId || null,
        chapterId: moveChapterId || null,
      });
      toast({
        title: "Document déplacé",
        description: "L'affectation matière / chapitre a été mise à jour.",
      });
      await Promise.all([loadDocs(), loadSubjects(), refreshDetails()]);
    } catch (err: unknown) {
      toast({
        title: "Déplacement impossible",
        description: errorMessage(err, "Le déplacement a échoué."),
        variant: "destructive",
      });
    } finally {
      setSavingMove(false);
    }
  }, [details, savingMove, moveSubjectId, moveChapterId, loadDocs, loadSubjects, refreshDetails, toast]);

  // ── Réordonnancement des chapitres ──
  const reorderChapter = useCallback(
    async (subject: ApiSubject, chapter: ApiChapter, direction: -1 | 1) => {
      if (reordering) return;
      const ordered = [...subject.chapters].sort((a, b) => a.position - b.position);
      const index = ordered.findIndex((c) => c.id === chapter.id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
      setReordering(true);
      try {
        // Échange des positions puis normalisation complète de l'ordre
        const next = [...ordered];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        await Promise.all(
          next.map((c, i) => (c.position === i ? Promise.resolve() : api.patch(`/api/chapters/${c.id}`, { position: i }))),
        );
        await loadSubjects();
      } catch (err: unknown) {
        toast({
          title: "Réorganisation impossible",
          description: errorMessage(err, "Le changement d'ordre a échoué."),
          variant: "destructive",
        });
        await loadSubjects();
      } finally {
        setReordering(false);
      }
    },
    [reordering, loadSubjects, toast],
  );

  const analyzingInDialog = analyzingId !== null && details !== null && analyzingId === details.id;

  function openImport(prefill?: { subjectId: string; chapterId: string }) {
    setImportPrefill(prefill ?? null);
    setImportOpen(true);
  }

  // ── Rendu ──
  return (
    <section
      aria-labelledby="library-title"
      className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8"
    >
      {/* ── En-tête ── */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 id="library-title" className="typo-h1">
            Bibliothèque
          </h1>
          <p className="typo-subtitle mt-1 max-w-2xl">
            Organisez vos cours : matières, chapitres, documents. Importez (PDF, DOCX, PPTX, TXT, MD) à
            l&apos;emplacement de votre choix.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Mode d'affichage">
            <button
              type="button"
              onClick={() => setLibraryMode("hierarchy")}
              aria-pressed={libraryMode === "hierarchy"}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                libraryMode === "hierarchy" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <FolderTree className="h-4 w-4" aria-hidden /> Par cours
            </button>
            <button
              type="button"
              onClick={() => setLibraryMode("documents")}
              aria-pressed={libraryMode === "documents"}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                libraryMode === "documents" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-4 w-4" aria-hidden /> Tous les documents
            </button>
          </div>
          <Button onClick={() => openImport()}>
            <Upload className="h-4 w-4" aria-hidden /> Importer
          </Button>
        </div>
      </header>

      {(docsError || subjectsError) && (
        <Alert variant="destructive">
          <XCircle aria-hidden />
          <AlertTitle>Chargement impossible</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {docsError ?? subjectsError}
            <Button size="sm" variant="outline" onClick={() => void reloadAll()}>
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ═══ Mode hiérarchique : Matière → Chapitres → Documents ═══ */}
      {libraryMode === "hierarchy" && (
        <>
          {/* Fil d'Ariane */}
          <nav aria-label="Chemin de navigation" className="flex items-center gap-1 text-sm">
            <button
              type="button"
              onClick={() => openSubject(null)}
              className={cn(
                "rounded-md px-2 py-1 transition-colors hover:bg-accent/50",
                !selectedSubject ? "font-medium" : "text-muted-foreground",
              )}
            >
              Bibliothèque
            </button>
            {selectedSubject && (
              <>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <button
                  type="button"
                  onClick={() => openChapter(null)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-accent/50",
                    !selectedChapter ? "font-medium" : "text-muted-foreground",
                  )}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: selectedSubject.color }} aria-hidden />
                  {selectedSubject.name}
                </button>
              </>
            )}
            {selectedSubject && selectedChapter && (
              <>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <span className="rounded-md px-2 py-1 font-medium" aria-current="page">
                  {selectedChapter.name}
                </span>
              </>
            )}
          </nav>

          {/* ── Niveau 0 : les matières ── */}
          {!selectedSubject && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="typo-h2">Mes matières</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSubjectToEdit(null);
                    setSubjectFormOpen(true);
                  }}
                >
                  <FolderPlus className="h-4 w-4" aria-hidden /> Nouvelle matière
                </Button>
              </div>

              {subjects === null && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Card key={i}>
                      <CardHeader className="pb-3">
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-3 w-1/3" />
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              )}

              {subjects !== null && subjects.length === 0 && (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
                  <FolderPlus className="h-8 w-8 text-muted-foreground" aria-hidden />
                  <h3 className="typo-h3">Aucune matière</h3>
                  <p className="typo-subtitle">Créez votre première matière, puis importez vos cours dedans.</p>
                  <Button
                    onClick={() => {
                      setSubjectToEdit(null);
                      setSubjectFormOpen(true);
                    }}
                  >
                    <FolderPlus className="h-4 w-4" aria-hidden /> Créer une matière
                  </Button>
                </div>
              )}

              {subjects !== null && subjects.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {subjects.map((subject) => (
                    <Card key={subject.id} className="group relative flex flex-col">
                      <button
                        type="button"
                        onClick={() => openSubject(subject.id)}
                        className="flex flex-1 flex-col p-5 text-left"
                        aria-label={`Ouvrir la matière ${subject.name}`}
                      >
                        <span className="flex items-center gap-2.5">
                          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: subject.color }} aria-hidden />
                          <span className="typo-h3 truncate">{subject.name}</span>
                        </span>
                        <span className="typo-meta tnum mt-3">
                          {subject.chapters.length} chapitre(s) · {subject._count.documents} document(s)
                        </span>
                        {subject.chapters.length > 0 && (
                          <span className="mt-2 space-y-1">
                            {[...subject.chapters]
                              .sort((a, b) => a.position - b.position)
                              .slice(0, 3)
                              .map((c) => (
                                <span key={c.id} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                  <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                  <span className="truncate">{c.name}</span>
                                </span>
                              ))}
                            {subject.chapters.length > 3 && (
                              <span className="typo-meta block">… et {subject.chapters.length - 3} autre(s)</span>
                            )}
                          </span>
                        )}
                      </button>
                      <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="size-8" aria-label={`Actions sur ${subject.name}`}>
                              <MoreVertical className="h-4 w-4" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setSubjectToEdit(subject);
                                setSubjectFormOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" aria-hidden /> Renommer / colorer
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openImport({ subjectId: subject.id, chapterId: "" })}>
                              <Upload className="h-4 w-4" aria-hidden /> Importer dans cette matière
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => setSubjectToDelete(subject)}>
                              <Trash2 className="h-4 w-4" aria-hidden /> Supprimer
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* ── À classer : documents orphelins ── */}
              {orphanDocs.length > 0 && (
                <Card className="border-amber-500/40">
                  <CardHeader className="pb-3">
                    <CardTitle className="typo-h2 flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden />
                      À classer
                    </CardTitle>
                    <CardDescription>
                      <span className="tnum">{orphanDocs.length}</span> document(s) sans emplacement matière/chapitre.
                      Ouvrez leurs détails pour les ranger.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {orphanDocs.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{doc.name}</span>
                        <Badge variant="outline">{doc.type.toUpperCase()}</Badge>
                        <Button size="sm" variant="outline" onClick={() => setDetailsId(doc.id)}>
                          Classer
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* ── Niveau 1 : chapitres d'une matière ── */}
          {selectedSubject && !selectedChapter && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedSubject.color }} aria-hidden />
                  <h2 className="typo-h2">{selectedSubject.name}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSubjectToEdit(selectedSubject);
                      setSubjectFormOpen(true);
                    }}
                  >
                    <Palette className="h-4 w-4" aria-hidden /> Modifier
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openImport({ subjectId: selectedSubject.id, chapterId: "" })}>
                    <Upload className="h-4 w-4" aria-hidden /> Importer
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setChapterToEdit(null);
                      setChapterFormOpen(true);
                    }}
                  >
                    <FolderPlus className="h-4 w-4" aria-hidden /> Nouveau chapitre
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setSubjectToDelete(selectedSubject)}>
                    <Trash2 className="h-4 w-4" aria-hidden /> Supprimer
                  </Button>
                </div>
              </div>

              {selectedSubject.chapters.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
                  <BookOpen className="h-8 w-8 text-muted-foreground" aria-hidden />
                  <h3 className="typo-h3">Aucun chapitre</h3>
                  <p className="typo-subtitle">Créez un chapitre pour ranger les documents de « {selectedSubject.name} ».</p>
                  <Button
                    onClick={() => {
                      setChapterToEdit(null);
                      setChapterFormOpen(true);
                    }}
                  >
                    <FolderPlus className="h-4 w-4" aria-hidden /> Créer un chapitre
                  </Button>
                </div>
              ) : (
                <ul className="space-y-2">
                  {[...selectedSubject.chapters]
                    .sort((a, b) => a.position - b.position)
                    .map((chapter, index, arr) => (
                      <li key={chapter.id}>
                        <Card>
                          <CardContent className="flex items-center gap-3 p-4">
                            <span className="typo-meta tnum w-6 shrink-0 text-center">{index + 1}</span>
                            <button
                              type="button"
                              onClick={() => openChapter(chapter.id)}
                              className="min-w-0 flex-1 text-left"
                              aria-label={`Ouvrir le chapitre ${chapter.name}`}
                            >
                              <p className="truncate font-medium">{chapter.name}</p>
                              {chapter.description && <p className="typo-meta line-clamp-1">{chapter.description}</p>}
                              <p className="typo-meta tnum">{chapter._count.documents} document(s)</p>
                            </button>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8"
                                aria-label={`Monter ${chapter.name}`}
                                disabled={reordering || index === 0}
                                onClick={() => void reorderChapter(selectedSubject, chapter, -1)}
                              >
                                <ArrowUp className="h-4 w-4" aria-hidden />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8"
                                aria-label={`Descendre ${chapter.name}`}
                                disabled={reordering || index === arr.length - 1}
                                onClick={() => void reorderChapter(selectedSubject, chapter, 1)}
                              >
                                <ArrowDown className="h-4 w-4" aria-hidden />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="icon" variant="ghost" className="size-8" aria-label={`Actions sur ${chapter.name}`}>
                                    <MoreVertical className="h-4 w-4" aria-hidden />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setChapterToEdit(chapter);
                                      setChapterFormOpen(true);
                                    }}
                                  >
                                    <Pencil className="h-4 w-4" aria-hidden /> Renommer / décrire
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openImport({ subjectId: selectedSubject.id, chapterId: chapter.id })}>
                                    <Upload className="h-4 w-4" aria-hidden /> Ajouter des documents
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setChapterToMove({ ...chapter, subjectId: selectedSubject.id })}>
                                    <ArrowRight className="h-4 w-4" aria-hidden /> Déplacer vers une autre matière
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-destructive" onClick={() => setChapterToDelete(chapter)}>
                                    <Trash2 className="h-4 w-4" aria-hidden /> Supprimer
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                              <ChevronRight className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                            </div>
                          </CardContent>
                        </Card>
                      </li>
                    ))}
                </ul>
              )}
            </>
          )}

          {/* ── Niveau 2 : documents d'un chapitre ── */}
          {selectedSubject && selectedChapter && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="typo-h2">{selectedChapter.name}</h2>
                  {selectedChapter.description && <p className="typo-subtitle mt-1">{selectedChapter.description}</p>}
                  <p className="typo-meta tnum mt-1">{selectedChapter._count.documents} document(s)</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setChapterToEdit(selectedChapter);
                      setChapterFormOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden /> Modifier
                  </Button>
                  {/* Ajout à un cours existant : complète le contenu sans rien recréer */}
                  <Button size="sm" onClick={() => openImport({ subjectId: selectedSubject.id, chapterId: selectedChapter.id })}>
                    <Upload className="h-4 w-4" aria-hidden /> Ajouter des documents
                  </Button>
                </div>
              </div>

              {docsLoading && docs === null ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Card key={i}>
                      <CardHeader className="pb-3">
                        <Skeleton className="h-5 w-3/4" />
                        <Skeleton className="h-4 w-1/3" />
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              ) : chapterDocs.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
                  <Upload className="h-8 w-8 text-muted-foreground" aria-hidden />
                  <h3 className="typo-h3">Aucun document dans ce chapitre</h3>
                  <p className="typo-subtitle">Ajoutez vos fichiers de cours pour ce chapitre.</p>
                  <Button onClick={() => openImport({ subjectId: selectedSubject.id, chapterId: selectedChapter.id })}>
                    <Upload className="h-4 w-4" aria-hidden /> Ajouter des documents
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {chapterDocs.map((doc) => (
                    <DocumentCard
                      key={doc.id}
                      doc={doc}
                      analyzing={analyzingId === doc.id}
                      retrying={retryingId === doc.id}
                      onAnalyze={(id) => void analyzeDocument(id)}
                      onRetry={(id) => void retryDocument(id)}
                      onOpen={setDetailsId}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ═══ Mode « Tous les documents » (filtres) ═══ */}
      {libraryMode === "documents" && (
        <>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative w-full md:max-w-xs">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Rechercher un document…"
                className="pl-9"
                aria-label="Rechercher un document"
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center md:ml-auto">
              <Select value={libraryStatus} onValueChange={setLibraryStatus}>
                <SelectTrigger className="w-full sm:w-40" aria-label="Filtrer par statut">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Tous</SelectItem>
                  <SelectItem value="READY">Prêt</SelectItem>
                  <SelectItem value="ERROR">Erreur</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={librarySubjectFilter || NONE}
                onValueChange={(value) => setLibrarySubjectFilter(value === NONE ? "" : value)}
              >
                <SelectTrigger className="w-full sm:w-48" aria-label="Filtrer par matière">
                  <SelectValue placeholder="Toutes les matières" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Toutes les matières</SelectItem>
                  {(subjects ?? []).map((subject) => (
                    <SelectItem key={subject.id} value={subject.id}>
                      {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={resetLibraryFilters}>
                  Réinitialiser les filtres
                </Button>
              )}
            </div>
          </div>

          {docs === null && docsLoading && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
              {Array.from({ length: 6 }).map((_, index) => (
                <Card key={index}>
                  <CardHeader className="pb-3">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-1/3" />
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-8 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {filteredDocs !== null && filteredDocs.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredDocs.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  analyzing={analyzingId === doc.id}
                  retrying={retryingId === doc.id}
                  onAnalyze={(id) => void analyzeDocument(id)}
                  onRetry={(id) => void retryDocument(id)}
                  onOpen={setDetailsId}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}

          {filteredDocs !== null && filteredDocs.length === 0 && !docsLoading && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
              {filtersActive ? (
                <>
                  <Search className="h-8 w-8 text-muted-foreground" aria-hidden />
                  <p className="typo-subtitle">Aucun document ne correspond aux filtres.</p>
                  <Button variant="outline" onClick={resetLibraryFilters}>
                    Réinitialiser les filtres
                  </Button>
                </>
              ) : (
                <>
                  <Upload className="h-8 w-8 text-muted-foreground" aria-hidden />
                  <h2 className="typo-h3">Aucun document</h2>
                  <p className="typo-subtitle">Importez votre premier cours pour commencer.</p>
                  <Button onClick={() => openImport()}>
                    <Upload className="h-4 w-4" aria-hidden /> Importer des documents
                  </Button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Dialogues ── */}
      <SubjectFormDialog
        open={subjectFormOpen}
        onOpenChange={setSubjectFormOpen}
        subject={subjectToEdit}
        onSaved={reloadAll}
      />

      {chapterFormOpen && selectedSubjectForForm(selectedSubject, librarySubjectId, subjects) && (
        <ChapterFormDialog
          open={chapterFormOpen}
          onOpenChange={setChapterFormOpen}
          subject={selectedSubjectForForm(selectedSubject, librarySubjectId, subjects)!}
          chapter={chapterToEdit}
          onSaved={reloadAll}
        />
      )}

      <DeleteSubjectDialog
        subject={subjectToDelete}
        onClose={() => setSubjectToDelete(null)}
        onDeleted={async () => {
          // Si la matière affichée est supprimée, revenir à la racine
          if (subjectToDelete && librarySubjectId === subjectToDelete.id) {
            openSubject(null);
          }
          await reloadAll();
        }}
      />

      <DeleteChapterDialog
        subject={selectedSubject}
        chapter={chapterToDelete}
        onClose={() => setChapterToDelete(null)}
        onDeleted={async () => {
          if (chapterToDelete && libraryChapterId === chapterToDelete.id) {
            openChapter(null);
          }
          await reloadAll();
        }}
      />

      <MoveChapterDialog
        subjects={subjects ?? []}
        chapter={chapterToMove}
        onClose={() => setChapterToMove(null)}
        onMoved={async () => {
          // Si le chapitre affiché a changé de matière, revenir au niveau matière
          if (chapterToMove && libraryChapterId === chapterToMove.id) {
            openChapter(null);
          }
          await reloadAll();
        }}
      />

      <ImportStepper
        open={importOpen}
        onOpenChange={setImportOpen}
        subjects={subjects ?? []}
        maxUploadMb={maxUploadMb}
        prefill={importPrefill}
        onImported={reloadAll}
        onGoToChapter={(subjectId, chapterId) => {
          openSubject(subjectId);
          openChapter(chapterId);
          setLibraryMode("hierarchy");
        }}
      />

      {/* ── Dialogue de détails ── */}
      <Dialog
        open={detailsId !== null}
        onOpenChange={(open) => {
          if (!open) closeDetails();
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="typo-h3 pr-6">{details?.name ?? "Détails du document"}</DialogTitle>
            <DialogDescription>{details ? details.originalName : "Chargement des informations…"}</DialogDescription>
          </DialogHeader>

          {detailsLoading && (
            <div className="space-y-4" aria-hidden>
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}

          {detailsError && !detailsLoading && (
            <Alert variant="destructive">
              <XCircle aria-hidden />
              <AlertTitle>Chargement impossible</AlertTitle>
              <AlertDescription>{detailsError}</AlertDescription>
            </Alert>
          )}

          {details && !detailsLoading && (
            <div className="space-y-6">
              {/* Informations */}
              <section className="space-y-2" aria-label="Informations">
                <h3 className="typo-h2">Informations</h3>
                <dl className="space-y-1.5">
                  <InfoRow label="Fichier d'origine" value={details.originalName} />
                  <InfoRow label="Type" value={details.type.toUpperCase()} />
                  <InfoRow
                    label="Taille"
                    value={`${formatSize(details.size)}${details.pageCount ? ` · ${details.pageCount} p.` : ""}`}
                    tnum
                  />
                  <InfoRow label="Statut" value={statusMeta(details.status).label} />
                  <InfoRow label="Importé le" value={formatDate(details.createdAt)} />
                  <InfoRow label="Matière" value={details.subject?.name ?? "— (à classer)"} />
                  <InfoRow label="Chapitre" value={details.chapter?.name ?? "—"} />
                </dl>
              </section>

              {/* Renommer / Déplacer */}
              <section className="space-y-3" aria-label="Renommer ou déplacer">
                <h3 className="typo-h2">Renommer / Déplacer</h3>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="doc-rename">Nom du document</Label>
                    <Input
                      id="doc-rename"
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      disabled={savingRename}
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void handleRename()}
                    disabled={savingRename || renameName.trim() === "" || renameName.trim() === details.name}
                  >
                    {savingRename && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    Enregistrer
                  </Button>
                </div>
                <Separator />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select
                    value={moveSubjectId || NONE}
                    onValueChange={(value) => {
                      setMoveSubjectId(value === NONE ? "" : value);
                      setMoveChapterId("");
                    }}
                  >
                    <SelectTrigger aria-label="Matière du document">
                      <SelectValue placeholder="Aucune matière" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Aucune matière</SelectItem>
                      {(subjects ?? []).map((subject) => (
                        <SelectItem key={subject.id} value={subject.id}>
                          {subject.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={moveChapterId || NONE}
                    onValueChange={(value) => setMoveChapterId(value === NONE ? "" : value)}
                    disabled={!moveSubjectId}
                  >
                    <SelectTrigger aria-label="Chapitre du document">
                      <SelectValue placeholder="Aucun chapitre" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Aucun chapitre</SelectItem>
                      {moveChapters.map((chapter) => (
                        <SelectItem key={chapter.id} value={chapter.id}>
                          {chapter.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {details.chapterId && moveChapterId !== details.chapterId && (
                  <p className="typo-meta text-muted-foreground">
                    Le document sera déplacé vers un autre chapitre — ses analyses et extraits sont conservés.
                  </p>
                )}
                <Button size="sm" variant="outline" onClick={() => void handleMove()} disabled={savingMove}>
                  {savingMove && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Enregistrer l'emplacement
                </Button>
              </section>

              {/* Chat documentaire */}
              <section className="space-y-3" aria-label="Chat documentaire">
                <h3 className="typo-h2 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" aria-hidden /> Poser une question sur ce document
                </h3>
                <DocChatPanel documentId={details.id} />
              </section>

              {/* Analyse IA */}
              <section className="space-y-3" aria-label="Analyse IA">
                <h3 className="typo-h2">Analyse IA</h3>
                {details.analysis ? (
                  <div className="space-y-4">
                    {details.analysis.summary && (
                      <p className="typo-subtitle whitespace-pre-wrap">{details.analysis.summary}</p>
                    )}
                    {(details.analysis.subjectGuess || details.analysis.model) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {details.analysis.subjectGuess && (
                          <Badge variant="secondary">Matière suggérée : {details.analysis.subjectGuess}</Badge>
                        )}
                        {details.analysis.model && <Badge variant="outline">{details.analysis.model}</Badge>}
                      </div>
                    )}
                    {details.analysis.subjectGuess && (
                      <p className="typo-meta">
                        La suggestion ci-dessus est indicative : utilisez « Renommer / Déplacer » pour ranger
                        effectivement le document.
                      </p>
                    )}
                    {ANALYSIS_LISTS.map(({ key, label }) => {
                      const items = parseStringArray(details.analysis?.[key] ?? null);
                      if (items.length === 0) return null;
                      return (
                        <div key={key} className="space-y-1.5">
                          <h4 className="typo-h3">{label}</h4>
                          <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-sm">
                            {items.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                    {parseStringArray(details.analysis.codeExcerpts).length > 0 && (
                      <div className="space-y-2">
                        <h4 className="typo-h3">Extraits de code</h4>
                        {parseStringArray(details.analysis.codeExcerpts).map((code, index) => (
                          <pre key={index} className="font-code overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
                            {code}
                          </pre>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-3">
                    <p className="typo-meta">Ce document n&apos;a pas encore été analysé.</p>
                    <Button size="sm" onClick={() => details && void analyzeDocument(details.id)} disabled={analyzingInDialog}>
                      {analyzingInDialog ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Sparkles className="h-4 w-4" aria-hidden />
                      )}
                      {analyzingInDialog ? "Analyse en cours…" : "Analyser (IA)"}
                    </Button>
                  </div>
                )}
              </section>

              {/* Extraits indexés */}
              <section className="space-y-2" aria-label="Extraits indexés">
                <h3 className="typo-h2">Extraits indexés</h3>
                {details.chunks.length === 0 ? (
                  <p className="typo-meta">Aucun extrait indexé pour ce document.</p>
                ) : (
                  <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
                    {details.chunks.slice(0, 10).map((chunk) => (
                      <li key={chunk.id} className="rounded-lg border p-3">
                        <Badge variant="outline" className="mb-1.5">
                          {chunk.section || "Sans titre"}
                        </Badge>
                        <p className="line-clamp-6 whitespace-pre-wrap text-sm">{chunk.content}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Confirmation de suppression d'un document ── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {deleteTarget?.name ?? "Ce document"} » sera définitivement supprimé, ainsi que ses extraits
              indexés et son analyse IA. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteDoc();
              }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden />
              )}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Matière utilisée par le formulaire chapitre : celle sélectionnée dans la
 *  hiérarchie, ou retrouvée depuis l'identifiant stocké. */
function selectedSubjectForForm(
  selected: ApiSubject | null,
  subjectId: string | null,
  subjects: ApiSubject[] | null,
): ApiSubject | null {
  if (selected) return selected;
  if (!subjectId || !subjects) return null;
  return subjects.find((s) => s.id === subjectId) ?? null;
}
