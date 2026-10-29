import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Couche d'abstraction IA Hybride Multi-Fournisseurs
// - Google Gemini (avec retry automatique sur saturation)
// - Z-AI / Zhipu AI GLM (intégration directe avec clé dédiée)
// - OpenRouter (secours et modèles complémentaires)
// - Cascade automatique transparente en cas d'indisponibilité
// ─────────────────────────────────────────────────────────────────────────────

export type AiOp = "analysis" | "rag" | "generation" | "grading" | "explain" | "revision";
export type AiProvider = "gemini" | "zai" | "openrouter";

interface CompletionResult {
  ok: boolean;
  content: string;
  error?: string;
  model?: string;
  provider?: AiProvider;
}

const DEFAULT_TIMEOUT_MS = 120_000;

// ── Appel direct Google Gemini (avec retry automatique sur pic de charge) ───
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

  const maxRetries = 2;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Pause avec backoff (1.5s, 3s)
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        console.warn(`[Gemini] Nouvelle tentative (${attempt}/${maxRetries}) suite à saturation...`);
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
        lastError = msg;

        // Si surcharge temporaire (503 / 429 / high demand), on retente
        const isTemporary =
          res.status === 429 ||
          res.status === 503 ||
          /demand|overloaded|unavailable|resource exhausted/i.test(msg);

        if (isTemporary && attempt < maxRetries) {
          continue;
        }

        return { ok: false, content: "", model, error: msg };
      }

      const data = await res.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!content.trim()) {
        return { ok: false, content: "", model, error: "Réponse vide de Gemini." };
      }

      return { ok: true, content, model };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Erreur réseau inconnue";
      if (attempt < maxRetries) {
        continue;
      }
    }
  }

  return { ok: false, content: "", model, error: lastError || "Échec de l'appel Gemini" };
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
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Erreur de connexion OpenRouter";
    return { ok: false, content: "", model, error: errMsg };
  }
}

// ── Appel Z-AI / Zhipu AI GLM ──────────────────────────────────────────────
async function callZAI(
  systemPrompt: string,
  userPrompt: string,
  opts: { model?: string; timeoutMs?: number; temperature?: number } = {}
): Promise<{ ok: boolean; content: string; model: string; error?: string }> {
  const apiKey =
    process.env.ZAI_API_KEY || "866a41db3a394a8dbd6c367df5152010.h8lgQKAM4HmwsEli";
  const baseUrl = (process.env.ZAI_BASE_URL || "https://open.bigmodel.cn/api/paas/v4").replace(
    /\/+$/,
    ""
  );
  const model = opts.model || process.env.ZAI_MODEL || "glm-4-flash";
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt.trim()) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: userPrompt });

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey.trim()}`,
        "X-Z-AI-From": "Z",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.3,
        thinking: { type: "disabled" },
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      const errMsg = errBody?.error?.message || `Erreur Z-AI (${res.status} ${res.statusText})`;
      return { ok: false, content: "", model, error: errMsg };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      return { ok: false, content: "", model, error: "Réponse vide de Z-AI." };
    }

    return { ok: true, content, model: data.model || model };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Erreur de connexion Z-AI";
    return { ok: false, content: "", model, error: errMsg };
  }
}

async function invokeProvider(
  provider: AiProvider,
  systemPrompt: string,
  userPrompt: string,
  opts: { model?: string; timeoutMs?: number; temperature?: number; json?: boolean } = {}
): Promise<{ ok: boolean; content: string; model: string; error?: string }> {
  switch (provider) {
    case "gemini":
      return callGemini(systemPrompt, userPrompt, opts);
    case "zai":
      return callZAI(systemPrompt, userPrompt, opts);
    case "openrouter":
      return callOpenRouter(systemPrompt, userPrompt, opts);
  }
}

// ── Orchestrateur avec Cascade automatique Multi-Fournisseurs ────────────────
async function callModel(
  op: AiOp,
  systemPrompt: string,
  userPrompt: string,
  opts: { userId?: string; model?: string; timeoutMs?: number; temperature?: number; json?: boolean } = {}
): Promise<CompletionResult> {
  const started = Date.now();
  const promptChars = systemPrompt.length + userPrompt.length;

  const preferred = (process.env.AI_PROVIDER || "gemini").toLowerCase() as AiProvider;
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasZai = Boolean(process.env.ZAI_API_KEY || "866a41db3a394a8dbd6c367df5152010.h8lgQKAM4HmwsEli");
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY);

  // Construction de la chaîne de cascade selon les priorités et clés disponibles
  const allProviders: AiProvider[] = ["gemini", "zai", "openrouter"];
  const isAvailable = (p: AiProvider) => {
    if (p === "gemini") return hasGemini;
    if (p === "zai") return hasZai;
    if (p === "openrouter") return hasOpenRouter;
    return false;
  };

  const candidateChain: AiProvider[] = [
    preferred,
    ...allProviders.filter((p) => p !== preferred),
  ].filter(isAvailable);

  if (candidateChain.length === 0) {
    const err = "Aucune clé d'API configurée (définissez GEMINI_API_KEY, ZAI_API_KEY ou OPENROUTER_API_KEY).";
    await log(op, opts.userId, "none", promptChars, 0, false, err, Date.now() - started);
    return { ok: false, content: "", error: err };
  }

  const failedAttempts: string[] = [];

  for (let i = 0; i < candidateChain.length; i++) {
    const provider = candidateChain[i];
    if (i > 0) {
      console.warn(`[AI] Bascule automatique vers le secours (${provider})...`);
    }

    const res = await invokeProvider(provider, systemPrompt, userPrompt, opts);

    if (res.ok) {
      await log(
        op,
        opts.userId,
        `${provider}:${res.model}`,
        promptChars,
        res.content.length,
        true,
        undefined,
        Date.now() - started
      );
      return { ok: true, content: res.content, model: res.model, provider };
    }

    console.warn(`[AI] Le fournisseur (${provider}) a échoué: ${res.error}`);
    failedAttempts.push(`${provider} (${res.error})`);
  }

  const combinedError = `Échec de tous les fournisseurs : ${failedAttempts.join(" | ")}`;
  await log(op, opts.userId, "cascade-failed", promptChars, 0, false, combinedError, Date.now() - started);
  return { ok: false, content: "", error: combinedError };
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
