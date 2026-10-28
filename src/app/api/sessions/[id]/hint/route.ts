import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";

const hintSchema = z.object({ questionIdx: z.number().int().min(0) });

/** Fournit l'indice suivant d'une question.
 *  Le compteur d'indices est PAR QUESTION (SessionItem.hintsUsed) :
 *  les indices demandés sur une autre question n'influencent pas celui-ci.
 *  Les indices sont refusés en mode examen et quand ils sont désactivés. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const { questionIdx } = hintSchema.parse(await readJson<unknown>(req));
    const session = await db.session.findFirst({ where: { id, userId: user.id } });
    if (!session) throw new Error("Session introuvable.");
    if (session.status !== "IN_PROGRESS") throw new Error("Session déjà soumise.");

    const config = session.config ? (JSON.parse(session.config) as { hintsEnabled?: boolean }) : {};
    if (session.mode === "examen" || config.hintsEnabled === false) {
      throw new Error("Les indices ne sont pas disponibles pour cette session.");
    }

    const questions: Question[] = JSON.parse(session.questions);
    const hints = questions[questionIdx]?.hints ?? [];
    if (hints.length === 0) return { hint: null, remaining: 0, message: "Aucun indice disponible pour cette question." };

    const item = await db.sessionItem.findFirst({ where: { sessionId: id, questionIdx } });
    if (!item) throw new Error("Item de session introuvable.");

    const used = Math.min(item.hintsUsed, hints.length - 1);
    await db.$transaction([
      db.sessionItem.update({ where: { id: item.id }, data: { hintsUsed: used + 1 } }),
      db.session.update({ where: { id }, data: { hintsUsed: { increment: 1 } } }),
    ]);
    return { hint: hints[used], remaining: hints.length - used - 1 };
  });
}

type Question = import("@/lib/types").Question;
