import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, readJson, ApiHttpError } from "@/lib/api-helpers";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  subjectId: z.string().nullable().optional(),
  chapterId: z.string().nullable().optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const doc = await db.document.findFirst({
      where: { id, userId: user.id },
      include: { chunks: { orderBy: { idx: "asc" }, take: 50 }, analyses: { take: 1 } },
    });
    if (!doc) throw new ApiHttpError("Document introuvable.", 404);
    return {
      document: {
        ...doc,
        analysis: doc.analyses[0] ?? null,
        chunks: doc.chunks.map((c) => ({ id: c.id, section: c.section, content: c.content.slice(0, 1200), words: c.words })),
      },
    };
  });
}

/** Renommage et déplacement. Le déplacement valide la cohérence
 *  matière/chapitre : le chapitre doit appartenir à la matière finale. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const data = patchSchema.parse(await readJson<unknown>(req));
    const doc = await db.document.findFirst({ where: { id, userId: user.id } });
    if (!doc) throw new ApiHttpError("Document introuvable.", 404);

    // État final souhaité (les champs non fournis conservent leur valeur)
    let finalSubjectId = data.subjectId !== undefined ? data.subjectId : doc.subjectId;
    let finalChapterId = data.chapterId !== undefined ? data.chapterId : doc.chapterId;

    if (finalChapterId) {
      const chapter = await db.chapter.findFirst({ where: { id: finalChapterId } });
      if (!chapter || chapter.subjectId !== finalSubjectId) {
        // Tentative d'association incohérente : refusée (jamais de déduction silencieuse).
        throw new ApiHttpError(
          "Le chapitre choisi n'appartient pas à la matière sélectionnée pour ce document.",
          422,
          { chapterSubjectMismatch: true },
        );
      }
      // Le chapitre existe : la matière du document devient celle du chapitre.
      finalSubjectId = chapter.subjectId;
    }
    if (!finalSubjectId && finalChapterId) {
      throw new ApiHttpError("Un document rangé dans un chapitre doit aussi avoir une matière.", 422);
    }

    const updated = await db.document.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim().replace(/\s+/g, " ") } : {}),
        subjectId: finalSubjectId,
        chapterId: finalChapterId,
      },
    });
    return { document: updated };
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const doc = await db.document.findFirst({ where: { id, userId: user.id } });
    if (!doc) throw new ApiHttpError("Document introuvable.", 404);
    await db.document.delete({ where: { id } });
    return { ok: true, deleted: doc.name };
  });
}
