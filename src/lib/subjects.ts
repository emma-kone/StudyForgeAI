/** Normalisation raisonnable pour la détection de doublons :
 *  trim, espaces réduits, casse ignorée (les accents restent significatifs). */
export function normalizeSubjectName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

