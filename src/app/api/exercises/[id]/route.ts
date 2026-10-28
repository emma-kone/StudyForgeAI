import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const exercise = await db.exercise.findFirst({ where: { id, userId: user.id } });
    if (!exercise) throw new Error("Exercice introuvable.");
    await db.exercise.delete({ where: { id } });
    return { ok: true };
  });
}
