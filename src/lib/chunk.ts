import { CHUNK_MAX_CHARS, CHUNK_MIN_CHARS, CHUNK_OVERLAP } from "./appConfig";

/**
 * Splits extracted document text into retrievable passages (M3).
 *
 * The previous implementation only applied overlap when a single paragraph was
 * too long to fit. At an ordinary paragraph boundary — which is where most
 * chunks actually end — the next chunk started cold, so an idea that spanned
 * the boundary was split between two passages and neither retrieved well.
 * Every chunk now carries the tail of the one before it.
 *
 * Chunks also keep the nearest structural marker they were found under
 * (`Slide 4`, `Page 2`, a Markdown heading), which is what lets a generated
 * claim be traced back to a place in the source rather than to an anonymous
 * excerpt.
 */

export interface Chunk {
  id: string;
  text: string;
  index: number;
  /** Where in the document this passage came from, when that is knowable. */
  source?: string;
}

/**
 * Markers the parsers emit or that documents carry themselves. Deliberately
 * conservative: a false positive would mislabel a citation, which is worse
 * than having no label.
 */
const SOURCE_PATTERNS: RegExp[] = [
  /^\[(Slide\s+\d+)\]/i,
  /^\[(Page\s+\d+)\]/i,
  /^(?:#{1,4})\s+(.{1,80}?)\s*$/,
];

function detectSource(paragraph: string): string | undefined {
  const firstLine = paragraph.split("\n", 1)[0].trim();
  for (const pattern of SOURCE_PATTERNS) {
    const match = firstLine.match(pattern);
    if (match) return match[1].trim();
  }
  return undefined;
}

/**
 * The tail of `text` to carry into the next chunk, cut at a word boundary so
 * the overlap never starts mid-word.
 */
function overlapTail(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return text.length <= overlap ? text : "";
  const tail = text.slice(-overlap);
  const boundary = tail.search(/\s/);
  return boundary === -1 ? tail : tail.slice(boundary + 1);
}

export function chunkText(
  text: string,
  maxChars = CHUNK_MAX_CHARS,
  overlap = CHUNK_OVERLAP
): Chunk[] {
  // An overlap at or above the chunk size makes the sliding window stop
  // advancing. appConfig already guards the configured value; this guards a
  // caller that passes its own.
  const safeOverlap = overlap >= maxChars ? Math.floor(maxChars / 6) : Math.max(0, overlap);

  const cleaned = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  const paragraphs = cleaned.split(/\n{2,}/).filter((p) => p.trim().length > 0);

  const chunks: Chunk[] = [];
  let buffer = "";
  let bufferSource: string | undefined;
  let currentSource: string | undefined;

  const push = (content: string, source: string | undefined) => {
    const trimmed = content.trim();
    if (trimmed.length === 0) return;
    chunks.push({ id: `c${chunks.length}`, text: trimmed, index: chunks.length, source });
  };

  /**
   * Emits the buffer. `seed` carries its tail into the next chunk, which is
   * what gives ordinary paragraph boundaries their overlap; a slide or
   * heading boundary is a real division in the document and gets a hard cut
   * instead, so no chunk spans two sources and a citation is unambiguous.
   */
  const flush = (seed = true) => {
    if (buffer.trim().length === 0) {
      buffer = "";
      return;
    }
    const emitted = buffer.trim();
    push(emitted, bufferSource);
    buffer = seed ? overlapTail(emitted, safeOverlap) : "";
    bufferSource = currentSource;
  };

  for (const para of paragraphs) {
    const marker = detectSource(para);
    if (marker) {
      // A new section starts here, so whatever was accumulating belongs to
      // the previous one.
      if (buffer.trim().length > 0) flush(false);
      currentSource = marker;
      bufferSource = marker;
      buffer = "";
    }
    if (bufferSource === undefined) bufferSource = currentSource;

    if (para.length > maxChars) {
      // A single paragraph too big to fit is windowed, with the same overlap
      // between windows.
      flush();
      buffer = "";
      let start = 0;
      while (start < para.length) {
        const end = Math.min(start + maxChars, para.length);
        push(para.slice(start, end), currentSource);
        if (end === para.length) break;
        const nextStart = end - safeOverlap;
        // Guarantees progress even if safeOverlap were ever >= maxChars.
        start = nextStart > start ? nextStart : end;
      }
      bufferSource = currentSource;
      continue;
    }

    if (buffer && (buffer + "\n\n" + para).length > maxChars) {
      flush();
      buffer = buffer ? buffer + "\n\n" + para : para;
    } else {
      buffer = buffer ? buffer + "\n\n" + para : para;
    }
  }
  // The final buffer is emitted without seeding a successor.
  if (buffer.trim().length > 0) push(buffer, bufferSource);

  // Short fragments — page numbers, stray glyphs, an overlap tail with
  // nothing after it — are noise in a retrieval index.
  return chunks
    .filter((c) => c.text.length > CHUNK_MIN_CHARS)
    .map((c, index) => ({ ...c, id: `c${index}`, index }));
}
