// ─────────────────────────────────────────────────────────────────────────────
// Types partagés StudyForge AI
// ─────────────────────────────────────────────────────────────────────────────

export const QUESTION_TYPES = [
  "qcm_single",
  "qcm_multiple",
  "true_false",
  "fill_blank",
  "short_answer",
  "open_question",
  "matching",
  "ordering",
  "error_identification",
  "code_output",
  "code_write",
  "code_fix",
  "debug",
  "sql_query",
  "sql_create_table",
  "sql_database",
  "data_modeling",
  "case_study",
  "combined",
  "exam_composite",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  qcm_single: "QCM (réponse unique)",
  qcm_multiple: "QCM (réponses multiples)",
  true_false: "Vrai ou faux",
  fill_blank: "Texte à trous",
  short_answer: "Réponse courte",
  open_question: "Question ouverte",
  matching: "Association notions / définitions",
  ordering: "Classement d'étapes",
  error_identification: "Identification d'erreurs",
  code_output: "Prédiction du résultat d'un programme",
  code_write: "Écriture de code",
  code_fix: "Correction de code",
  debug: "Débogage",
  sql_query: "Exercice SQL (requête)",
  sql_create_table: "SQL — création de tables",
  sql_database: "SQL — création / modification de base",
  data_modeling: "Modélisation de données",
  case_study: "Étude de cas",
  combined: "Exercice combiné",
  exam_composite: "Examen blanc",
};

/** Types dont la réponse est saisie dans l'éditeur de code */
export const CODE_TYPES: QuestionType[] = ["code_write", "code_fix", "debug", "code_output"];
/** Types SQL saisis dans l'éditeur SQL */
export const SQL_TYPES: QuestionType[] = ["sql_query", "sql_create_table", "sql_database"];
/** Types évalués par l'IA (réponses ouvertes) */
export const AI_GRADED_TYPES: QuestionType[] = ["open_question", "case_study", "data_modeling", "combined"];

export type Difficulty = "decouverte" | "facile" | "moyen" | "difficile" | "expert";
export type SessionMode = "apprentissage" | "entrainement" | "examen" | "revision" | "personnalise";

export const MODE_LABELS: Record<SessionMode, string> = {
  apprentissage: "Apprentissage",
  entrainement: "Entraînement",
  examen: "Examen",
  revision: "Révision ciblée",
  personnalise: "Personnalisé",
};

export interface QcmOption {
  id: string;
  label: string;
  correct: boolean;
}

export interface Testcase {
  name: string;
  stdin?: string;
  expected: string;
}

export interface Question {
  type: QuestionType;
  statement: string;
  instructions?: string;
  difficulty: Difficulty;
  notions: string[];
  points: number;
  hints?: string[];
  explanation?: string;
  sources?: { document: string; section?: string }[];
  // QCM / vrai-faux
  options?: QcmOption[];
  // Texte à trous : segments alternés texte / trou (trous = inputs)
  segments?: string[];
  blanks?: string[]; // réponses acceptées par trou (alias séparés par |)
  // Réponse courte : variantes acceptées
  acceptedAnswers?: string[];
  // Association
  pairs?: { left: string; right: string }[];
  // Classement
  orderedItems?: string[];
  // Identification d'erreurs
  buggyCode?: string;
  errorLine?: number;
  // Code
  language?: string;
  starterCode?: string;
  solutionCode?: string;
  testCases?: Testcase[];
  // SQL
  fixtureSql?: string; // environnement de test isolé
  referenceSql?: string; // requête de référence
  // Libelle attendu pour code_output
  expectedOutput?: string;
}

export interface CriterionScore {
  criterion: string;
  awarded: number;
  max: number;
  comment?: string;
}

export interface CorrectionFeedback {
  verdict: "correct" | "partial" | "incorrect" | "skipped";
  points: number;
  criteria?: CriterionScore[];
  explanation: string;
  expectedAnswer?: string;
  sources?: { document: string; section?: string }[];
  uncertain?: boolean;
}

export interface GenerateConfig {
  subjectId?: string;
  chapterId?: string;
  documentIds: string[];
  themes: string[];
  difficulty: Difficulty;
  questionCount: number;
  types: QuestionType[];
  mode: SessionMode;
  durationMin?: number;
  pointsPerQuestion?: number;
  theoryPracticeMix?: number; // 0..100 % théorie
  hintsEnabled: boolean;
  correctionTiming: "immediate" | "end";
}

export interface SessionSummary {
  score: number;
  maxScore: number;
  percentage: number;
  byNotion: { notion: string; correct: number; total: number }[];
  toReview: string[];
  strengths: string[];
  comment: string;
}

export interface RagPassage {
  documentId: string;
  documentName: string;
  section?: string;
  content: string;
  score: number;
}
