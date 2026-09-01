"use client";

import { useEffect, useRef, useState } from "react";

let idCounter = 0;

export default function MermaidDiagram({ definition }: { definition: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
        idCounter += 1;
        const id = `mermaid-diagram-${idCounter}`;
        const { svg: rendered } = await mermaid.render(id, definition.trim());
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [definition]);

  if (error) {
    return (
      <pre className="text-xs text-error whitespace-pre-wrap bg-error-container/20 border border-error/30 p-3 rounded">
        Diagram error: {error}
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full overflow-x-auto flex justify-center [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
