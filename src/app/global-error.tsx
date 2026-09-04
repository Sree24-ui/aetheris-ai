"use client";

import { useEffect } from "react";

/**
 * The last-resort boundary, for an error thrown in the root layout itself.
 *
 * It replaces the whole document, so it has to render its own <html> and
 * <body> and cannot rely on any of the app's styling having loaded.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[boundary] root layout error", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "2rem",
          textAlign: "center",
          background: "#0f0d13",
          color: "#e6e0e9",
        }}
      >
        <h1 style={{ fontSize: "1.4rem", margin: 0 }}>Aetheris AI could not start</h1>
        <p style={{ maxWidth: "32rem", opacity: 0.8, margin: 0 }}>
          Something failed before the application could render. Reloading usually clears it.
        </p>
        {error.digest && <p style={{ fontSize: "0.8rem", opacity: 0.6 }}>Reference: {error.digest}</p>}
        <button
          onClick={retry}
          style={{
            padding: "0.6rem 1.4rem",
            borderRadius: "999px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
