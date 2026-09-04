"use client";

import { useMemo } from "react";
import katex from "katex";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { VisualSpec } from "@/lib/types";
import MermaidDiagram from "./MermaidDiagram";
import GraphCanvas from "./GraphCanvas";
import CodeBlock from "./CodeBlock";
import TimelineView from "./TimelineView";

/** Longest LaTeX source rendered. A real formula is a line or two. */
const MAX_EQUATION_LENGTH = 2000;

function Equation({ tex }: { tex: string }) {
  const html = useMemo(() => {
    if (tex.length > MAX_EQUATION_LENGTH) return null;
    try {
      return katex.renderToString(tex, {
        throwOnError: false,
        displayMode: true,
        // The equation is model-generated, so KaTeX's own escape hatches stay
        // shut: `trust` gates \href, \url and \includegraphics (which would
        // put an attacker-chosen URL into the page), and the expansion limits
        // bound a macro bomb that would otherwise hang the render.
        trust: false,
        maxSize: 50,
        maxExpand: 200,
        output: "html",
      });
    } catch {
      return null;
    }
  }, [tex]);
  // A formula that could not be rendered is shown as its source rather than
  // as HTML, so nothing unrendered is ever injected.
  if (html === null) {
    return <pre className="text-sm py-2 overflow-x-auto whitespace-pre-wrap">{tex}</pre>;
  }
  return (
    <div
      className="text-lg py-2 overflow-x-auto"
      // KaTeX with trust:false emits only its own markup; no attribute or URL
      // from `tex` survives into the output.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function SlideRenderer({ visual }: { visual: VisualSpec }) {
  if (!visual || visual.type === "none") return null;

  switch (visual.type) {
    case "equation":
      return visual.content ? <Equation tex={visual.content} /> : null;
    case "graph":
      return visual.graph ? <GraphCanvas graph={visual.graph} /> : null;
    case "mermaid":
      return visual.content ? <MermaidDiagram definition={visual.content} /> : null;
    case "code":
      return visual.content ? (
        <CodeBlock code={visual.content} language={visual.codeLanguage || undefined} />
      ) : null;
    case "timeline":
      return visual.timeline && visual.timeline.length > 0 ? (
        <TimelineView events={visual.timeline} />
      ) : null;
    case "markdown":
      return visual.content ? (
        <div className="prose prose-sm prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{visual.content}</ReactMarkdown>
        </div>
      ) : null;
    default:
      return null;
  }
}
