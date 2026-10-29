import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Couche d'abstraction IA Hybride (Google Gemini + OpenRouter avec Fallback auto)
// - Fournisseur principal par défaut : Google Gemini (gemini-3.8-flash, gratuit & performant)
// - Fournisseur de secours : OpenRouter
// - Bascule automatique transparente en cas de saturation / indisponibilité de l'un
// ─────────────────────────────────────────────────────────────────────────────

export type AiOp = "analysis" | "rag" | "generation" | "grading" | "explain" | "revision";

interface CompletionResult {
  ok: boolean;
  content: string;
  error?: string;
  model?: string;
  provider?: "gemini" | "openrouter";
}

const DEFAULT_TIMEOUT_MS = 120_000;

// ── Appel direct Google Gemini ───────────────────────────────────────────────
async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  opts: { model?: string; timeoutMs?: number; temperature?: number; json?: boolean } = {}
): Promise<{ ok: boolean; content: string; model: string; error?: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, content: "", model: "gemini", error: "GEMINI_API_KEY manquante." };
  }

  const model = opts.model || process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;

  const bodyPayload: Record<string, unknown> = {
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };

  if (systemPrompt.trim()) {
    bodyPayload.systemInstruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyPayload),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    const msg = errData?.error?.message || `Erreur Gemini (${res.status} ${res.statusText})`;
    return { ok: false, content: "", model, error: msg };
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!content.trim()) {
    return { ok: false, content: "", model, error: "Réponse vide de Gemini." };
  }

  return { ok: true, content, model };
}

// ── Appel OpenRouter ─────────────────────────────────────────────────────────
async function callOpenRouter(
  systemPrompt: string,
  userPrompt: string,
  opts: { model?: string; timeoutMs?: number; temperature?: number } = {}
): Promise<{ ok: boolean; content: string; model: string; error?: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, content: "", model: "openrouter", error: "OPENROUTER_API_KEY manquante." };
  }

  const model = opts.model || process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt.trim()) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: userPrompt });

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
      messages,
      temperature: opts.temperature ?? 0.3,
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    const errMsg = errBody?.error?.message || `Erreur OpenRouter (${res.status} ${res.statusText})`;
    return { ok: false, content: "", model, error: errMsg };
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) {
    return { ok: false, content: "", model, error: "Réponse vide d'OpenRouter." };
  }

  return { ok: true, content, model: data.model || model };
}

// ── Orchestrateur avec Fallback automatique ──────────────────────────────────
async function callModel(
  op: AiOp,
  systemPrompt: string,
  userPrompt: string,
  opts: { userId?: string; model?: string; timeoutMs?: number; temperature?: number; json?: boolean } = {}
): Promise<CompletionResult> {
  const started = Date.now();
  const promptChars = systemPrompt.length + userPrompt.length;

  const preferredProvider = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY);

  let primary: "gemini" | "openrouter" = "gemini";
  let fallback: "gemini" | "openrouter" | null = null;

  if (preferredProvider === "openrouter" && hasOpenRouter) {
    primary = "openrouter";
    fallback = hasGemini ? "gemini" : null;
  } else if (hasGemini) {
    primary = "gemini";
    fallback = hasOpenRouter ? "openrouter" : null;
  } else if (hasOpenRouter) {
    primary = "openrouter";
    fallback = null;
  } else {
    const err = "Aucune clé d'API configurée (définissez GEMINI_API_KEY ou OPENROUTER_API_KEY).";
    await log(op, opts.userId, "none", promptChars, 0, false, err, Date.now() - started);
    return { ok: false, content: "", error: err };
  }

  // 1. Essai avec le fournisseur principal
  const primaryResult =
    primary === "gemini"
      ? await callGemini(systemPrompt, userPrompt, opts)
      : await callOpenRouter(systemPrompt, userPrompt, opts);

  if (primaryResult.ok) {
    await log(op, opts.userId, `${primary}:${primaryResult.model}`, promptChars, primaryResult.content.length, true, undefined, Date.now() - started);
    return { ok: true, content: primaryResult.content, model: primaryResult.model, provider: primary };
  }

  console.warn(`[AI] Le fournisseur principal (${primary}) a échoué: ${primaryResult.error}`);

  // 2. Si échec et qu'un fournisseur de secours est disponible, fallback automatique
  if (fallback) {
    console.warn(`[AI] Bascule automatique vers le secours (${fallback})...`);
    const fallbackResult =
      fallback === "gemini"
        ? await callGemini(systemPrompt, userPrompt, opts)
        : await callOpenRouter(systemPrompt, userPrompt, opts);

    if (fallbackResult.ok) {
      await log(
        op,
        opts.userId,
        `${fallback}:${fallbackResult.model}`,
        promptChars,
        fallbackResult.content.length,
        true,
        undefined,
        Date.now() - started
      );
      return { ok: true, content: fallbackResult.content, model: fallbackResult.model, provider: fallback };
    }

    const combinedError = `Échec de ${primary} (${primaryResult.error}) et du secours ${fallback} (${fallbackResult.error})`;
    await log(op, opts.userId, "fallback-failed", promptChars, 0, false, combinedError, Date.now() - started);
    return { ok: false, content: "", error: combinedError };
  }

  await log(op, opts.userId, `${primary}:${primaryResult.model}`, promptChars, 0, false, primaryResult.error, Date.now() - started);
  return { ok: false, content: "", error: primaryResult.error };
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
    opts?: { userId?: string; model?: string; timeoutMs?: number; temperature?: number }
  ) {
    return callModel(op, systemPrompt, userPrompt, opts);
  },

  /** Appel avec attente d'un JSON valide (1 re-tentative de réparation). */
  async completeJson<T>(
    op: AiOp,
    systemPrompt: string,
    userPrompt: string,
    opts?: { userId?: string; model?: string; timeoutMs?: number; temperature?: number }
  ): Promise<{ ok: boolean; data: T | null; error?: string; raw?: string; model?: string; provider?: string }> {
    const first = await callModel(op, systemPrompt, userPrompt, { ...opts, json: true });
    if (!first.ok) return { ok: false, data: null, error: first.error, model: first.model, provider: first.provider };
    const parsed = parseJsonLoose<T>(first.content);
    if (parsed) return { ok: true, data: parsed, raw: first.content, model: first.model, provider: first.provider };

    // Réparation : on redemande uniquement le JSON
    const repair = await callModel(
      op,
      "Tu corriges des sorties JSON. Réponds UNIQUEMENT avec le JSON valide, sans aucun texte autour, sans bloc de code.",
      `La réponse suivante devait être un JSON valide mais ne l'est pas. Répare-la et réponds UNIQUEMENT avec le JSON.\n\n${first.content.slice(0, 8000)}`,
      { ...opts, timeoutMs: 60_000, json: true }
    );
    if (repair.ok) {
      const reparsed = parseJsonLoose<T>(repair.content);
      if (reparsed) return { ok: true, data: reparsed, raw: first.content, model: repair.model, provider: repair.provider };
    }
    return {
      ok: false,
      data: null,
      error: "Impossible d'obtenir une réponse JSON valide du modèle.",
      raw: first.content,
      model: first.model,
      provider: first.provider,
    };
  },
};
