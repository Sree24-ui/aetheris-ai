"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { MERMAID_CONFIG, checkMermaidDefinition, sanitizeDiagramSvg } from "@/lib/security/diagram";

interface RenderedDiagram {
  /** The definition this SVG was produced from, so a stale one is never shown. */
  definition: string;
  svg: string;
  error: string | null;
}

/**
 * Renders a model-generated Mermaid diagram.
 *
 * H1: this used to initialise Mermaid with `securityLevel: "loose"` and insert
 * the rendered SVG directly. The definition is untrusted input — the model
 * writes it, and an uploaded document can steer what the model writes — so it
 * now passes three gates before it reaches the DOM: a source check, Mermaid's
 * own strict mode, and an allow-list sanitiser over the rendered SVG.
 */
export default function MermaidDiagram({ definition }: { definition: string }) {
  const [rendered, setRendered] = useState<RenderedDiagram | null>(null);
  // A render id that is stable per component instance and unique per document,
  // instead of a module-level counter that two mounted diagrams could race on.
  const domId = `mermaid-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  // Computed during render rather than in the effect, so a rejected definition
  // never renders a diagram frame at all.
  const check = useMemo(() => checkMermaidDefinition(definition), [definition]);

  useEffect(() => {
    if (!check.ok) return;
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize(MERMAID_CONFIG);
        const { svg } = await mermaid.render(domId, definition.trim());
        const safe = await sanitizeDiagramSvg(svg);
        if (!cancelled) setRendered({ definition, svg: safe, error: null });
      } catch (err) {
        // The message can quote the model's own definition, so it is kept out
        // of the UI beyond a generic line; the detail goes to the console for
        // a developer looking at one broken diagram.
        console.warn("[mermaid] render failed", err);
        if (!cancelled) {
          setRendered({ definition, svg: "", error: "the diagram could not be drawn" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [definition, domId, check.ok]);

  // Anything produced for a previous definition is ignored rather than shown
  // next to text it does not belong to.
  const current = rendered && rendered.definition === definition ? rendered : null;
  const failure = !check.ok ? check.reason : current?.error;

  if (failure) {
    return (
      <p
        role="note"
        className="text-xs text-on-surface-variant bg-surface-container/40 border border-outline/20 p-3 rounded"
      >
        A diagram for this section was not shown because {failure}. The explanation above still
        covers the concept.
      </p>
    );
  }

  return (
    <div
      role="img"
      aria-label="Diagram illustrating this section"
      className="w-full overflow-x-auto flex justify-center [&_svg]:max-w-full"
      // Safe by construction: this is only ever the output of
      // sanitizeDiagramSvg, which strips every scripting, navigation and
      // external-resource sink from Mermaid's rendered output.
      dangerouslySetInnerHTML={{ __html: current?.svg ?? "" }}
    />
  );
}
