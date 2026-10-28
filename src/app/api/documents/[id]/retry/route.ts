import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, ApiHttpError } from "@/lib/api-helpers";
import { chunkText } from "@/lib/extraction";

/** Relance le traitement d'un document en échec.
 *  Le binaire original n'est pas conservé : la re-extraction est impossible.
 *  En revanche, si le texte avait été extrait avant l'erreur, on reconstruit
 *  l'index (découpage) sans perdre les données déjà traitées. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const doc = await db.document.findFirst({ where: { id, userId: user.id } });
    if (!doc) throw new ApiHttpError("Document introuvable.", 404);

    await db.document.update({ where: { id }, data: { status: "PROCESSING", error: null } });

    try {
      if (!doc.extractedText || doc.extractedText.trim().length < 20) {
        throw new Error(
          "Le contenu source n'est pas conservé après la première extraction ; réimportez le fichier depuis la Bibliothèque.",
        );
      }

      // Reconstruction de l'index à partir du texte déjà extrait (aucune perte).
      await db.documentChunk.deleteMany({ where: { documentId: id } });
      const chunks = chunkText(doc.extractedText);
      if (chunks.length > 0) {
        await db.documentChunk.createMany({
          data: chunks.map((c, i) => ({
            documentId: id,
            idx: i,
            section: c.section ?? null,
            content: c.content.slice(0, 4000),
            words: c.content.split(/\s+/).length,
          })),
        });
      }

      await db.document.update({ where: { id }, data: { status: "READY", error: null } });
      return { ok: true, status: "READY", chunks: chunks.length };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Échec du retraitement.";
      await db.document.update({ where: { id }, data: { status: "ERROR", error: message } });
      throw new ApiHttpError(message, 422);
    }
  });
}
