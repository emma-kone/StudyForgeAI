import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { analyzeDocument } from "@/lib/generation";
import { limit } from "@/lib/api-helpers";

/** Analyse IA d'un document (matière, notions, définitions, méthodes…). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    limit(`analyze:${user.id}`, 12, 5 * 60_000);
    const doc = await db.document.findFirst({ where: { id, userId: user.id } });
    if (!doc) throw new Error("Document introuvable.");
    if (doc.status !== "READY" || !doc.extractedText) {
      throw new Error("Le document doit être extrait avec succès avant l'analyse IA.");
    }
    const result = await analyzeDocument(id, user.id);
    if (!result.ok) throw new Error(result.error);
    return { ok: true, analysis: result.analysis };
  });
}
