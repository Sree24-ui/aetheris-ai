export interface Chunk {
  id: string;
  text: string;
  index: number;
}

export function chunkText(text: string, maxChars = 900, overlap = 150): Chunk[] {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  const paragraphs = cleaned.split(/\n{2,}/).filter((p) => p.trim().length > 0);

  const chunks: Chunk[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer.trim().length === 0) return;
    chunks.push({ id: `c${chunks.length}`, text: buffer.trim(), index: chunks.length });
    buffer = "";
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      if (buffer) flush();
      let start = 0;
      while (start < para.length) {
        const end = Math.min(start + maxChars, para.length);
        chunks.push({ id: `c${chunks.length}`, text: para.slice(start, end).trim(), index: chunks.length });
        start = end - overlap;
        if (start < 0 || end === para.length) break;
      }
      continue;
    }
    if ((buffer + "\n\n" + para).length > maxChars) {
      flush();
      buffer = para;
    } else {
      buffer = buffer ? buffer + "\n\n" + para : para;
    }
  }
  flush();

  return chunks.filter((c) => c.text.length > 20);
}
