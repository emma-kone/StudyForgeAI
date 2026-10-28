import { db } from "@/lib/db";
import { ai } from "@/lib/ai";
import type { CorrectionFeedback, CriterionScore, Question, RagPassage } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Moteur de correction hybride
// 1. Règles déterministes pour tout ce qui est objectivement vérifiable
// 2. IA (grille d'évaluation) pour les réponses ouvertes
// 3. Code et SQL : ANALYSE STATIQUE UNIQUEMENT — aucune compilation,
//    aucune exécution. L'IA raisonne sur le code soumis (syntaxe, structure,
//    logique, conformité à la consigne) et distingue explicitement :
//    erreurs détectables / problèmes probables / points invérifiables
//    sans exécution. Le système ne prétend JAMAIS avoir exécuté le code.
// ─────────────────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(answer: string, accepted: string[]): boolean {
  const a = norm(answer);
  return accepted.some((acc) => {
    const variants = acc.split("|").map((v) => norm(v));
    return variants.some((v) => v === a || (v.length >= 4 && a.includes(v)) || (a.length >= 4 && v.includes(a)));
  });
}

function ok(points: number, max: number, explanation: string, extra?: Partial<CorrectionFeedback>): CorrectionFeedback {
  return { verdict: points >= max ? "correct" : "partial", points, explanation, ...extra };
}

function wrong(explanation: string, extra?: Partial<CorrectionFeedback>): CorrectionFeedback {
  return { verdict: "incorrect", points: 0, explanation, ...extra };
}

// ── Grille IA (réponses ouvertes) ────────────────────────────────────────────
interface AiGrade {
  criteria: { criterion: string; awarded: number; max: number; comment?: string }[];
  total_awarded: number;
  explanation: string;
  uncertain?: boolean;
}

async function gradeWithAi(
  question: Question,
  userAnswer: string,
  passages: RagPassage[],
  userId: string
): Promise<CorrectionFeedback> {
  const max = question.points;
  const grid = [
    "Exactitude (réponse fidèle au cours)",
    "Respect des notions du cours",
    "Qualité du raisonnement",
    "Clarté et justification",
  ];
  const context = passages
    .slice(0, 6)
    .map((p) => `[${p.documentName}${p.section ? ` — ${p.section}` : ""}]\n${p.content.slice(0, 900)}`)
    .join("\n\n");

  const system =
    "Tu es un correcteur rigoureux et bienveillant pour des étudiants en informatique. " +
    "Tu évalues selon une grille fournie, en te basant PRIORITAIREMENT sur les extraits de cours fournis. " +
    "Tu ne justifies jamais une note sans critères. Réponds STRICTEMENT en JSON valide, sans texte autour.";
  const user = `Évalue la réponse de l'étudiant.

## Énoncé
${question.statement}
${question.instructions ? `\nConsignes : ${question.instructions}` : ""}

## Réponse attendue (référence du professeur)
${question.explanation || question.acceptedAnswers?.join(" ; ") || "Évalue la qualité académique et la cohérence avec le cours."}

## Extraits du cours de l'étudiant
${context || "(aucun extrait fourni — base-toi sur l'énoncé uniquement)"}

## Réponse de l'étudiant
${userAnswer.slice(0, 6000)}

## Barème total
${max} point(s)

## Grille
${grid.map((g, i) => `${i + 1}. ${g}`).join("\n")}

Réponds en JSON exactement :
{"criteria":[{"criterion":"...","awarded":0,"max":0,"comment":"..."}],"total_awarded":0,"explanation":"...","uncertain":false}
- total_awarded = somme des awarded (entre 0 et ${max}).
- explanation : 2 à 5 phrases pédagogiques citant le cours si pertinent.`;

  const res = await ai.completeJson<AiGrade>("grading", system, user, { userId, timeoutMs: 90_000 });
  if (!res.ok || !res.data) {
    return {
      verdict: "partial",
      points: 0,
      uncertain: true,
      explanation: `La correction automatique est momentanément indisponible (${res.error ?? "erreur IA"}). Votre réponse a été enregistrée : consultez la correction manuelle plus tard.`,
    };
  }
  const criteria: CriterionScore[] = (res.data.criteria ?? []).map((c) => ({
    criterion: c.criterion,
    awarded: Math.max(0, Math.min(Number(c.awarded) || 0, Number(c.max) || 0)),
    max: Number(c.max) || 0,
    comment: c.comment,
  }));
  const awarded = criteria.length
    ? Math.min(criteria.reduce((s, c) => s + c.awarded, 0), max)
    : Math.max(0, Math.min(Number(res.data.total_awarded) || 0, max));
  return {
    verdict: awarded >= max * 0.999 ? "correct" : awarded > 0 ? "partial" : "incorrect",
    points: Math.round(awarded * 100) / 100,
    criteria,
    explanation: res.data.explanation ?? "Évaluation par l'IA selon la grille.",
    uncertain: res.data.uncertain,
    sources: passages.slice(0, 3).map((p) => ({ document: p.documentName, section: p.section })),
  };
}

