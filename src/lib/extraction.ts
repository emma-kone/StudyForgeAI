import mammoth from "mammoth";
import JSZip from "jszip";

export type ExtractResult = {
  text: string;
  pageCount?: number;
  meta: {
    sections?: string[];
    warnings: string[];
    hasTables?: boolean;
    hasCode?: boolean;
  };
};

/** Nettoie un texte extrait : lignes vides multiples, espaces parasites. */
function clean(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/** Détecte les extraits de code heuristiquement. */
function looksLikeCode(line: string): boolean {
  const l = line.trim();
  if (l.length < 4) return false;
  return /(\bdef\b|\bfunction\b|\bclass\b|\bimport\b|\breturn\b|<\w+>|; \{|=>|\bSELECT\b.*\bFROM\b|;\s*$|\{|\}|\bpublic\b|\bprivate\b|#include|\bprint\()/.test(l);
}

function analyzeMeta(text: string, warnings: string[]): ExtractResult["meta"] {
  const lines = text.split("\n");
  const sections: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    // Titres markdown ou lignes courtes "titre" numérotées
    if (/^#{1,6}\s+/.test(t)) sections.push(t.replace(/^#{1,6}\s+/, "").slice(0, 120));
    else if (/^(chapitre|partie|section|module|chap\.?)\s+\d+/i.test(t) && t.length < 120) sections.push(t);
  }
  const hasCode = lines.filter(looksLikeCode).length >= 3;
  const hasTables = /\|.*\|.*\|/.test(text) || /\t.+\t/.test(text);
  return { sections: sections.slice(0, 60), warnings, hasTables, hasCode };
}

// ── PDF (unpdf — pdfjs embarqué, sans dépendance native) ─────────────────────
async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const data = new Uint8Array(buffer);
  const pdf = await getDocumentProxy(data);
  const { text, totalPages } = await extractText(pdf, { mergePages: false });
  const pages: string[] = Array.isArray(text) ? text : [String(text)];
  const warnings: string[] = [];
  const joined = pages.map((p, i) => {
    const cleanPage = clean(p ?? "");
    if (cleanPage.replace(/\s/g, "").length < 10) {
      warnings.push(`Page ${i + 1} illisible ou vide (possiblement scannée).`);
    }
    return `\n\n--- Page ${i + 1} ---\n\n${cleanPage}`;
  });
  if (warnings.length >= Math.max(1, Math.floor(totalPages * 0.6))) {
    warnings.unshift(
      "La majorité des pages semblent scannées (sans texte). L'analyse IA peut être de moindre qualité — envisagez un document texte natif."
    );
  }
  return {
    text: clean(joined.join("")),
    pageCount: totalPages,
    meta: analyzeMeta(joined.join("\n"), warnings),
  };
}

// ── DOCX (mammoth — extraction HTML puis texte) ──────────────────────────────
async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  const { value: html, messages } = await mammoth.convertToHtml({ buffer });
  // Tableaux → texte lisible ligne/colonne ; titres h1-h6 marqués
  let text = html
    .replace(/<table[^>]*>/g, "\n[TABLEAU]\n")
    .replace(/<\/table>/g, "\n[/TABLEAU]\n")
    .replace(/<tr[^>]*>/g, "\n| ")
    .replace(/<\/t[dh]>/g, " |")
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/g, (_, lvl: string, inner: string) => `\n${"#".repeat(Number(lvl))} ${inner}\n`)
    .replace(/<li[^>]*>/g, "\n• ")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, "\n```\n$1\n```\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const warnings = messages
    .filter((m) => m.type === "warning")
    .slice(0, 8)
    .map((m) => m.message);
  text = clean(text);
  return { text, meta: analyzeMeta(text, warnings) };
}

// ── PPTX (jszip — lecture des XML de diapositives) ───────────────────────────
async function extractPptx(buffer: Buffer): Promise<ExtractResult> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)/)?.[1] ?? 0);
      const nb = Number(b.match(/(\d+)/)?.[1] ?? 0);
      return na - nb;
    });
  if (slideFiles.length === 0) {
    return { text: "", meta: { warnings: ["Aucune diapositive trouvée dans le fichier PPTX."] } };
  }
  const pages: string[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async("text");
    // Chaque <a:t>…</a:t> est un run de texte
    const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
      m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    );
    const slideText = runs.join("\n").trim();
    if (slideText.replace(/\s/g, "").length < 5) {
      warnings.push(`Diapositive ${i + 1} sans texte extractible (image uniquement ?).`);
    }
    pages.push(`\n\n--- Diapositive ${i + 1} ---\n\n${slideText}`);
  }
  const text = clean(pages.join(""));
  return { text, pageCount: slideFiles.length, meta: analyzeMeta(text, warnings) };
}

// ── TXT / Markdown ───────────────────────────────────────────────────────────
function extractTextDoc(buffer: Buffer, ext: string): ExtractResult {
  const text = clean(buffer.toString("utf8"));
  if (text.replace(/\s/g, "").length < 5) {
    return { text: "", meta: { warnings: [`Le fichier ${ext} semble vide ou illisible.`] } };
  }
  return { text, meta: analyzeMeta(text, []) };
}

/** Point d'entrée : extraction selon le type de fichier. */
export async function extractContent(type: string, buffer: Buffer): Promise<ExtractResult> {
  switch (type) {
    case "pdf":
      return extractPdf(buffer);
    case "docx":
      return extractDocx(buffer);
    case "pptx":
      return extractPptx(buffer);
    case "txt":
    case "md":
      return extractTextDoc(buffer, type.toUpperCase());
    default:
      throw new Error(`Format non pris en charge : ${type}`);
  }
}

export const SUPPORTED_EXTENSIONS = ["pdf", "docx", "txt", "md", "pptx"] as const;

export function detectExtension(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

/** Découpage en morceaux pour le RAG (fenêtres avec chevauchement). */
export function chunkText(text: string, maxChars = 1200, overlap = 150): { section?: string; content: string }[] {
  const chunks: { section?: string; content: string }[] = [];
  // Découpage par pages / diapositives / titres si présents
  const pageBlocks = text.split(/\n(?=--- (?:Page|Diapositive) \d+ ---)/g);
  let currentSection: string | undefined;
  let buffer = "";

  const flush = () => {
    const content = buffer.trim();
    if (content.replace(/\s/g, "").length >= 20) {
      chunks.push({ section: currentSection, content });
    }
    buffer = "";
  };

  for (const block of pageBlocks) {
    const headerMatch = block.match(/^--- (?:Page|Diapositive) (\d+) ---/);
    if (headerMatch) {
      flush();
      currentSection = headerMatch[0].replace(/--- | ---/g, "");
    }
    // Sous-découpage des très longs blocs
    if (block.length > maxChars * 2) {
      const sentences = block.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if (buffer.length + s.length > maxChars) {
          const tail = buffer.slice(-overlap);
          flush();
          buffer = tail + s;
        } else {
          buffer += s;
        }
      }
      flush();
    } else {
      buffer += (buffer ? "\n" : "") + block;
      if (buffer.length > maxChars) flush();
    }
  }
  flush();
  return chunks.slice(0, 400);
}
