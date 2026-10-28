import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const session = await db.session.findFirst({ where: { id, userId: user.id } });
    if (!session) throw new Error("Session introuvable.");

    const items = await db.sessionItem.findMany({
      where: { sessionId: id },
      include: { answers: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { questionIdx: "asc" },
    });

    const questions: QuestionLite[] = JSON.parse(session.questions);
    const examMode = session.mode === "examen";
    const submitted = session.status !== "IN_PROGRESS";

    // Questions envoyées SANS les éléments de correction tant que la session est en cours :
    // - en examen : ni indices ni explications ni options marquées ;
    // - sinon : pas de solution de référence ni d'explication (l'explication arrive via la correction).
    const safeQuestions: QuestionLite[] = questions.map((q) => {
      if (examMode && !submitted) {
        const { hints, explanation, ...rest } = q;
        if (rest.options) rest.options = rest.options.map((o) => ({ id: o.id, label: o.label, correct: false }));
        return rest as QuestionLite;
      }
      if (!submitted) {
        const { explanation, ...rest } = q;
        delete (rest as Partial<QuestionLite>).solutionCode;
        delete (rest as Partial<QuestionLite>).referenceSql;
        return rest as QuestionLite;
      }
      return q;
    });

    return {
      session: {
        id: session.id,
        title: session.title,
        mode: session.mode,
        status: session.status,
        config: session.config ? JSON.parse(session.config) : null,
        startedAt: session.startedAt,
        finishedAt: session.finishedAt,
        durationSec: session.durationSec,
        score: session.score,
        maxScore: session.maxScore,
        percentage: session.percentage,
        summary: session.summary ? JSON.parse(session.summary) : null,
        hintsUsed: session.hintsUsed,
      },
      questions: safeQuestions,
      items: items.map((it) => ({
        id: it.id,
        questionIdx: it.questionIdx,
        maxPoints: it.maxPoints,
        points: it.points,
        status: it.status,
        graded: it.graded,
        hintsUsed: it.hintsUsed,
        lastAnswer: it.answers[0]?.value ?? null,
        feedback: submitted && it.answers[0] ? (it.answers[0].feedback ? JSON.parse(it.answers[0].feedback) : null) : null,
      })),
    };
  });
}

type QuestionLite = import("@/lib/types").Question;

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const session = await db.session.findFirst({ where: { id, userId: user.id } });
    if (!session) throw new Error("Session introuvable.");
    await db.session.delete({ where: { id } });
    return { ok: true };
  });
}
