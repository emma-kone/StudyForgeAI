import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { executeCode } from "@/lib/executor";
import { EXECUTABLE_LANGUAGES } from "@/lib/executor";

export async function GET() {
  return handle(async () => {
    await requireUser();
    return {
      languages: Object.entries(EXECUTABLE_LANGUAGES).map(([id, l]) => ({
        id,
        label: l.label,
        executable: l.available !== false,
      })),
      note: "Langages sans runtime local : le code est analysé et corrigé par l'IA, aucune simulation d'exécution n'est affichée.",
    };
  });
}

const execSchema = z.object({
  language: z.string().min(1).max(30),
  code: z.string().min(1, "Code vide").max(40_000),
  sessionId: z.string().optional(),
});

/** Exécution réelle dans un processus enfant isolé (limites temps/sortie). */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`exec:${user.id}`, 30, 60_000);
    const { language, code, sessionId } = execSchema.parse(await readJson<unknown>(req));
    const result = await executeCode(language, code);
    await db.programRun.create({
      data: {
        userId: user.id,
        sessionId: sessionId ?? null,
        language,
        code: code.slice(0, 20_000),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        ok: result.ok,
        limited: result.note ?? null,
      },
    });
    return result;
  });
}
