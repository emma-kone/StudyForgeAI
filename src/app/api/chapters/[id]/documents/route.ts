import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, readJson, ApiHttpError } from "@/lib/api-helpers";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;

    // Vérifie que le chapitre appartient à l'utilisateur
    const chapter = await db.chapter.findFirst({
      where: { id, subject: { userId: user.id } },
      include: {
        subject: { select: { id: true, name: true, color: true } },
        documents: {
          where: { userId: user.id },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            originalName: true,
            type: true,
            size: true,
            status: true,
            pageCount: true,
            createdAt: true,
            _count: { select: { chunks: true } },
          },
        },
        _count: { select: { documents: true } },
      },
    });

    if (!chapter) throw new ApiHttpError("Chapitre introuvable.", 404);

    return NextResponse.json({ chapter });
  });
}

