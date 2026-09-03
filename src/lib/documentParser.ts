import mammoth from "mammoth";
import { SUPPORTED_DOCUMENT_EXTENSIONS, type SupportedDocumentExtension } from "./appConfig";
import JSZip from "jszip";
import { parseStringPromise } from "xml2js";

async function parsePdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function parsePptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
      return na - nb;
    });

  const slideTexts: string[] = [];
  for (const name of slideFiles) {
    const xml = await zip.files[name].async("string");
    const parsed = await parseStringPromise(xml);
    const texts: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (Array.isArray(obj["a:t"])) {
        for (const t of obj["a:t"] as unknown[]) {
          if (typeof t === "string") texts.push(t);
          else if (t && typeof t === "object" && "_" in (t as Record<string, unknown>)) {
            texts.push(String((t as Record<string, unknown>)["_"]));
          }
        }
      }
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (Array.isArray(val)) val.forEach(walk);
        else if (typeof val === "object") walk(val);
      }
    };
    walk(parsed);
    slideTexts.push(`[Slide ${slideFiles.indexOf(name) + 1}]\n${texts.join(" ")}`);
  }
  return slideTexts.join("\n\n");
}

export async function parseDocument(filename: string, buffer: Buffer): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  // Gate on the shared list first so the picker's accepted formats and the
  // formats this function implements can never disagree.
  if (!(SUPPORTED_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`Unsupported file type: .${ext}`);
  }
  switch (ext as SupportedDocumentExtension) {
    case "pdf":
      return parsePdf(buffer);
    case "docx":
      return parseDocx(buffer);
    case "pptx":
      return parsePptx(buffer);
    case "txt":
    case "md":
      return buffer.toString("utf-8");
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}
