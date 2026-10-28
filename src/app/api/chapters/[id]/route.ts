import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, readJson, ApiHttpError } from "@/lib/api-helpers";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  position: z.number().int().min(0).optional(),
  /** Déplacement du chapitre vers une autre matière : la cohérence des
   *  documents rattachés est mise à jour dans la même transaction. */
  subjectId: z.string().optional(),
});

function normalizeChapterName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

async function findOwnedChapter(id: string, userId: string) {
  const chapter = await db.chapter.findFirst({ where: { id }, include: { subject: true } });
  if (!chapter || chapter.subject.userId !== userId) throw new ApiHttpError("Chapitre introuvable.", 404);
  return chapter;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const chapter = await findOwnedChapter(id, user.id);
    const [docCount] = await Promise.all([db.document.count({ where: { chapterId: id } })]);
    return {
      chapter,
      consequences: { documents: docCount },
    };
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const data = patchSchema.parse(await readJson<unknown>(req));
    const chapter = await findOwnedChapter(id, user.id);

    // ── Déplacement vers une autre matière ──
    if (data.subjectId !== undefined && data.subjectId !== chapter.subjectId) {
      const target = await db.subject.findFirst({ where: { id: data.subjectId, userId: user.id } });
      if (!target) throw new ApiHttpError("Matière de destination introuvable.", 404);

      const siblings = await db.chapter.findMany({ where: { subjectId: target.id }, select: { id: true, name: true } });
      const finalName = data.name?.trim().replace(/\s+/g, " ") ?? chapter.name;
      const dup = siblings.find((c) => c.id !== id && normalizeChapterName(c.name) === normalizeChapterName(finalName));
      if (dup) throw new ApiHttpError(`La matière « ${target.name} » contient déjà un chapitre nommé « ${dup.name} ».`, 409);

      const count = await db.chapter.count({ where: { subjectId: target.id } });
      const [updated] = await db.$transaction([
        db.chapter.update({ where: { id }, data: { subjectId: target.id, position: data.position ?? count } }),
        // Les documents suivent leur chapitre : leur emplacement principal reste cohérent.
        db.document.updateMany({ where: { chapterId: id }, data: { subjectId: target.id } }),
      ]);
      return { chapter: updated };
    }

    // ── Renommage / description / position ──
    const update: Record<string, unknown> = {};
    if (data.name !== undefined) {
      const cleanName = data.name.trim().replace(/\s+/g, " ");
      const siblings = await db.chapter.findMany({ where: { subjectId: chapter.subjectId }, select: { id: true, name: true } });
      const dup = siblings.find((c) => c.id !== id && normalizeChapterName(c.name) === normalizeChapterName(cleanName));
      if (dup) throw new ApiHttpError(`Cette matière contient déjà un chapitre nommé « ${dup.name} ».`, 409);
      update.name = cleanName;
    }
    if (data.description !== undefined) update.description = data.description;
    if (data.position !== undefined) update.position = data.position;
    return { chapter: await db.chapter.update({ where: { id }, data: update }) };
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const chapter = await findOwnedChapter(id, user.id);

    const docCount = await db.document.count({ where: { chapterId: id } });
    const url = new URL(_req.url);
    if (url.searchParams.get("confirmDelete") !== "true") {
      return { requiresConfirmation: true, consequences: { documents: docCount } };
    }

    // Réordonne les chapitres restants de la matière (pas de trou de position)
    const siblings = await db.chapter.findMany({
      where: { subjectId: chapter.subjectId, id: { not: id } },
      orderBy: { position: "asc" },
    });
    await db.$transaction([
      db.chapter.delete({ where: { id } }),
      ...siblings.map((s, i) => db.chapter.update({ where: { id: s.id }, data: { position: i } })),
    ]);
    return { ok: true, deleted: chapter.name };
  });
}
