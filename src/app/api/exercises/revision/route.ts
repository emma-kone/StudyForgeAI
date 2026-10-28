import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { generateTargetedRevision } from "@/lib/generation";

const revisionSchema = z.object({
  notion: z.string().min(1).max(120),
  difficulty: z.enum(["decouverte", "facile", "moyen", "difficile", "expert"]).default("moyen"),
});

/** Génération d'une révision ciblée sur une notion faible. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { notion, difficulty } = revisionSchema.parse(await readJson<unknown>(req));
    const result = await generateTargetedRevision(notion, user.id, difficulty);
    if (!result.ok) throw new Error(result.error);
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        title: `Révision ciblée — ${notion}`,
        config: JSON.stringify({ mode: "revision", themes: [notion], difficulty }),
        questions: JSON.stringify(result.questions),
      },
    });
    return { ok: true, exerciseId: exercise.id, questionCount: result.questions.length };
  });
}
