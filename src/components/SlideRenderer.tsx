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

function Equation({ tex }: { tex: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { throwOnError: false, displayMode: true });
    } catch {
      return tex;
    }
  }, [tex]);
  return <div className="text-lg py-2 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />;
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
