"use client";

import { useEffect, useMemo, useRef } from "react";
import type { GraphSpec } from "@/lib/types";
import { tryCompileExpression } from "@/lib/security/mathExpression";

/**
 * Widest domain a generated graph may ask for. An LLM that emits
 * xMin: -1e300 would otherwise produce a sample grid of meaningless values.
 */
const MAX_DOMAIN_SPAN = 1e6;

/** Clamps a model-supplied domain to something plottable, or rejects it. */
function safeDomain(graph: GraphSpec): { xMin: number; xMax: number } | null {
  const { xMin, xMax } = graph;
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) return null;
  if (xMax <= xMin) return null;
  if (xMax - xMin > MAX_DOMAIN_SPAN) return null;
  return { xMin, xMax };
}

export default function GraphCanvas({ graph }: { graph: GraphSpec }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const domain = useMemo(() => safeDomain(graph), [graph]);
  // Compiled once per spec rather than per render: the result is also what
  // decides whether the canvas or the failure state is shown, and what the
  // screen-reader description says.
  const compiled = useMemo(() => tryCompileExpression(graph.expression), [graph.expression]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Read the app's actual design tokens instead of hardcoding separate
    // color values here, so the graph always matches the current theme.
    const rootStyle = getComputedStyle(document.documentElement);
    const tokenColor = (name: string, fallback: string) =>
      rootStyle.getPropertyValue(name).trim() || fallback;
    const axisColor = tokenColor("--color-outline", "#958ea0");
    const lineColor = tokenColor("--color-primary", "#d0bcff");
    const textColor = tokenColor("--color-on-surface", "#d8e3fb");
    const errorColor = tokenColor("--color-error", "#ffb4ab");

    // C1: the expression is model-generated and can be steered by an uploaded
    // document. It is parsed by an allow-listed mathematical grammar and
    // evaluated by walking that AST — never compiled to JavaScript, which is
    // what `new Function` used to do here.
    if (!compiled.ok || !domain) {
      ctx.fillStyle = errorColor;
      ctx.font = "12px sans-serif";
      ctx.fillText(
        compiled.ok ? "Graph domain is invalid" : `Invalid expression: ${compiled.error}`,
        10,
        20
      );
      return;
    }
    const evalFn = compiled.evaluate;
    const { xMin, xMax } = domain;

    const samples: { x: number; y: number }[] = [];
    const steps = 400;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i <= steps; i++) {
      const x = xMin + ((xMax - xMin) * i) / steps;
      const y = evalFn(x);
      if (Number.isFinite(y)) {
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
      samples.push({ x, y });
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = -1;
      yMax = 1;
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const padding = 36;
    const plotW = width - padding * 2;
    const plotH = height - padding * 2;

    const toPx = (x: number) => padding + ((x - xMin) / (xMax - xMin)) * plotW;
    const toPy = (y: number) => padding + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1;
    if (yMin <= 0 && yMax >= 0) {
      ctx.beginPath();
      ctx.moveTo(padding, toPy(0));
      ctx.lineTo(width - padding, toPy(0));
      ctx.stroke();
    }
    if (xMin <= 0 && xMax >= 0) {
      ctx.beginPath();
      ctx.moveTo(toPx(0), padding);
      ctx.lineTo(toPx(0), height - padding);
      ctx.stroke();
    }
    ctx.strokeRect(padding, padding, plotW, plotH);

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let started = false;
    for (const s of samples) {
      if (!Number.isFinite(s.y)) {
        started = false;
        continue;
      }
      const px = toPx(s.x);
      const py = toPy(s.y);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.font = "11px sans-serif";
    ctx.fillText(xMin.toFixed(1), padding, height - padding + 14);
    ctx.fillText(xMax.toFixed(1), width - padding - 20, height - padding + 14);
    ctx.fillText(yMax.toFixed(1), 4, padding + 4);
    ctx.fillText(yMin.toFixed(1), 4, height - padding);
    if (graph.label) {
      ctx.fillText(graph.label, padding, 16);
    }
  }, [graph, compiled, domain]);

  // A canvas is opaque to assistive technology, so the curve is also
  // described in text: what is plotted, over which domain, and its label.
  const description = compiled.ok && domain
    ? `Graph of ${graph.label ? `${graph.label}: ` : ""}y = ${graph.expression}, ` +
      `plotted for x from ${domain.xMin} to ${domain.xMax}.`
    : "This graph could not be displayed because its definition was not valid.";

  return (
    <figure className="w-full max-w-xl mx-auto">
      <canvas
        ref={canvasRef}
        width={480}
        height={280}
        role="img"
        aria-label={description}
        className="w-full rounded bg-surface-container-lowest/50"
      />
      <figcaption className="sr-only">{description}</figcaption>
    </figure>
  );
}
