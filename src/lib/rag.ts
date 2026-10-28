import { db } from "@/lib/db";
import type { RagPassage } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Recherche documentaire (RAG léger, déterministe : TF-IDF + proximité)
// Les passages conservent leur provenance : document + page/section.
// ─────────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set(
  `le la les un une des du de d au aux a à et ou en dans sur pour par avec sans sous est sont être avoir que qui quoi dont où ce cet cette ces son sa ses leur leurs nous vous il elle ils elles on ne pas plus moins très aussi comme mais donc car si tout toute tous toutes autre autres même meme bien peut peut-être faut doit alors ainsi exemple les quel quelle quels quelles the of and to in for with on at by from is are was were be been it its this that as an or not`.split(/\s+/)
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9àâçéèêëîïôûùüÿñæœ\s]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export interface SearchIndexEntry {
  chunkId: string;
  documentId: string;
  documentName: string;
  section?: string;
  content: string;
  tf: Map<string, number>;
}

export async function buildIndex(documentIds: string[], userId: string): Promise<SearchIndexEntry[]> {
  const chunks = await db.documentChunk.findMany({
    where: { documentId: { in: documentIds }, document: { userId } },
    include: { document: { select: { name: true } } },
    orderBy: [{ documentId: "asc" }, { idx: "asc" }],
  });
  return chunks.map((c) => {
    const tf = new Map<string, number>();
    for (const t of tokenize(c.content)) tf.set(t, (tf.get(t) ?? 0) + 1);
    return {
      chunkId: c.id,
      documentId: c.documentId,
      documentName: c.document.name,
      section: c.section ?? undefined,
      content: c.content,
      tf,
    };
  });
}

export function search(index: SearchIndexEntry[], query: string, topK = 8): RagPassage[] {
  if (index.length === 0) return [];
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const N = index.length;
  // Document frequency
  const df = new Map<string, number>();
  for (const entry of index) {
    for (const term of entry.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const avgLen = index.reduce((acc, e) => {
    let len = 0;
    for (const v of e.tf.values()) len += v;
    return acc + len;
  }, 0) / N;

  const results: RagPassage[] = index.map((entry) => {
    let score = 0;
    let totalTerms = 0;
    for (const v of entry.tf.values()) totalTerms += v;
    for (const qt of queryTokens) {
      const f = entry.tf.get(qt);
      if (!f) continue;
      const idf = Math.log(1 + N / (1 + (df.get(qt) ?? 0)));
      score += (f / totalTerms) * idf * (1.5 * (1 - 0.75 * (totalTerms / Math.max(avgLen, 1))) + 0.75);
    }
    // Bonus de proximité : tokens adjacents dans le texte
    const lower = entry.content.toLowerCase();
    const firstPos = queryTokens.map((t) => lower.indexOf(t)).filter((p) => p >= 0);
    if (firstPos.length >= 2) {
      const span = Math.max(...firstPos) - Math.min(...firstPos);
      if (span < 400) score *= 1.25;
    }
    return {
      documentId: entry.documentId,
      documentName: entry.documentName,
      section: entry.section,
      content: entry.content.slice(0, 1600),
      score: Number(score.toFixed(4)),
    };
  });

  return results
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Recherche globale dans toute la bibliothèque de l'utilisateur.
 *  Les documentIds éventuels sont toujours restreints au compte de l'utilisateur. */
export async function searchLibrary(userId: string, query: string, documentIds?: string[], topK = 12) {
  const where = documentIds?.length ? { id: { in: documentIds }, userId } : { userId };
  const docs = await db.document.findMany({ where, select: { id: true }, take: 500 });
  if (docs.length === 0) return [];
  const index = await buildIndex(docs.map((d) => d.id), userId);
  return search(index, query, topK);
}

/** Contexte condensé pour les prompts IA (avec provenance). */
export function passagesToContext(passages: RagPassage[], maxChars = 12000): string {
  let out = "";
  let used = 0;
  for (const p of passages) {
    const block = `[Source : ${p.documentName}${p.section ? ` — ${p.section}` : ""}]\n${p.content}\n\n`;
    if (used + block.length > maxChars) break;
    out += block;
    used += block.length;
  }
  return out.trim() || "(Aucun passage pertinent trouvé dans les documents.)";
}
