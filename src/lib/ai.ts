import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Couche d'abstraction IA (z-ai-web-dev-sdk, backend uniquement)
// - Journalisation des appels (AIUsageLog)
// - Délais d'attente, gestion des erreurs, réponses JSON structurées
// - Opérations séparées : analyse, génération, évaluation, explication…
// ─────────────────────────────────────────────────────────────────────────────

export type AiOp = "analysis" | "rag" | "generation" | "grading" | "explain" | "revision";

interface CompletionResult {
  ok: boolean;
  content: string;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

async function callModel(
  op: AiOp,
  systemPrompt: string,
  userPrompt: string,
  opts: { userId?: string; model?: string; timeoutMs?: number; temperature?: number } = {}
): Promise<CompletionResult> {
  const started = Date.now();
  let promptChars = systemPrompt.length + userPrompt.length;
  try {
    const zai = await ZAI.create();
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const completion = await Promise.race([
      zai.chat.completions.create({
        messages: [
          { role: "assistant", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        thinking: { type: "disabled" },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Délai d'attente dépassé (${Math.round(timeout / 1000)} s)`)), timeout)),
    ]);
    const content = (completion as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
    if (!content.trim()) throw new Error("Réponse vide du modèle");
    await log(op, opts.userId, opts.model, promptChars, content.length, true, undefined, Date.now() - started);
    return { ok: true, content };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur IA inconnue";
    await log(op, opts.userId, opts.model, promptChars, 0, false, message, Date.now() - started).catch(() => {});
    return { ok: false, content: "", error: message };
  }
}

async function log(op: AiOp, userId: string | undefined, model: string | undefined, promptChars: number, respChars: number, ok: boolean, error?: string, durationMs?: number) {
  try {
    await db.aIUsageLog.create({
      data: { userId: userId ?? null, op, model: model ?? null, promptChars, respChars, ok, error: error ?? null, durationMs: durationMs ?? null },
    });
  } catch {
    /* journalisation best-effort */
  }
}

/** Extrait un objet JSON d'une réponse LLM (tolère les blocs ```json). */
export function parseJsonLoose<T>(raw: string): T | null {
  const cleaned = raw
    .replace(/```json\s*/gi, "```")
    .split("```")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidates = [raw, ...cleaned];
  for (const c of candidates) {
    const start = Math.min(...[c.indexOf("{"), c.indexOf("[")].filter((i) => i >= 0).concat([Number.MAX_SAFE_INTEGER]));
    if (start === Number.MAX_SAFE_INTEGER) continue;
    const end = Math.max(c.lastIndexOf("}"), c.lastIndexOf("]"));
    if (end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1)) as T;
    } catch {
      continue;
    }
  }
  return null;
}

export const ai = {
  async complete(op: AiOp, systemPrompt: string, userPrompt: string, opts?: { userId?: string; model?: string; timeoutMs?: number }) {
    return callModel(op, systemPrompt, userPrompt, opts);
  },

  /** Appel avec attente d'un JSON valide (1 re-tentative de réparation). */
  async completeJson<T>(
    op: AiOp,
    systemPrompt: string,
    userPrompt: string,
    opts?: { userId?: string; model?: string; timeoutMs?: number }
  ): Promise<{ ok: boolean; data: T | null; error?: string; raw?: string }> {
    const first = await callModel(op, systemPrompt, userPrompt, opts);
    if (!first.ok) return { ok: false, data: null, error: first.error };
    const parsed = parseJsonLoose<T>(first.content);
    if (parsed) return { ok: true, data: parsed, raw: first.content };
    // Réparation : on redemande uniquement le JSON
    const repair = await callModel(
      op,
      "Tu corriges des sorties JSON. Réponds UNIQUEMENT avec le JSON valide, sans aucun texte autour, sans bloc de code.",
      `La réponse suivante devait être un JSON valide mais ne l'est pas. Répare-la et réponds UNIQUEMENT avec le JSON.\n\n${first.content.slice(0, 8000)}`,
      { ...opts, timeoutMs: 60_000 }
    );
    if (repair.ok) {
      const reparsed = parseJsonLoose<T>(repair.content);
      if (reparsed) return { ok: true, data: reparsed, raw: first.content };
    }
    return { ok: false, data: null, error: "Impossible d'obtenir une réponse JSON valide du modèle.", raw: first.content };
  },
};
