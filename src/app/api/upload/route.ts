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
import { parseDocument } from "@/lib/documentParser";
import { enqueueIngestion } from "@/lib/ingestion/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Accepts an upload and queues its ingestion (H11).
 *
 * This used to extract the file, chunk it, embed every chunk, write the
 * database and run concept extraction inside one request with a 60-second
 * ceiling — so a cold start, a large file or a slow provider left the learner
 * with no completion signal and a half-written document.
 *
 * It now does the bounded part (admission checks and text extraction) and
 * returns a job id. The expensive part advances in slices through
 * /api/documents/jobs, each of which commits its own progress.
 */
export const POST = defineRoute(
  {
    name: "upload",
    // The body is multipart, so it is read here rather than through the JSON
    // schema path; every byte of it is still bounded (see admitUpload).
    rateLimit: RATE_LIMITS.upload,
  },
  async ({ req, userId }) => {
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
    const jobId = randomUUID();
    await enqueueIngestion({ jobId, documentId: docId, userId, filename: admitted.name, text });

    return { docId, jobId, filename: admitted.name, status: "pending" as const };
  }
);
