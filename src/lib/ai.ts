import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Couche d'abstraction IA (OpenRouter / API compatible OpenAI)
// - Journalisation des appels (AIUsageLog)
// - Délais d'attente, gestion des erreurs, réponses JSON structurées
// - Opérations séparées : analyse, génération, évaluation, explication…
// ─────────────────────────────────────────────────────────────────────────────

export type AiOp = "analysis" | "rag" | "generation" | "grading" | "explain" | "revision";

interface CompletionResult {
  ok: boolean;
  content: string;
  error?: string;
  model?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

async function callModel(
  op: AiOp,
  systemPrompt: string,
  userPrompt: string,
  opts: { userId?: string; model?: string; timeoutMs?: number; temperature?: number } = {}
): Promise<CompletionResult> {
  const started = Date.now();
  const promptChars = systemPrompt.length + userPrompt.length;
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const errorMsg = "Clé d'API OpenRouter manquante (OPENROUTER_API_KEY). Veuillez la renseigner dans le fichier .env et dans Vercel.";
    await log(op, opts.userId, opts.model, promptChars, 0, false, errorMsg, Date.now() - started);
    return { ok: false, content: "", error: errorMsg };
  }

  const model = opts.model || process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey.trim()}`,
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        "X-Title": "StudyForge",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: opts.temperature ?? 0.3,
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      const errMsg = errBody?.error?.message || `Erreur API OpenRouter (${res.status} ${res.statusText})`;
      throw new Error(errMsg);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      throw new Error("Réponse vide du modèle retournée par OpenRouter.");
    }

    const usedModel = data.model || model;
    await log(op, opts.userId, usedModel, promptChars, content.length, true, undefined, Date.now() - started);
    return { ok: true, content, model: usedModel };
  } catch (err: any) {
    const message =
      err?.name === "TimeoutError"
        ? `Délai d'attente dépassé (${Math.round(timeout / 1000)} s)`
        : err instanceof Error
        ? err.message
        : "Erreur IA inconnue";
    await log(op, opts.userId, model, promptChars, 0, false, message, Date.now() - started).catch(() => {});
    return { ok: false, content: "", error: message };
  }
}

async function log(
  op: AiOp,
  userId: string | undefined,
  model: string | undefined,
  promptChars: number,
  respChars: number,
  ok: boolean,
  error?: string,
  durationMs?: number
) {
  try {
    await db.aIUsageLog.create({
      data: {
        userId: userId ?? null,
        op,
        model: model ?? null,
        promptChars,
        respChars,
        ok,
        error: error ?? null,
        durationMs: durationMs ?? null,
      },
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
  async complete(
    op: AiOp,
    systemPrompt: string,
    userPrompt: string,
    opts?: { userId?: string; model?: string; timeoutMs?: number }
  ) {
    return callModel(op, systemPrompt, userPrompt, opts);
  },

  /** Appel avec attente d'un JSON valide (1 re-tentative de réparation). */
  async completeJson<T>(
    op: AiOp,
    systemPrompt: string,
    userPrompt: string,
    opts?: { userId?: string; model?: string; timeoutMs?: number }
  ): Promise<{ ok: boolean; data: T | null; error?: string; raw?: string; model?: string }> {
    const first = await callModel(op, systemPrompt, userPrompt, opts);
    if (!first.ok) return { ok: false, data: null, error: first.error, model: first.model };
    const parsed = parseJsonLoose<T>(first.content);
    if (parsed) return { ok: true, data: parsed, raw: first.content, model: first.model };
    // Réparation : on redemande uniquement le JSON
    const repair = await callModel(
      op,
      "Tu corriges des sorties JSON. Réponds UNIQUEMENT avec le JSON valide, sans aucun texte autour, sans bloc de code.",
      `La réponse suivante devait être un JSON valide mais ne l'est pas. Répare-la et réponds UNIQUEMENT avec le JSON.\n\n${first.content.slice(0, 8000)}`,
      { ...opts, timeoutMs: 60_000 }
    );
    if (repair.ok) {
      const reparsed = parseJsonLoose<T>(repair.content);
      if (reparsed) return { ok: true, data: reparsed, raw: first.content, model: repair.model };
    }
    return {
      ok: false,
      data: null,
      error: "Impossible d'obtenir une réponse JSON valide du modèle.",
      raw: first.content,
      model: first.model,
    };
  },
};
