import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError, rateLimit } from "@/lib/auth";

/** Erreur métier avec code HTTP explicite (404, 409…). */
export class ApiHttpError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(message: string, status = 400, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Enveloppe standard : auth → validation → logique, erreurs centralisées. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn();
    // Certaines routes renvoient déjà une NextResponse (ex. 401 de login) :
    // la restituer telle quelle au lieu de la sérialiser en {}.
    if (data instanceof NextResponse) {
      return data;
    }
    if (data instanceof Response) {
      return data as unknown as NextResponse;
    }
    return NextResponse.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof AuthError) return jsonError("Authentification requise.", 401);
    if (err instanceof ApiHttpError) return jsonError(err.message, err.status, err.extra);
    if (err instanceof ZodError) {
      return jsonError("Données invalides : " + err.issues.map((i) => `${i.path.join(".")} — ${i.message}`).join("; "), 422);
    }
    const message = err instanceof Error ? err.message : "Erreur interne";
    console.error("[API]", message);
    return jsonError(message, 500);
  }
}

export function limit(key: string, max: number, windowMs: number) {
  if (!rateLimit(key, max, windowMs)) {
    throw new ApiHttpError("Trop de requêtes — patientez un instant avant de réessayer.", 429);
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiHttpError("Corps de requête JSON invalide.", 400);
  }
}
