import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const settings = await db.userSettings.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    return { settings, user: { id: user.id, email: user.email, name: user.name } };
  });
}

const patchSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  defaultMode: z.enum(["apprentissage", "entrainement", "examen", "revision", "personnalise"]).optional(),
  maxUploadMB: z.number().int().min(1).max(50).optional(),
  hintsEnabled: z.boolean().optional(),
});

export async function PUT(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const data = patchSchema.parse(await readJson<unknown>(req));
    const settings = await db.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    return { settings };
  });
}
