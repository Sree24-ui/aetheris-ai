"use client";

import { useEffect } from "react";

/**
 * The application's error boundary (H12).
 *
 * There was none: an exception during render took the whole page to a blank
 * screen with nothing to act on, and nothing recorded that it had happened.
 *
 * `digest` is the id Next assigns to the server-side error and writes to the
 * server log; showing it is what lets a learner's report be matched to the
 * actual failure. The error's own message is deliberately not shown — in
 * production it is redacted anyway, and in development the console has it.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[boundary] unhandled error", error);
  }, [error]);

  return (
    <main className="min-h-[70vh] flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-headline-md text-[22px] text-on-surface">Something went wrong</h1>
      <p className="text-sm text-on-surface-variant max-w-md">
        This page hit an error it could not recover from on its own. Your lesson history and any
        lesson in progress are saved on the server, so nothing has been lost.
      </p>
      {error.digest && (
        <p className="text-xs text-on-surface-variant/70">
          Reference: <code>{error.digest}</code>
        </p>
      )}
      <div className="flex gap-3">
        <button
          onClick={retry}
          className="px-5 py-2.5 rounded-full bg-primary-container text-on-primary-container text-sm font-semibold"
        >
          Try again
        </button>
        <a
          href="/app"
          className="px-5 py-2.5 rounded-full border border-white/10 text-on-surface text-sm"
        >
          Back to lessons
        </a>
      </div>
    </main>
  );
}
