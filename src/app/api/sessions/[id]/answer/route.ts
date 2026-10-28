import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { gradeAnswer, updateConceptStats } from "@/lib/grading";
import { buildIndex, search } from "@/lib/rag";
import type { Question, RagPassage } from "@/lib/types";

const answerSchema = z.object({
  questionIdx: z.number().int().min(0),
  value: z.unknown(),
});

/** Enregistre une réponse. En mode apprentissage avec correction immédiate,
 *  la correction est renvoyée tout de suite ; sinon elle est stockée. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const { questionIdx, value } = answerSchema.parse(await readJson<unknown>(req));

    const session = await db.session.findFirst({ where: { id, userId: user.id } });
    if (!session) throw new Error("Session introuvable.");
    if (session.status !== "IN_PROGRESS") throw new Error("Session déjà soumise.");
    const questions: Question[] = JSON.parse(session.questions);
    const question = questions[questionIdx];
    if (!question) throw new Error("Question introuvable.");

    const item = await db.sessionItem.findFirst({ where: { sessionId: id, questionIdx } });
    if (!item) throw new Error("Item de session introuvable.");

    const config = session.config ? JSON.parse(session.config) : {};
    const immediate = session.mode === "apprentissage" && config.correctionTiming !== "end";

    // RAG : passages pertinents pour la correction (provenance conservée)
    let passages: RagPassage[] = [];
    const documentIds: string[] = config.documentIds ?? [];
    if (documentIds.length > 0) {
      const index = await buildIndex(documentIds, user.id);
      passages = search(index, question.statement, 6);
    }

    const valueJson = JSON.stringify(value ?? null);
    const priorAnswers = await db.answer.findMany({ where: { itemId: item.id } });
    const attempts = session.mode === "apprentissage" ? priorAnswers.length + 1 : 1;

    let feedbackJson: string | null = null;
    let points: number | null = null;
    let status = item.status;

    if (immediate) {
      const feedback = await gradeAnswer(question, value, passages, user.id);
      feedbackJson = JSON.stringify(feedback);
      points = feedback.points;
      status = feedback.verdict === "correct" ? "CORRECT" : feedback.verdict === "partial" ? "PARTIAL" : "INCORRECT";
      await updateConceptStats(user.id, question, feedback);
    }

    const answer = await db.answer.create({
      data: { itemId: item.id, value: valueJson, feedback: feedbackJson, gradedBy: immediate ? "rule" : null, attempts },
    });
    await db.sessionItem.update({ where: { id: item.id }, data: { points, status, graded: immediate } });

    return {
      ok: true,
      saved: true,
      graded: immediate,
      answerId: answer.id,
      feedback: feedbackJson ? JSON.parse(feedbackJson) : null,
    };
  });
}
