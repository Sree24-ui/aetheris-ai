import { SUPPORTED_DOCUMENT_EXTENSIONS } from "../appConfig";

/**
 * Upload admission control (H5).
 *
 * The upload route accepted a file of any size, trusted the extension in its
 * name, and handed office documents straight to a zip reader. That is three
 * separate unbounded-work problems: a large body, a file whose real format is
 * not what it claims, and a small archive that expands to gigabytes (a "zip
 * bomb"). Each is checked here, before any parsing or embedding happens.
 */

/**
 * Largest upload accepted, before extraction.
 *
 * Held below Next's 10 MB proxy body buffer (proxyClientMaxBodySize): the
 * proxy buffers each request body so it can be read twice, and a body over
 * that limit is *truncated* rather than rejected — which would reach the
 * parser as a corrupt file instead of a clear "too large". The headroom
 * covers multipart framing.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Largest total uncompressed payload an office archive may declare. */
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;
/** Most entries an office archive may contain. */
export const MAX_ARCHIVE_ENTRIES = 2000;
/** Highest total compression ratio accepted. Real .docx sits well under 20. */
export const MAX_COMPRESSION_RATIO = 120;
/** Longest extracted text kept. Beyond this the tail is discarded. */
export const MAX_EXTRACTED_CHARS = 2_000_000;
/** Longest accepted original filename. */
export const MAX_FILENAME_LENGTH = 200;

export class UploadRejected extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UploadRejected";
    this.status = status;
  }
}

/**
 * A filename safe to store and echo back.
 *
 * It is only ever displayed and stored, never used to open a path, but it is
 * attacker-controlled text: path separators, control characters and overlong
 * names are removed so it cannot be mistaken for a path or break a log line.
 */
export function sanitizeFilename(raw: unknown): string {
  if (typeof raw !== "string") throw new UploadRejected("The file needs a name.");
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (cleaned.length === 0) throw new UploadRejected("The file needs a name.");
  return cleaned.slice(0, MAX_FILENAME_LENGTH);
}

/** The lowercased extension, validated against the formats the parser has. */
export function requireSupportedExtension(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (!(SUPPORTED_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new UploadRejected(
      `Unsupported file type: .${ext}. Supported: ${SUPPORTED_DOCUMENT_EXTENSIONS.join(", ")}.`
    );
  }
  return ext;
}

/**
 * Confirms the bytes match the claimed extension.
 *
 * An extension is a claim by the uploader. Handing a PDF parser a zip, or a
 * zip reader a PDF, is at best a confusing error and at worst an unexpected
 * code path in a native parser, so the magic number is checked first.
 */
export function assertContentMatchesExtension(ext: string, buffer: Buffer): void {
  const startsWith = (bytes: number[]) =>
    bytes.every((byte, index) => buffer[index] === byte);

  if (ext === "pdf") {
    // "%PDF-"
    if (!startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) {
      throw new UploadRejected("That file is named .pdf but is not a PDF.");
    }
    return;
  }
  if (ext === "docx" || ext === "pptx") {
    // Every OOXML file is a zip: "PK\x03\x04".
    if (!startsWith([0x50, 0x4b, 0x03, 0x04])) {
      throw new UploadRejected(`That file is named .${ext} but is not an Office document.`);
    }
    return;
  }
  // txt/md: reject anything that is obviously binary. A NUL in the first
  // kilobyte is the standard heuristic and costs nothing.
  const probe = buffer.subarray(0, 1024);
  if (probe.includes(0)) {
    throw new UploadRejected("That file is named as text but contains binary data.");
  }
}

export interface ArchiveStats {
  entries: number;
  compressedBytes: number;
  uncompressedBytes: number;
  ratio: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
/** The EOCD record sits in the last 22 bytes plus up to 64KB of comment. */
const MAX_EOCD_SEARCH = 22 + 0xffff;

/**
 * Reads a zip's central directory to learn what it *claims* it will expand
 * to, without decompressing anything.
 *
 * This is the only way to catch a zip bomb: by the time an entry has been
 * decompressed to find out how big it is, the memory has already been spent.
 */
export function readArchiveStats(buffer: Buffer): ArchiveStats {
  const searchFrom = Math.max(0, buffer.length - MAX_EOCD_SEARCH);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= searchFrom; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new UploadRejected("That file is not a readable Office document.");

  const entries = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entries > MAX_ARCHIVE_ENTRIES) {
    throw new UploadRejected(
      `That document contains too many parts (${entries}; limit ${MAX_ARCHIVE_ENTRIES}).`,
      413
    );
  }
  if (directoryOffset >= buffer.length) {
    throw new UploadRejected("That file is not a readable Office document.");
  }

  let cursor = directoryOffset;
  let compressedBytes = 0;
  let uncompressedBytes = 0;

  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_HEADER_SIGNATURE) {
      throw new UploadRejected("That file is not a readable Office document.");
    }
    const compressed = buffer.readUInt32LE(cursor + 20);
    const uncompressed = buffer.readUInt32LE(cursor + 24);
    // 0xFFFFFFFF means the real size lives in a Zip64 extra field. A genuine
    // teaching document is never 4 GB, so refuse rather than parse further.
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) {
      throw new UploadRejected("That document is too large to process.", 413);
    }
    compressedBytes += compressed;
    uncompressedBytes += uncompressed;
    if (uncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new UploadRejected("That document expands to too much content to process.", 413);
    }
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  // A ratio is only meaningful once there is something to divide by; a tiny
  // archive of a few hundred bytes has a noisy ratio and no capacity to harm.
  const ratio = compressedBytes > 1024 ? uncompressedBytes / compressedBytes : 0;
  if (ratio > MAX_COMPRESSION_RATIO) {
    throw new UploadRejected("That document's compression ratio is implausible.", 413);
  }

  return { entries, compressedBytes, uncompressedBytes, ratio };
}

/** Runs every admission check for one upload. Throws UploadRejected. */
export function admitUpload(filename: unknown, buffer: Buffer): { name: string; ext: string } {
  if (buffer.length === 0) throw new UploadRejected("That file is empty.");
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new UploadRejected(
      `That file is larger than the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`,
      413
    );
  }
  const name = sanitizeFilename(filename);
  const ext = requireSupportedExtension(name);
  assertContentMatchesExtension(ext, buffer);
  if (ext === "docx" || ext === "pptx") readArchiveStats(buffer);
  return { name, ext };
}
