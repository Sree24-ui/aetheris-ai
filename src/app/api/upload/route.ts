import { randomUUID } from "crypto";
import { ApiError, defineRoute } from "@/lib/apiGuard";
import { MIN_EXTRACTED_CHARS } from "@/lib/appConfig";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import {
  MAX_EXTRACTED_CHARS,
  MAX_UPLOAD_BYTES,
  UploadRejected,
  admitUpload,
} from "@/lib/security/uploads";
import { LlmError } from "@/lib/llmError";
import { parseDocument } from "@/lib/documentParser";
import { ingestDocument } from "@/lib/vectorStore";
import { extractConcepts } from "@/lib/teachingAgent";
import type { DocumentSummary } from "@/lib/types";

export const runtime = "nodejs";
// Kept under the 60s ceiling that Vercel's Hobby tier enforces: a higher
// value is not honoured there, and the platform kills the function before
// this route's own timeout fires, leaving nothing useful in the logs.
export const maxDuration = 60;

export const POST = defineRoute(
  {
    name: "upload",
    // The body is multipart, so it is read here rather than through the JSON
    // schema path; every byte of it is still bounded (see admitUpload).
    rateLimit: RATE_LIMITS.upload,
  },
  async ({ req, userId, requestId }) => {
    // Rejected before the body is buffered when the client declares a size
    // over the limit. The declared value is not trusted on its own — the
    // real length is checked again after reading.
    const declared = Number(req.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + 64 * 1024) {
      throw new ApiError(413, "limit", "That file is larger than the upload limit.");
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      throw new ApiError(400, "validation", "That upload could not be read.");
    }
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      throw new ApiError(400, "validation", "No file provided.");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ApiError(413, "limit", "That file is larger than the upload limit.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let admitted: { name: string; ext: string };
    try {
      // H5: size, real format, archive entry count, expanded size and
      // compression ratio are all checked before any parser touches the file.
      admitted = admitUpload(file.name, buffer);
    } catch (err) {
      if (err instanceof UploadRejected) {
        throw new ApiError(err.status, err.status === 413 ? "limit" : "validation", err.message);
      }
      throw err;
    }

    const extracted = await parseDocument(admitted.name, buffer);
    // Bounds everything downstream — chunking, embedding, database rows —
    // by a value that does not depend on how well the file compressed.
    const text = (extracted ?? "").slice(0, MAX_EXTRACTED_CHARS);

    if (text.trim().length < MIN_EXTRACTED_CHARS) {
      throw new ApiError(422, "validation", "Could not extract readable text from this file.");
    }

    const docId = randomUUID();
    const { numChunks, preview, sample } = await ingestDocument(
      docId,
      userId,
      admitted.name,
      text
    );

    // The document itself is already indexed and usable at this point, so a
    // failed concept extraction must not fail the whole upload — but it does
    // need to be reported, or an empty tag list looks like a broken upload.
    let concepts: string[] = [];
    let conceptsWarning: string | undefined;
    try {
      concepts = await extractConcepts(sample);
    } catch (err) {
      // Only an LlmError carries a sentence written for a learner. Anything
      // else keeps its detail in the log and reaches the UI as a generic line.
      console.error(`[upload ${requestId}] concept extraction failed`, err);
      const reason =
        err instanceof LlmError ? err.userMessage : "Try uploading the document again.";
      conceptsWarning = `Document indexed, but key concepts couldn't be extracted. ${reason}`;
    }

    const summary: DocumentSummary = {
      docId,
      filename: admitted.name,
      numChunks,
      language: "auto",
      preview,
      concepts,
      conceptsWarning,
    };
    return summary;
  }
);