// ── Analyse statique de code (IA, sans exécution) ────────────────────────────
interface StaticCodeGrade extends AiGrade {
  detected_errors?: string[];
  probable_issues?: string[];
  unverifiable_points?: string[];
  behavior_summary?: string;
}

const STATIC_CODE_SYSTEM =
  "Tu es un enseignant d'informatique qui corrige du code PAR ANALYSE STATIQUE uniquement. " +
  "INTERDIT absolu : tu ne peux pas exécuter, compiler ni interpréter le code. Tu le LIS et tu raisonnes. " +
  "Tu dois distinguer explicitement trois catégories : " +
  "(1) erreurs détectables avec certitude par lecture (syntaxe, variable non déclarée, logique manifestement fausse), " +
  "(2) problèmes probables (suspicion fondée mais non certaine par simple lecture), " +
  "(3) points impossibles à confirmer sans exécution (valeurs d'entrée, comportement à l'exécution, performances). " +
  "Ne prétends JAMAIS avoir exécuté le code : exprime les prédictions comme des raisonnements ('d'après la lecture', 'semble produire'). " +
  "Réponds STRICTEMENT en JSON valide, sans texte autour.";

async function gradeCodeStatic(
  question: Question,
  userCode: string,
  passages: RagPassage[],
  userId: string
): Promise<CorrectionFeedback> {
  if (!userCode.trim()) return wrong("Aucun code soumis.");
  const max = question.points;
  const language = question.language ?? "python";
  const tests = (question.testCases ?? []).map(
    (tc) => `- ${tc.name} : sortie attendue « ${tc.expected.slice(0, 200)} »${tc.stdin ? ` (entrée fournie : « ${tc.stdin.slice(0, 200)} »)` : ""}`
  );
  const context = passages
    .slice(0, 4)
    .map((p) => `[${p.documentName}${p.section ? ` — ${p.section}` : ""}]\n${p.content.slice(0, 700)}`)
    .join("\n\n");

  const user = `## Énoncé de l'exercice
${question.statement}
${question.instructions ? `\nConsignes : ${question.instructions}` : ""}

## Langage attendu
${language}

## Code soumis par l'étudiant (lecture seule — NE L'EXÉCUTE PAS)
\`\`\`${language}
${userCode.slice(0, 6000)}
\`\`\`
${question.solutionCode ? `\n## Solution de référence du professeur\n\`\`\`${language}\n${question.solutionCode.slice(0, 3000)}\n\`\`\`` : ""}
${tests.length ? `\n## Cas de test attendus (à raisonner statiquement, PAS à exécuter)\n${tests.join("\n")}` : ""}
${context ? `\n## Extraits du cours de l'étudiant\n${context}` : ""}

## Barème total
${max} point(s)

## Tâche
1. Lis le code ligne à ligne et décris brièvement ce qu'il fait (behavior_summary).
2. Détecte les erreurs certaines (syntaxe, logique manifeste, non-conformité à la consigne) → detected_errors.
3. Signale les problèmes probables (suspices non certains) → probable_issues.
4. Liste ce qu'il est impossible de confirmer sans exécution → unverifiable_points.
5. Note selon la grille : exactitude vis-à-vis de la consigne, cohérence logique, qualité du code, conformité aux cas de test (par raisonnement).

Réponds en JSON exactement :
{"criteria":[{"criterion":"...","awarded":0,"max":0,"comment":"..."}],"total_awarded":0,"explanation":"2 à 5 phrases pédagogiques","uncertain":false,"detected_errors":["..."],"probable_issues":["..."],"unverifiable_points":["..."],"behavior_summary":"..."}`;

  const res = await ai.completeJson<StaticCodeGrade>("grading", STATIC_CODE_SYSTEM, user, { userId, timeoutMs: 90_000 });
  if (!res.ok || !res.data) {
    // Repli honnête : estimation statique par comparaison avec la solution si disponible
    if (question.solutionCode) {
      const ratio = staticSimilarity(userCode, question.solutionCode);
      const points = Math.round(ratio * max * 0.6 * 100) / 100;
      return {
        verdict: points > 0 ? "partial" : "incorrect",
        points,
        uncertain: true,
        explanation:
          `Correction par analyse statique indisponible (${res.error ?? "erreur IA"}). ` +
          `Une estimation prudente a été faite par comparaison structurelle avec la solution de référence ` +
          `(${Math.round(ratio * 100)} % de similarité), sans exécution ni garantie. Relancez la correction plus tard.`,
        expectedAnswer: question.solutionCode,
      };
    }
    return {
      verdict: "partial",
      points: 0,
      uncertain: true,
      explanation: `La correction statique est momentanément indisponible (${res.error ?? "erreur IA"}). Votre code a été enregistré : relancez la correction plus tard.`,
    };
  }

  const criteria: CriterionScore[] = (res.data.criteria ?? []).map((c) => ({
    criterion: c.criterion,
    awarded: Math.max(0, Math.min(Number(c.awarded) || 0, Number(c.max) || 0)),
    max: Number(c.max) || 0,
    comment: c.comment,
  }));
  const awarded = criteria.length
    ? Math.min(criteria.reduce((s, c) => s + c.awarded, 0), max)
    : Math.max(0, Math.min(Number(res.data.total_awarded) || 0, max));

  const sections: string[] = [];
  if (res.data.behavior_summary) sections.push(`Lecture du code : ${res.data.behavior_summary}`);
  if (res.data.detected_errors?.length) sections.push(`Erreurs détectées (analyse statique) :\n- ${res.data.detected_errors.join("\n- ")}`);
  if (res.data.probable_issues?.length) sections.push(`Problèmes probables :\n- ${res.data.probable_issues.join("\n- ")}`);
  if (res.data.unverifiable_points?.length) sections.push(`Invérifiable sans exécution :\n- ${res.data.unverifiable_points.join("\n- ")}`);
  if (res.data.explanation) sections.push(res.data.explanation);

  return {
    verdict: awarded >= max * 0.999 ? "correct" : awarded > 0 ? "partial" : "incorrect",
    points: Math.round(awarded * 100) / 100,
    criteria,
    explanation: sections.join("\n\n") || "Analyse statique terminée.",
    uncertain: res.data.uncertain,
    expectedAnswer: question.solutionCode,
    sources: passages.slice(0, 3).map((p) => ({ document: p.documentName, section: p.section })),
  };
}

/** Similarité structurelle prudente (fallback uniquement, jamais présentée comme exécution). */
function staticSimilarity(a: string, b: string): number {
  const ta = new Set(norm(a).split(/\s+/).filter(Boolean));
  const tb = new Set(norm(b).split(/\s+/).filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.max(ta.size, tb.size);
}

// ── Analyse statique SQL (IA, sans exécution) ────────────────────────────────
interface StaticSqlGrade extends AiGrade {
  syntax_errors?: string[];
  structure_notes?: string[];
  logic_issues?: string[];
  unverifiable_points?: string[];
}

const STATIC_SQL_SYSTEM =
  "Tu es un enseignant qui corrige des requêtes et scripts SQL PAR ANALYSE STATIQUE uniquement, " +
  "ciblant SQLite. INTERDIT absolu : tu ne peux pas exécuter le SQL ni interroger une base. Tu le LIS. " +
  "Évalue : (1) la syntaxe, (2) la structure (tables, colonnes, jointures, agrégats), " +
  "(3) la logique (correspondance entre la requête et le résultat demandé), " +
  "(4) les relations (clés, cardinalités), (5) la conformité à la consigne. " +
  "Distingue erreurs certaines / problèmes probables / points invérifiables sans exécution " +
  "(par ex. le contenu réel des données au moment de l'exécution). " +
  "Ne prétends JAMAIS avoir exécuté la requête. Réponds STRICTEMENT en JSON valide, sans texte autour.";

/** Pré-contrôles déterministes sans exécution : syntaxe manifestement cassée. */
function sqlStaticSanityCheck(sql: string): string | null {
  const trimmed = sql.trim();
  if (!trimmed) return "Aucune requête soumise.";
  // Guillemes / parenthèses équilibrés (hors chaînes simplifiées)
  const singles = (trimmed.match(/'/g) ?? []).length;
  if (singles % 2 !== 0) return "Erreur de syntaxe probable : apostrophe non fermée dans une chaîne de caractères.";
  const open = (trimmed.match(/\(/g) ?? []).length;
  const close = (trimmed.match(/\)/g) ?? []).length;
  if (open !== close) return `Erreur de syntaxe probable : parenthèses déséquilibrées (${open} ouvrante(s), ${close} fermante(s)).`;
  if (/;\s*(drop|delete|update|alter)\s+/i.test(trimmed) && !/drop|delete|update|alter/i.test(trimmed.replace(/;\s*(drop|delete|update|alter)\s+/gi, ""))) {
    // instruction destructrice seule — signalée, laissé à l'évaluation
  }
  return null;
}

async function gradeSqlStatic(
  question: Question,
  userSql: string,
  passages: RagPassage[],
  userId: string,
  kind: "query" | "create_table" | "database"
): Promise<CorrectionFeedback> {
  const sanity = sqlStaticSanityCheck(userSql);
  if (sanity) return wrong(sanity);

  const max = question.points;
  const context = passages
    .slice(0, 4)
    .map((p) => `[${p.documentName}${p.section ? ` — ${p.section}` : ""}]\n${p.content.slice(0, 700)}`)
    .join("\n\n");

  const kindLabel =
    kind === "query"
      ? "requête(s) SQL devant produire le résultat décrit"
      : kind === "create_table"
        ? "script de création de tables (CREATE TABLE)"
        : "script SQL de création / modification de base";

  const user = `## Énoncé de l'exercice
${question.statement}
${question.instructions ? `\nConsignes : ${question.instructions}` : ""}

## Type de exercice
${kindLabel}

## SQL soumis par l'étudiant (lecture seule — NE L'EXÉCUTE PAS)
\`\`\`sql
${userSql.slice(0, 6000)}
\`\`\`
${question.fixtureSql && question.fixtureSql !== "SELECT 1;" ? `\n## Environnement de référence (script de création/insertion KNOWN — décrit les tables disponibles)\n\`\`\`sql\n${question.fixtureSql.slice(0, 2500)}\n\`\`\`` : ""}
${question.referenceSql ? `\n## Solution de référence du professeur\n\`\`\`sql\n${question.referenceSql.slice(0, 2500)}\n\`\`\`` : ""}
${context ? `\n## Extraits du cours de l'étudiant\n${context}` : ""}

## Barème total
${max} point(s)

## Tâche
Analyse statiquement : syntaxe (syntax_errors), structure (structure_notes), logique et cohérence avec le résultat demandé (logic_issues), conformité à la consigne. Si une solution de référence existe, compare les deux approches : des formulations différentes restent acceptables si le résultat décrit est équivalent — signale-le dans l'explication.

Réponds en JSON exactement :
{"criteria":[{"criterion":"...","awarded":0,"max":0,"comment":"..."}],"total_awarded":0,"explanation":"2 à 5 phrases pédagogiques","uncertain":false,"syntax_errors":["..."],"structure_notes":["..."],"logic_issues":["..."],"unverifiable_points":["..."]}`;

  const res = await ai.completeJson<StaticSqlGrade>("grading", STATIC_SQL_SYSTEM, user, { userId, timeoutMs: 90_000 });
  if (!res.ok || !res.data) {
    return {
      verdict: "partial",
      points: 0,
      uncertain: true,
      explanation: `La correction statique SQL est momentanément indisponible (${res.error ?? "erreur IA"}). Votre requête a été enregistrée : relancez la correction plus tard.`,
      expectedAnswer: question.referenceSql,
    };
  }

  const criteria: CriterionScore[] = (res.data.criteria ?? []).map((c) => ({
    criterion: c.criterion,
    awarded: Math.max(0, Math.min(Number(c.awarded) || 0, Number(c.max) || 0)),
    max: Number(c.max) || 0,
    comment: c.comment,
  }));
  const awarded = criteria.length
    ? Math.min(criteria.reduce((s, c) => s + c.awarded, 0), max)
    : Math.max(0, Math.min(Number(res.data.total_awarded) || 0, max));

  const sections: string[] = [];
  if (res.data.syntax_errors?.length) sections.push(`Syntaxe :\n- ${res.data.syntax_errors.join("\n- ")}`);
  if (res.data.structure_notes?.length) sections.push(`Structure :\n- ${res.data.structure_notes.join("\n- ")}`);
  if (res.data.logic_issues?.length) sections.push(`Logique :\n- ${res.data.logic_issues.join("\n- ")}`);
  if (res.data.unverifiable_points?.length) sections.push(`Invérifiable sans exécution :\n- ${res.data.unverifiable_points.join("\n- ")}`);
  if (res.data.explanation) sections.push(res.data.explanation);

  return {
    verdict: awarded >= max * 0.999 ? "correct" : awarded > 0 ? "partial" : "incorrect",
    points: Math.round(awarded * 100) / 100,
    criteria,
    explanation: sections.join("\n\n") || "Analyse statique SQL terminée.",
    uncertain: res.data.uncertain,
    expectedAnswer: question.referenceSql,
    sources: passages.slice(0, 3).map((p) => ({ document: p.documentName, section: p.section })),
  };
}

// ── Plus longue sous-séquence commune (ordre relatif réel) ───────────────────
function longestCommonSubsequence(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Point d'entrée principal ─────────────────────────────────────────────────
export async function gradeAnswer(
  question: Question,
  userAnswer: unknown,
  passages: RagPassage[],
  userId: string
): Promise<CorrectionFeedback> {
  const max = question.points;
  const asString = typeof userAnswer === "string" ? userAnswer : JSON.stringify(userAnswer ?? "");

  switch (question.type) {
    case "qcm_single": {
      const picked = typeof userAnswer === "string" ? userAnswer : null;
      const correct = question.options?.find((o) => o.correct);
      if (!picked) return wrong("Aucune réponse sélectionnée.", { expectedAnswer: correct?.label });
      if (correct && picked === correct.id) return ok(max, max, question.explanation ?? "Bonne réponse !", { expectedAnswer: correct.label });
      const chosen = question.options?.find((o) => o.id === picked);
      return wrong(`Réponse incorrecte : « ${chosen?.label ?? "?"} ».
      ${question.explanation ?? ""}`, { expectedAnswer: correct?.label });
    }

    case "qcm_multiple": {
      const picked = Array.isArray(userAnswer) ? (userAnswer as string[]) : [];
      const correctIds = new Set((question.options ?? []).filter((o) => o.correct).map((o) => o.id));
      if (picked.length === 0) return wrong("Aucune réponse sélectionnée.");
      // Question mal formée (aucune option correcte définie) : évaluation IA de secours
      if (correctIds.size === 0) {
        return gradeWithAi(
          question,
          picked.join(", "),
          passages,
          userId
        );
      }
      const correctPicked = picked.filter((p) => correctIds.has(p)).length;
      const wrongPicked = picked.filter((p) => !correctIds.has(p)).length;
      const score = Math.max(0, (correctPicked - wrongPicked) / correctIds.size) * max;
      return ok(Math.round(score * 100) / 100, max, `${correctPicked}/${correctIds.size} bonne(s) réponse(s) sélectionnée(s)${wrongPicked ? `, ${wrongPicked} erronée(s)` : ""}. ${question.explanation ?? ""}`);
    }

    case "true_false": {
      const picked = typeof userAnswer === "boolean" ? userAnswer : typeof userAnswer === "string" ? userAnswer === "true" : null;
      if (picked === null) return wrong("Aucune réponse sélectionnée.");
      const expected = question.options?.[0]?.correct ?? false;
      return picked === expected
        ? ok(max, max, question.explanation ?? "Exact !")
        : wrong(`Inexact. La réponse attendue est « ${expected ? "Vrai" : "Faux"} ». ${question.explanation ?? ""}`, { expectedAnswer: expected ? "Vrai" : "Faux" });
    }

    case "fill_blank": {
      const blanks = Array.isArray(userAnswer) ? (userAnswer as string[]) : [];
      const expected = question.blanks ?? [];
      if (expected.length === 0) return ok(max, max, question.explanation ?? "");
      let filled = 0;
      const detail: string[] = [];
      expected.forEach((acc, i) => {
        const variants = acc.split("|");
        if (blanks[i] != null && matchesAny(blanks[i], variants)) {
          filled++;
          detail.push(`✓ Trou ${i + 1}`);
        } else {
          detail.push(`✗ Trou ${i + 1} : attendu « ${variants[0]} »${blanks[i] ? `, obtenu « ${blanks[i]} »` : " (vide)"}`);
        }
      });
      const points = Math.round((filled / expected.length) * max * 100) / 100;
      return ok(points, max, `${filled}/${expected.length} trou(s) correct(s).\n${detail.join("\n")}\n${question.explanation ?? ""}`);
    }

    case "short_answer": {
      if (!asString.trim()) return wrong("Réponse vide.");
      const accepted = question.acceptedAnswers ?? [];
      if (accepted.length && matchesAny(asString, accepted)) return ok(max, max, question.explanation ?? "Exact !");
      // Pas de correspondance déterministe → l'IA apprécie la réponse
      const aiRes = await gradeWithAi(question, asString, passages, userId);
      return aiRes;
    }

    case "matching": {
      const pairs = question.pairs ?? [];
      const answer = (typeof userAnswer === "object" && userAnswer !== null ? userAnswer : {}) as Record<string, string>;
      if (!pairs.length) return ok(max, max, question.explanation ?? "");
      let good = 0;
      for (const p of pairs) {
        if (answer[p.left] && norm(answer[p.left]) === norm(p.right)) good++;
      }
      const points = Math.round((good / pairs.length) * max * 100) / 100;
      const detail = pairs.map((p) => `${answer[p.left] && norm(answer[p.left]) === norm(p.right) ? "✓" : "✗"} ${p.left} → ${p.right}`).join("\n");
      return ok(points, max, `${good}/${pairs.length} association(s) correcte(s).\n${detail}`);
    }

    case "ordering": {
      const expected = question.orderedItems ?? [];
      const answer = Array.isArray(userAnswer) ? (userAnswer as string[]) : [];
      if (!expected.length) return ok(max, max, question.explanation ?? "");
      let inPlace = 0;
      expected.forEach((item, i) => {
        if (answer[i] && norm(answer[i]) === norm(item)) inPlace++;
      });
      // Crédit partiel basé sur la vraie plus longue sous-séquence commune (ordre relatif respecté)
      const lcs = longestCommonSubsequence(expected.map(norm), answer.map(norm));
      const points = Math.round(Math.max(inPlace / expected.length, (lcs / expected.length) * 0.7) * max * 100) / 100;
      return ok(
        points,
        max,
        `Ordre correct pour ${inPlace}/${expected.length} éléments (${lcs} dans le bon ordre relatif).\nSéquence attendue :\n${expected.map((e, i) => `${i + 1}. ${e}`).join("\n")}`
      );
    }

    case "error_identification": {
      const answer = (typeof userAnswer === "object" && userAnswer !== null ? userAnswer : {}) as { line?: number; explanation?: string };
      const expectedLine = question.errorLine;
      const lineOk = expectedLine != null && Number(answer.line) === expectedLine;
      const explanationOk = Boolean(answer.explanation) && norm(answer.explanation ?? "").split(/\s+/).filter(Boolean).length >= 3;
      const pts = (lineOk ? max * 0.5 : 0) + (explanationOk ? max * 0.5 : 0);
      return ok(
        Math.round(pts * 100) / 100,
        max,
        `${lineOk ? "✓ Ligne correcte identifiée" : `✗ Ligne attendue : ${expectedLine}`}${explanationOk ? "\n✓ Explication pertinente" : "\n✗ Explication absente ou trop courte"}\n${question.explanation ?? ""}`
      );
    }

    case "code_output": {
      if (!asString.trim()) return wrong("Réponse vide.");
      const expected = question.expectedOutput ?? "";
      const normalizedUser = asString.trim().split("\n").map((l) => l.trim()).join("\n");
      const normalizedExpected = expected.trim().split("\n").map((l) => l.trim()).join("\n");
      return normalizedUser === normalizedExpected
        ? ok(max, max, question.explanation ?? "Sortie exacte !")
        : wrong(`Sortie attendue :\n${normalizedExpected}\n\nVotre réponse :\n${normalizedUser.slice(0, 300)}`, { expectedAnswer: normalizedExpected });
    }

    // Code : analyse statique par IA, sans compilation ni exécution (exigence plateforme)
    case "code_write":
    case "code_fix":
    case "debug":
      return gradeCodeStatic(question, asString, passages, userId);

    // SQL : analyse statique (syntaxe, structure, logique, relations, consigne)
    case "sql_query":
      return gradeSqlStatic(question, asString, passages, userId, "query");

    case "sql_create_table":
      return gradeSqlStatic(question, asString, passages, userId, "create_table");

    case "sql_database":
      return gradeSqlStatic(question, asString, passages, userId, "database");

    case "open_question":
    case "case_study":
    case "data_modeling":
    case "combined":
    case "exam_composite":
    default: {
      if (!asString.trim() || asString.trim().length < 5) {
        return wrong("Réponse vide ou trop courte pour être évaluée.");
      }
      return gradeWithAi(question, asString, passages, userId);
    }
  }
}

/** Met à jour les statistiques de notions après une correction. */
export async function updateConceptStats(userId: string, question: Question, feedback: CorrectionFeedback) {
  for (const notion of question.notions?.length ? question.notions : ["Général"]) {
    const existing = await db.conceptStat.findUnique({ where: { userId_notion: { userId, notion } } });
    const attempts = (existing?.attempts ?? 0) + 1;
    const correct = (existing?.correct ?? 0) + (feedback.verdict === "correct" ? 1 : 0);
    const partial = (existing?.partial ?? 0) + (feedback.verdict === "partial" ? 1 : 0);
    // Maîtrise : EMA pondérée — une seule réussite ne suffit pas
    const verdictScore = feedback.verdict === "correct" ? 1 : feedback.verdict === "partial" ? 0.5 : 0;
    const prev = existing?.mastery ?? 0.3;
    const mastery = Math.max(0, Math.min(1, prev * 0.6 + verdictScore * 0.4));
    await db.conceptStat.upsert({
      where: { userId_notion: { userId, notion } },
      create: { userId, notion, attempts: 1, correct: feedback.verdict === "correct" ? 1 : 0, partial: feedback.verdict === "partial" ? 1 : 0, mastery },
      update: { attempts, correct, partial, mastery, lastSeen: new Date() },
    });
  }
}
