import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson, ApiHttpError } from "@/lib/api-helpers";
import { generateExercises } from "@/lib/generation";
import { QUESTION_TYPES } from "@/lib/types";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const exercises = await db.exercise.findMany({
      where: { userId: user.id },
      include: { subject: { select: { name: true, color: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      exercises: exercises.map((e) => ({
        ...e,
        questionCount: JSON.parse(e.questions).length,
        questions: undefined,
      })),
    };
  });
}

const generateSchema = z.object({
  subjectId: z.string().optional(),
  chapterId: z.string().optional(),
  documentIds: z.array(z.string()).min(1, "Sélectionnez au moins un document"),
  themes: z.array(z.string()).max(10).default([]),
  difficulty: z.enum(["decouverte", "facile", "moyen", "difficile", "expert"]),
  questionCount: z.number().int().min(1).max(20),
  types: z.array(z.enum(QUESTION_TYPES)).min(1, "Choisissez au moins un type d'exercice"),
  mode: z.enum(["apprentissage", "entrainement", "examen", "revision", "personnalise"]),
  durationMin: z.number().int().min(1).max(240).optional(),
  pointsPerQuestion: z.number().int().min(1).max(20).optional(),
  theoryPracticeMix: z.number().int().min(0).max(100).optional(),
  hintsEnabled: z.boolean(),
  correctionTiming: z.enum(["immediate", "end"]),
});

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`generate:${user.id}`, 8, 5 * 60_000);
    const config = generateSchema.parse(await readJson<unknown>(req));

    // Vérification des documents
    const docs = await db.document.findMany({ where: { id: { in: config.documentIds }, userId: user.id, status: "READY" } });
    if (docs.length === 0) throw new ApiHttpError("Aucun des documents sélectionnés n'est disponible (extrayez-les d'abord).", 422);

    // La matière éventuelle doit appartenir au compte ET correspondre aux documents :
    // on ne mélange pas des documents d'une autre matière (jamais de déduction par le nom).
    if (config.subjectId) {
      const subject = await db.subject.findFirst({ where: { id: config.subjectId, userId: user.id } });
      if (!subject) throw new ApiHttpError("Matière introuvable.", 404);
      const incoherent = docs.filter((d) => d.subjectId !== config.subjectId);
      if (incoherent.length > 0) {
        throw new ApiHttpError(
          `${incoherent.length} document(s) sélectionné(s) n'appartiennent pas à la matière « ${subject.name} ». Désélectionnez-les ou changez de matière.`,
          422,
        );
      }
    }
    // Si tous les documents partagent un chapitre, on l'enregistre dans la configuration
    // pour que la session puisse tracer son périmètre exact.
    const chapterIds = new Set(docs.map((d) => d.chapterId).filter((v): v is string => Boolean(v)));
    const commonChapterId = chapterIds.size === 1 ? [...chapterIds][0] : undefined;

    const result = await generateExercises(config, user.id);
    if (!result.ok) throw new Error(result.error);

    const title = `${docs[0].name} — ${new Date().toLocaleDateString("fr-FR")}`;
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        subjectId: config.subjectId ?? null,
        title,
        config: JSON.stringify({ ...config, chapterId: commonChapterId ?? config.chapterId ?? undefined }),
        questions: JSON.stringify(result.questions),
      },
    });
    return { ok: true, exerciseId: exercise.id, questionCount: result.questions.length };
  });
}
