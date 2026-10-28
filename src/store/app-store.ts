"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ─────────────────────────────────────────────────────────────────────────────
// Store applicatif StudyForge AI
// - État transitoire : authentification (revérifiée au démarrage)
// - État d'interface PERSISTANT (localStorage) : navigation de la bibliothèque,
//   filtres, brouillons d'import, configuration de génération, brouillons de
//   réponses par session, code des éditeurs.
//   → Un changement de route ne réinitialise plus le travail en cours : les
//   composants peuvent être démontés/remontés sans perte.
// ─────────────────────────────────────────────────────────────────────────────

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
}

/** Métadonnées de fichier (les objets File eux-mêmes ne sont pas sérialisables). */
export interface FileMeta {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export interface GenerateConfigState {
  subjectId: string; // "all" = toutes les matières
  chapterId: string | null; // null = tout le chapitre
  difficulty: "decouverte" | "facile" | "moyen" | "difficile" | "expert";
  questionCount: number;
  mode: "apprentissage" | "entrainement" | "examen" | "revision" | "personnalise";
  durationMin?: number;
  pointsPerQuestion: number;
  theoryPracticeMix: number;
  hintsEnabled: boolean;
  correctionTiming: "immediate" | "end";
}

export interface ImportDraft {
  step: number; // 1..5
  subjectId: string; // "" = non choisi
  chapterId: string; // "" = non choisi
  files: FileMeta[]; // métadonnées persistées (avertissement si rechargement)
}

interface SessionDraftState {
  current: number; // index de la question courante
  drafts: Record<string, unknown>; // brouillons par index de question (stringifié)
}

interface PersistedUiState {
  // Bibliothèque
  libraryMode: "hierarchy" | "documents";
  librarySubjectId: string | null;
  libraryChapterId: string | null;
  librarySearch: string;
  libraryStatus: string; // all | READY | ERROR
  librarySubjectFilter: string; // "" = toutes
  importDraft: ImportDraft;
  // Génération d'exercices
  generateConfig: GenerateConfigState;
  generateDocumentIds: string[];
  generateTypes: string[];
  generateThemes: string[];
  // Brouillons de session (par sessionId)
  sessionDrafts: Record<string, SessionDraftState>;
  // Éditeurs
  codeLabLang: string;
  codeLabCode: Record<string, string>;
  sqlLabSql: string;
  sqlLabFixture: string;
}

interface AppState extends PersistedUiState {
  // État transitoire (non persisté)
  authenticated: boolean | null; // null = vérification en cours
  user: AppUser | null;
  importFileHandles: File[]; // objets File vivants (non sérialisables)

  // Actions
  setAuthenticated: (ok: boolean, user?: AppUser | null) => void;
  resetAll: () => void;

  // Bibliothèque
  setLibraryMode: (mode: "hierarchy" | "documents") => void;
  openSubject: (subjectId: string | null) => void;
  openChapter: (chapterId: string | null) => void;
  setLibrarySearch: (q: string) => void;
  setLibraryStatus: (s: string) => void;
  setLibrarySubjectFilter: (s: string) => void;
  resetLibraryFilters: () => void;
  setImportDraft: (patch: Partial<ImportDraft>) => void;
  resetImportDraft: () => void;
  setImportFileHandles: (files: File[]) => void;

  // Génération
  setGenerateConfig: (patch: Partial<GenerateConfigState>) => void;
  setGenerateDocumentIds: (ids: string[]) => void;
  setGenerateTypes: (types: string[]) => void;
  setGenerateThemes: (themes: string[]) => void;

  // Sessions (brouillons conservés entre les navigations)
  saveSessionDraft: (sessionId: string, current: number, drafts: Record<string, unknown>) => void;
  getSessionDraft: (sessionId: string) => SessionDraftState | undefined;
  clearSessionDraft: (sessionId: string) => void;

