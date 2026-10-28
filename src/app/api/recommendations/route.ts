import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const recommendations = await db.studyRecommendation.findMany({
      where: { userId: user.id },
      orderBy: [{ status: "asc" }, { priority: "desc" }],
      take: 20,
    });
    const conceptStats = await db.conceptStat.findMany({ where: { userId: user.id }, orderBy: { mastery: "asc" }, take: 30 });
    return { recommendations, conceptStats };
  });
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["ACCEPTED", "DISMISSED", "OPEN"]),
});

export async function PATCH(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { id, status } = patchSchema.parse(await readJson<unknown>(req));
    const rec = await db.studyRecommendation.findFirst({ where: { id, userId: user.id } });
    if (!rec) throw new Error("Recommandation introuvable.");
    return { recommendation: await db.studyRecommendation.update({ where: { id }, data: { status } }) };
  });
}
