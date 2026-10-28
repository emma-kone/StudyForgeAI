import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import type { Question, SessionMode } from "@/lib/types";

const startSchema = z.object({
  exerciseId: z.string().min(1, "Exercice requis"),
  mode: z.enum(["apprentissage", "entrainement", "examen", "revision", "personnalise"]).default("apprentissage"),
});

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const sessions = await db.session.findMany({
      where: { userId: user.id },
      include: { subject: { select: { name: true, color: true } } },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
    return { sessions };
  });
}

/** Démarre une session : les questions sont figées en copie dans la session. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { exerciseId, mode } = startSchema.parse(await readJson<unknown>(req));
    const exercise = await db.exercise.findFirst({ where: { id: exerciseId, userId: user.id } });
    if (!exercise) throw new Error("Exercice introuvable.");

    const questions: Question[] = JSON.parse(exercise.questions);
    if (questions.length === 0) throw new Error("Cet exercice ne contient aucune question.");

    const session = await db.session.create({
      data: {
        userId: user.id,
        subjectId: exercise.subjectId,
        title: exercise.title,
        mode,
        config: exercise.config,
        questions: JSON.stringify(questions),
        items: {
          create: questions.map((q, idx) => ({
            exerciseId: exercise.id,
            questionIdx: idx,
            maxPoints: q.points ?? 1,
          })),
        },
      },
    });
    return { ok: true, sessionId: session.id };
  });
}