  // Éditeurs
  setCodeLabLang: (lang: string) => void;
  setCodeLabCode: (lang: string, code: string) => void;
  setSqlLab: (patch: { sql?: string; fixture?: string }) => void;
}

const DEFAULT_GENERATE_CONFIG: GenerateConfigState = {
  subjectId: "all",
  chapterId: null,
  difficulty: "moyen",
  questionCount: 5,
  mode: "apprentissage",
  pointsPerQuestion: 1,
  theoryPracticeMix: 50,
  hintsEnabled: true,
  correctionTiming: "immediate",
};

const DEFAULT_IMPORT_DRAFT: ImportDraft = {
  step: 1,
  subjectId: "",
  chapterId: "",
  files: [],
};

const INITIAL_PERSISTED: PersistedUiState = {
  libraryMode: "hierarchy",
  librarySubjectId: null,
  libraryChapterId: null,
  librarySearch: "",
  libraryStatus: "all",
  librarySubjectFilter: "",
  importDraft: DEFAULT_IMPORT_DRAFT,
  generateConfig: DEFAULT_GENERATE_CONFIG,
  generateDocumentIds: [],
  generateTypes: [],
  generateThemes: [],
  sessionDrafts: {},
  codeLabLang: "python",
  codeLabCode: {},
  sqlLabSql: "",
  sqlLabFixture: "",
};

/** Limite la taille du stockage : au plus 15 brouillons de session. */
function pruneSessionDrafts(drafts: Record<string, SessionDraftState>): Record<string, SessionDraftState> {
  const entries = Object.entries(drafts);
  if (entries.length <= 15) return drafts;
  return Object.fromEntries(entries.slice(-15));
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...INITIAL_PERSISTED,
      authenticated: null,
      user: null,
      importFileHandles: [],

      setAuthenticated: (ok, user = null) => set({ authenticated: ok, user }),
      resetAll: () => set({ ...INITIAL_PERSISTED, authenticated: false, user: null, importFileHandles: [] }),

      // Bibliothèque
      setLibraryMode: (mode) => set({ libraryMode: mode }),
      openSubject: (subjectId) => set({ librarySubjectId: subjectId, libraryChapterId: null }),
      openChapter: (chapterId) => set({ libraryChapterId: chapterId }),
      setLibrarySearch: (q) => set({ librarySearch: q }),
      setLibraryStatus: (s) => set({ libraryStatus: s }),
      setLibrarySubjectFilter: (s) => set({ librarySubjectFilter: s }),
      resetLibraryFilters: () =>
        set({ librarySearch: "", libraryStatus: "all", librarySubjectFilter: "" }),
      setImportDraft: (patch) => set((state) => ({ importDraft: { ...state.importDraft, ...patch } })),
      resetImportDraft: () => set({ importDraft: { ...DEFAULT_IMPORT_DRAFT }, importFileHandles: [] }),
      setImportFileHandles: (files) => set({ importFileHandles: files }),

      // Génération
      setGenerateConfig: (patch) => set((state) => ({ generateConfig: { ...state.generateConfig, ...patch } })),
      setGenerateDocumentIds: (ids) => set({ generateDocumentIds: ids }),
      setGenerateTypes: (types) => set({ generateTypes: types }),
      setGenerateThemes: (themes) => set({ generateThemes: themes }),

      // Sessions
      saveSessionDraft: (sessionId, current, drafts) =>
        set((state) => ({
          sessionDrafts: pruneSessionDrafts({ ...state.sessionDrafts, [sessionId]: { current, drafts } }),
        })),
      getSessionDraft: (sessionId) => get().sessionDrafts[sessionId],
      clearSessionDraft: (sessionId) =>
        set((state) => {
          const next = { ...state.sessionDrafts };
          delete next[sessionId];
          return { sessionDrafts: next };
        }),

      // Éditeurs
      setCodeLabLang: (lang) => set({ codeLabLang: lang }),
      setCodeLabCode: (lang, code) =>
        set((state) => ({ codeLabCode: { ...state.codeLabCode, [lang]: code } })),
      setSqlLab: (patch) =>
        set((state) => ({
          sqlLabSql: patch.sql ?? state.sqlLabSql,
          sqlLabFixture: patch.fixture ?? state.sqlLabFixture,
        })),
    }),
    {
      name: "studyforge-ui-v1",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted) => {
        const raw = persisted as Record<string, unknown>;
        const { view: _view, activeSessionId: _session, ...rest } = raw;
        void _view;
        void _session;
        return rest as unknown as PersistedUiState;
      },
      partialize: (state) => {
        const { authenticated: _a, user: _u, importFileHandles: _f, ...rest } = state;
        void _a;
        void _u;
        void _f;
        return rest as PersistedUiState;
      },
    },
  ),
);
