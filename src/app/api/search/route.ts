import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { searchLibrary } from "@/lib/rag";

/** Recherche documentaire (RAG déterministe TF-IDF) avec provenance. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();
    const documentIds = url.searchParams.get("documentIds")?.split(",").filter(Boolean);
    if (!q || q.length < 2) return { passages: [] };
    const passages = await searchLibrary(user.id, q, documentIds, 12);
    return { passages };
  });
}
