import { ApiError, defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { ingestionJobRequestSchema } from "@/lib/schemas/requests";
import { jobProgress, loadJob, runSlice } from "@/lib/ingestion/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Drives and reports one ingestion job (H11).
 *
 * GET is the status the upload UI polls. POST advances the job by one bounded
 * slice — a handful of chunks embedded and committed, then the checkpoint
 * moved — and returns where it now stands.
 *
 * Splitting it this way is what makes ingestion resumable: no single request
 * has to finish the whole document inside its execution ceiling, and a slice
 * that dies costs one slice rather than the upload.
 */
export const GET = defineRoute(
  { name: "ingest-status", rateLimit: RATE_LIMITS.standard },
  async ({ req, userId }) => {
    const jobId = new URL(req.url).searchParams.get("jobId");
    if (!jobId) throw new ApiError(400, "validation", "A job id is required.");
    const job = await loadJob(jobId, userId);
    if (!job) throw new ApiError(404, "notFound", "That upload could not be found.");
    return { job, progress: jobProgress(job) };
  }
);

export const POST = defineRoute(
  {
    name: "ingest-run",
    schema: ingestionJobRequestSchema,
    maxBytes: 1024,
    // Each call does real embedding work, so it draws on the upload budget
    // rather than the cheap one.
    rateLimit: { limit: 120, windowMs: 60_000 },
  },
  async ({ body, userId }) => {
    const job = await runSlice(body.jobId, userId);
    if (!job) throw new ApiError(404, "notFound", "That upload could not be found.");
    return { job, progress: jobProgress(job) };
  }
);
