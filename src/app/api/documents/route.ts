import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, ApiHttpError } from "@/lib/api-helpers";
import { chunkText, detectExtension, extractContent } from "@/lib/extraction";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const subjectId = url.searchParams.get("subjectId") ?? undefined;
    const chapterId = url.searchParams.get("chapterId") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const q = url.searchParams.get("q") ?? undefined;
    const docs = await db.document.findMany({
      where: {
        userId: user.id,
        ...(subjectId ? { subjectId } : {}),
        ...(chapterId ? { chapterId } : {}),
        ...(status ? { status } : {}),
        // Recherche insensible à la casse sur le titre ET le nom original
        ...(q
          ? {
              OR: [
                { name: { contains: q } },
                { name: { contains: q.toLowerCase() } },
                { name: { contains: q.toUpperCase() } },
                { name: { contains: q.charAt(0).toUpperCase() + q.slice(1).toLowerCase() } },
                { originalName: { contains: q } },
                { originalName: { contains: q.toLowerCase() } },
                { originalName: { contains: q.toUpperCase() } },
              ],
            }
          : {}),
      },
      include: {
        subject: { select: { name: true, color: true } },
        chapter: { select: { name: true } },
        _count: { select: { chunks: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return { documents: docs };
  });
}

/** Import multi-fichiers (multipart) : extraction immédiate + découpage RAG.
 *  Chaque document possède un emplacement principal obligatoire et cohérent :
 *  le chapitre doit appartenir à la matière choisie (jamais déduit du nom de fichier). */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new ApiHttpError("Aucun fichier reçu.", 400);
    if (files.length > 12) throw new ApiHttpError("Maximum 12 fichiers par import.", 400);

    const subjectId = (form.get("subjectId") as string) || null;
    const chapterId = (form.get("chapterId") as string) || null;

    if (!subjectId) {
      throw new ApiHttpError(
        "Sélectionnez la matière dans laquelle ranger les documents avant l'import.",
        422,
      );
    }
    if (!chapterId) {
      throw new ApiHttpError(
        "Sélectionnez le chapitre dans lequel ranger les documents avant l'import.",
        422,
      );
    }

    // Cohérence stricte : matière possédée + chapitre appartenant à cette matière.
    const subject = await db.subject.findFirst({ where: { id: subjectId, userId: user.id } });
    if (!subject) throw new ApiHttpError("Matière introuvable.", 404);
    const chapter = await db.chapter.findFirst({ where: { id: chapterId } });
    if (!chapter || chapter.subjectId !== subject.id) {
      throw new ApiHttpError(
        "Le chapitre choisi n'appartient pas à la matière sélectionnée.",
        422,
        { chapterSubjectMismatch: true },
      );
    }

    // Taille maximale par fichier paramétrée par l'utilisateur (Réglages)
    const settings = await db.userSettings.findUnique({ where: { userId: user.id } });
    const maxMb = Math.min(50, Math.max(1, settings?.maxUploadMB ?? 20));

    const results: { name: string; ok: boolean; id?: string; error?: string; warnings?: string[] }[] = [];

    for (const file of files) {
      try {
        const ext = detectExtension(file.name);
        if (!ext) throw new Error(`Format non pris en charge (${file.name.split(".").pop()}). Formats acceptés : PDF, DOCX, TXT, MD, PPTX.`);
        if (file.size > maxMb * 1024 * 1024) throw new Error(`Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} Mo, max ${maxMb} Mo).`);
        if (file.size === 0) throw new Error("Fichier vide.");

        // Prévention des doublons : même nom + même taille
        const dupe = await db.document.findFirst({ where: { userId: user.id, originalName: file.name, size: file.size } });
        if (dupe) throw new Error(`Doublon probable : « ${file.name} » a déjà été importé.`);

        const buffer = Buffer.from(await file.arrayBuffer());
        const extracted = await extractContent(ext, buffer);
        if (!extracted.text || extracted.text.trim().length < 20) {
          throw new Error("Aucun texte extractible (document scanné ou vide ?).");
        }

        // Le titre d'affichage est dérivé du nom de fichier, mais reste indépendant
        // de la matière et du chapitre (jamais de création automatique de hiérarchie).
        const [doc] = await db.$transaction([
          db.document.create({
            data: {
              userId: user.id,
              subjectId,
              chapterId,
              name: file.name.replace(/\.[^.]+$/, ""),
              originalName: file.name,
              type: ext,
              size: file.size,
              status: "READY",
              extractedText: extracted.text.slice(0, 500_000),
              pageCount: extracted.pageCount ?? null,
              meta: JSON.stringify(extracted.meta),
            },
          }),
          db.subject.update({ where: { id: subject.id }, data: { updatedAt: new Date() } }),
        ]);

        // Découpage en morceaux pour la recherche documentaire
        const chunks = chunkText(extracted.text);
        if (chunks.length > 0) {
          await db.documentChunk.createMany({
            data: chunks.map((c, i) => ({
              documentId: doc.id,
              idx: i,
              section: c.section ?? null,
              content: c.content.slice(0, 4000),
              words: c.content.split(/\s+/).length,
            })),
          });
        }

        results.push({ name: file.name, ok: true, id: doc.id, warnings: extracted.meta.warnings });
      } catch (e) {
        results.push({ name: file.name, ok: false, error: e instanceof Error ? e.message : "Échec de l'import." });
      }
    }

    const failed = results.filter((r) => !r.ok).length;
    return { ok: failed === 0, results };
  });
}
