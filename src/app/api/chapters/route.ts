import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, readJson, ApiHttpError } from "@/lib/api-helpers";

const chapterSchema = z.object({
  subjectId: z.string().min(1, "Matière requise"),
  name: z.string().min(1, "Nom requis").max(120),
  description: z.string().max(500).optional(),
  position: z.number().int().min(0).optional(),
});

function normalizeChapterName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const data = chapterSchema.parse(await readJson<unknown>(req));

    // Un chapitre DOIT appartenir à une matière existante du compte.
    const subject = await db.subject.findFirst({ where: { id: data.subjectId, userId: user.id } });
    if (!subject) throw new ApiHttpError("Matière introuvable — impossible de créer le chapitre.", 404);

    // Les doublons sont jugés DANS la matière concernée : deux chapitres du même
    // nom dans des matières différentes sont autorisés.
    const siblings = await db.chapter.findMany({ where: { subjectId: data.subjectId }, select: { id: true, name: true } });
    const dup = siblings.find((c) => normalizeChapterName(c.name) === normalizeChapterName(data.name));
    if (dup) {
      throw new ApiHttpError(
        `La matière « ${subject.name} » contient déjà un chapitre nommé « ${dup.name} ».`,
        409,
        { duplicateOf: dup.id },
      );
    }

    const count = await db.chapter.count({ where: { subjectId: data.subjectId } });
    const chapter = await db.chapter.create({
      data: {
        subjectId: data.subjectId,
        name: data.name.trim().replace(/\s+/g, " "),
        description: data.description ?? null,
        position: data.position ?? count,
      },
      include: { _count: { select: { documents: true } } },
    });
    return { chapter };
  });
}
