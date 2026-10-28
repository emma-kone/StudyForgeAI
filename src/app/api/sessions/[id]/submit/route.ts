import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { gradeAnswer, updateConceptStats } from "@/lib/grading";
import { computeRecommendations } from "@/lib/generation";
import { buildIndex, search } from "@/lib/rag";
import type { CorrectionFeedback, Question, RagPassage, SessionSummary } from "@/lib/types";
import type { SearchIndexEntry } from "@/lib/rag";

/** Soumission finale : corrige tout, calcule la note justifiée, persiste le compte rendu. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const session = await db.session.findFirst({ where: { id, userId: user.id } });
    if (!session) throw new Error("Session introuvable.");
    if (session.status !== "IN_PROGRESS") throw new Error("Session déjà corrigée.");

    const questions: Question[] = JSON.parse(session.questions);
    const items = await db.sessionItem.findMany({
      where: { sessionId: id },
      include: { answers: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { questionIdx: "asc" },
    });

    const config = session.config ? JSON.parse(session.config) : {};
    const documentIds: string[] = Array.isArray(config.documentIds) ? config.documentIds : [];
    let index: SearchIndexEntry[] | null = null;
    const getPassages = async (statement: string): Promise<RagPassage[]> => {
      if (documentIds.length === 0) return [];
      index = index ?? (await buildIndex(documentIds, user.id));
      return search(index, statement, 5);
    };

    const notionMap = new Map<string, { correct: number; total: number }>();
    const toReview = new Set<string>();
    const strengths = new Set<string>();
    let score = 0;
    let maxScore = 0;

    for (const item of items) {
      const question = questions[item.questionIdx];
      if (!question) continue;
      maxScore += item.maxPoints;
      const lastAnswer = item.answers[0];
      const rawValue = lastAnswer ? JSON.parse(lastAnswer.value) : null;

      const isBlank =
        rawValue == null ||
        (typeof rawValue === "string" && rawValue.trim() === "") ||
        (Array.isArray(rawValue) && rawValue.filter((v) => String(v ?? "").trim() !== "").length === 0) ||
        // Réponses-objets (matching, error_identification…) effectivement vides
        (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) &&
          Object.values(rawValue as Record<string, unknown>).every((v) => v == null || String(v ?? "").trim() === ""));

      const passages = isBlank ? [] : await getPassages(question.statement);

      let feedback: CorrectionFeedback = isBlank
        ? { verdict: "skipped", points: 0, explanation: "Aucune réponse fournie pour cette question." }
        : await gradeAnswer(question, rawValue, passages, user.id);

      const sources = passages.slice(0, 3).map((p) => ({ document: p.documentName, section: p.section }));
      // Les items déjà corrigés immédiatement (mode apprentissage) ne sont pas
      // recomptés dans les statistiques de notions : sinon les tentatives sont gonflées.
      if (!isBlank && !item.graded) await updateConceptStats(user.id, question, feedback);

      const points = Math.round(feedback.points * 100) / 100;
      score += points;
      const status = feedback.verdict === "correct" ? "CORRECT" : feedback.verdict === "partial" ? "PARTIAL" : feedback.verdict === "skipped" ? "SKIPPED" : "INCORRECT";

      await db.answer.create({
        data: {
          itemId: item.id,
          value: JSON.stringify(rawValue),
          feedback: JSON.stringify({ ...feedback, sources }),
          gradedBy: feedback.criteria ? "mixed" : "rule",
          attempts: (lastAnswer?.attempts ?? 0) + (isBlank ? 0 : 1),
        },
      });
      await db.sessionItem.update({ where: { id: item.id }, data: { points, status, graded: true } });

      for (const notion of question.notions?.length ? question.notions : ["Général"]) {
        const entry = notionMap.get(notion) ?? { correct: 0, total: 0 };
        entry.total += 1;
        if (feedback.verdict === "correct") {
          entry.correct += 1;
          strengths.add(notion);
        } else {
          toReview.add(notion);
        }
        notionMap.set(notion, entry);
      }
    }

    const percentage = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;
    const durationSec = Math.max(1, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000));

    const summary: SessionSummary = {
      score: Math.round(score * 100) / 100,
      maxScore,
      percentage,
      byNotion: [...notionMap.entries()].map(([notion, v]) => ({ notion, ...v })),
      toReview: [...toReview],
      strengths: [...strengths],
      comment:
        percentage >= 85
          ? "Excellente maîtrise. Poursuivez avec des exercices plus difficiles."
          : percentage >= 60
            ? "Bonne base. Revoyez les notions marquées « à réviser » puis refaites un exercice de difficulté supérieure."
            : percentage > 0
              ? "Des lacunes importantes sont détectées. Relisez les sections du cours citées dans les corrections, puis tentez une révision ciblée."
              : "Aucun point obtenu — consultez les corrections détaillées et relancez une session en mode Apprentissage avec indices.",
    };

    await db.session.update({
      where: { id },
      data: {
        status: "GRADED",
        finishedAt: new Date(),
        durationSec,
        score: summary.score,
        maxScore,
        percentage,
        summary: JSON.stringify(summary),
      },
    });

    await computeRecommendations(user.id);
    return { ok: true, summary };
  });
}
