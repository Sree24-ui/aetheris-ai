"use client";

import { apiRequest } from "./http";
import type { DocumentSummary } from "./types";
import type { IngestionJob } from "./ingestion/jobs";

/**
 * Uploads a document and drives its ingestion to completion (H11).
 *
 * The upload request now only accepts the file and extracts its text; the
 * expensive part — chunking, embedding, concept extraction — is a durable job
 * that advances in bounded slices. This walks that job, reporting progress,
 * so the caller gets the same "here is your document" result it always did
 * without any single request having to finish the whole thing.
 *
 * ponytail: the client is what drives the slices, because a queue and its
 * worker are an infrastructure decision this project has not made. The job is
 * durable either way — closing the tab pauses ingestion rather than losing it,
 * and re-uploading the same document resumes from its checkpoint.
 */

export interface UploadProgress {
  status: IngestionJob["status"];
  /** 0–1, or 0 while the chunk count is still unknown. */
  progress: number;
}

interface AcceptedUpload {
  docId: string;
  jobId: string;
  filename: string;
}

interface JobResponse {
  job: IngestionJob;
  progress: number;
}

/** Slices are capped so a stuck job cannot loop forever in the browser. */
const MAX_SLICES = 400;

export async function uploadDocument(
  file: File,
  options: { signal?: AbortSignal; onProgress?: (progress: UploadProgress) => void } = {}
): Promise<DocumentSummary> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
    signal: options.signal,
  });
  const accepted = (await response.json()) as AcceptedUpload & { error?: string };
  if (!response.ok) throw new Error(accepted.error || "Upload failed");

  options.onProgress?.({ status: "queued", progress: 0 });

  let latest: JobResponse | null = null;
  for (let slice = 0; slice < MAX_SLICES; slice++) {
    latest = await apiRequest<JobResponse>("/api/documents/jobs", {
      method: "POST",
      body: { jobId: accepted.jobId },
      signal: options.signal,
    });
    options.onProgress?.({ status: latest.job.status, progress: latest.progress });
    if (latest.job.status === "succeeded") break;
    if (latest.job.status === "failed") {
      throw new Error(latest.job.error ?? "That document could not be indexed.");
    }
  }

  if (!latest || latest.job.status !== "succeeded") {
    throw new Error(
      "That document is taking longer than expected to index. It will keep its progress — try again in a moment."
    );
  }

  const documents = await apiRequest<{ documents: DocumentSummary[] }>("/api/documents", {
    signal: options.signal,
  });
  const summary = documents.documents.find((d) => d.docId === accepted.docId);
  if (!summary) throw new Error("That document was indexed but could not be read back.");
  return summary;
}
