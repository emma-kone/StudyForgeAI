import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { runSqlScript, SQL_FIXTURES } from "@/lib/sql-engine";

export async function GET() {
  return handle(async () => {
    await requireUser();
    return {
      fixtures: Object.entries(SQL_FIXTURES).map(([id, f]) => ({ id, label: f.label, description: f.description })),
    };
  });
}

const runSchema = z.object({
  sql: z.string().min(1, "Requête vide").max(30_000),
  fixture: z.string().default("bibliotheque"),
  setupSql: z.string().max(30_000).optional(), // environnement de test propre à un exercice généré
  sessionId: z.string().optional(),
});

/** Exécute le SQL dans une base SQLite en mémoire isolée (jamais la base principale). */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`sql:${user.id}`, 40, 60_000);
    const { sql, fixture, setupSql, sessionId } = runSchema.parse(await readJson<unknown>(req));
    const setupSqlResolved = setupSql?.trim() ? setupSql : (SQL_FIXTURES[fixture]?.setupSql ?? SQL_FIXTURES.bibliotheque.setupSql);
    const result = runSqlScript(sql, setupSqlResolved);
    await db.sqlQueryLog.create({
      data: {
        userId: user.id,
        sessionId: sessionId ?? null,
        sql: sql.slice(0, 10_000),
        ok: result.ok,
        rowCount: result.statements.reduce((acc, s) => acc + (s.rows?.length ?? 0), 0),
        error: result.error ?? result.statements.find((s) => s.error)?.error ?? null,
        durationMs: result.durationMs,
      },
    });
    return result;
  });
}
