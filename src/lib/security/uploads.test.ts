import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_UPLOAD_BYTES,
  UploadRejected,
  admitUpload,
  assertContentMatchesExtension,
  readArchiveStats,
  requireSupportedExtension,
  sanitizeFilename,
} from "./uploads";

/**
 * Regression tests for H5's upload half. The route previously accepted a file
 * of any size, believed the extension in its name, and handed office archives
 * straight to a zip reader — so a 40 KB "document" could expand to gigabytes
 * inside a 60-second serverless function.
 */

// --- Filenames ------------------------------------------------------------

test("filenames are stripped of paths and control characters", () => {
  assert.equal(sanitizeFilename("notes.pdf"), "notes.pdf");
  assert.equal(sanitizeFilename("../../etc/passwd.txt"), "passwd.txt");
  assert.equal(sanitizeFilename("C:\\Users\\me\\notes.pdf"), "notes.pdf");
  assert.equal(sanitizeFilename("no\u0000tes.pdf"), "notes.pdf");
  assert.equal(sanitizeFilename("a".repeat(500) + ".pdf").length, 200);
});

test("a nameless or non-string filename is refused", () => {
  assert.throws(() => sanitizeFilename(null), UploadRejected);
  assert.throws(() => sanitizeFilename(""), UploadRejected);
  assert.throws(() => sanitizeFilename("   "), UploadRejected);
});

test("only implemented formats are accepted", () => {
  assert.equal(requireSupportedExtension("notes.PDF"), "pdf");
  for (const name of ["payload.exe", "script.js", "archive.zip", "image.svg", "noextension"]) {
    assert.throws(() => requireSupportedExtension(name), UploadRejected, name);
  }
});

// --- Magic numbers --------------------------------------------------------

const PDF = Buffer.from("%PDF-1.7\nrest");
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

test("content that contradicts the extension is refused", () => {
  assert.throws(() => assertContentMatchesExtension("pdf", ZIP_HEADER), UploadRejected);
  assert.throws(() => assertContentMatchesExtension("docx", PDF), UploadRejected);
  assert.throws(
    () => assertContentMatchesExtension("txt", Buffer.from([0x00, 0x01, 0x02])),
    UploadRejected
  );
});

test("content that matches the extension passes", () => {
  assert.doesNotThrow(() => assertContentMatchesExtension("pdf", PDF));
  assert.doesNotThrow(() => assertContentMatchesExtension("docx", ZIP_HEADER));
  assert.doesNotThrow(() => assertContentMatchesExtension("txt", Buffer.from("hello")));
});

// --- Archive limits -------------------------------------------------------

/**
 * Builds a zip that has only a central directory and an end-of-central-
 * directory record — which is all the size check reads. Nothing is ever
 * decompressed, which is the whole point: the sizes are learned from the
 * directory instead of by expanding the entries.
 */
function fakeZip(
  entries: { compressed: number; uncompressed: number }[],
  prefix: Buffer = Buffer.alloc(0)
): Buffer {
  const name = Buffer.from("x");
  const headers = entries.map(({ compressed, uncompressed }) => {
    const header = Buffer.alloc(46 + name.length);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt32LE(compressed, 20);
    header.writeUInt32LE(uncompressed, 24);
    header.writeUInt16LE(name.length, 28);
    name.copy(header, 46);
    return header;
  });
  const directory = Buffer.concat(headers);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  // The directory starts after whatever local-header bytes precede it, which
  // is what a real archive looks like.
  eocd.writeUInt32LE(prefix.length, 16);
  return Buffer.concat([prefix, directory, eocd]);
}

test("a plausible office document passes the archive check", () => {
  const zip = fakeZip(Array.from({ length: 12 }, () => ({ compressed: 4000, uncompressed: 20_000 })));
  const stats = readArchiveStats(zip);
  assert.equal(stats.entries, 12);
  assert.ok(stats.ratio < 10, String(stats.ratio));
});

test("a zip bomb is refused on its compression ratio", () => {
  // 40 KB of entries claiming 50 MB of content: under the absolute expansion
  // cap, so it is the ratio alone that rejects it.
  const zip = fakeZip([{ compressed: 40_000, uncompressed: 50_000_000 }]);
  assert.throws(
    () => readArchiveStats(zip),
    (err: unknown) => err instanceof UploadRejected && /compression ratio/.test(err.message)
  );
});

test("a zip is refused once its declared expansion passes the cap", () => {
  const zip = fakeZip(
    Array.from({ length: 100 }, () => ({ compressed: 1_000_000, uncompressed: 2_000_000 }))
  );
  assert.throws(() => readArchiveStats(zip), UploadRejected);
});

test("a zip with too many entries is refused", () => {
  const zip = fakeZip(
    Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, () => ({ compressed: 1, uncompressed: 1 }))
  );
  assert.throws(() => readArchiveStats(zip), UploadRejected);
});

test("a Zip64 size placeholder is refused rather than guessed at", () => {
  const zip = fakeZip([{ compressed: 0xffffffff, uncompressed: 0xffffffff }]);
  assert.throws(() => readArchiveStats(zip), UploadRejected);
});

test("a file that is not a readable zip is refused", () => {
  assert.throws(() => readArchiveStats(Buffer.from("not a zip at all")), UploadRejected);
});

// --- The whole admission path ---------------------------------------------

test("an oversized upload is refused before anything parses it", () => {
  const huge = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x41);
  const err = (() => {
    try {
      admitUpload("notes.txt", huge);
      return null;
    } catch (e) {
      return e as UploadRejected;
    }
  })();
  assert.ok(err instanceof UploadRejected);
  assert.equal(err.status, 413);
});

test("an empty upload is refused", () => {
  assert.throws(() => admitUpload("notes.txt", Buffer.alloc(0)), UploadRejected);
});

test("a valid text upload is admitted with a cleaned name", () => {
  const result = admitUpload("../notes.md", Buffer.from("# Heading\n\nSome content."));
  assert.deepEqual(result, { name: "notes.md", ext: "md" });
});

test("an office upload runs the archive checks", () => {
  // Prefixed with a real local file header so the file passes the magic-number
  // gate and is rejected specifically on its compression ratio.
  const bomb = fakeZip([{ compressed: 40_000, uncompressed: 50_000_000 }], ZIP_HEADER);
  assert.throws(
    () => admitUpload("deck.pptx", bomb),
    (err: unknown) =>
      err instanceof UploadRejected && /compression ratio/.test(err.message)
  );
});

test("a plausible office upload is admitted end to end", () => {
  const ok = fakeZip(
    Array.from({ length: 10 }, () => ({ compressed: 4000, uncompressed: 20_000 })),
    ZIP_HEADER
  );
  assert.deepEqual(admitUpload("deck.pptx", ok), { name: "deck.pptx", ext: "pptx" });
});
