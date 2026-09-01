"use client";

import { useEffect, useRef } from "react";
import type { GraphSpec } from "@/lib/types";

export default function GraphCanvas({ graph }: { graph: GraphSpec }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    const { expression, xMin, xMax } = graph;
    let evalFn: (x: number) => number;
    try {
      evalFn = new Function("x", `"use strict"; return (${expression});`) as (x: number) => number;
    } catch {
      ctx.fillStyle = errorColor;
      ctx.fillText("Invalid expression", 10, 20);
      return;
    }

    const samples: { x: number; y: number }[] = [];
    const steps = 400;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i <= steps; i++) {
      const x = xMin + ((xMax - xMin) * i) / steps;
      let y: number;
      try {
        y = evalFn(x);
      } catch {
        y = NaN;
      }
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
  }, [graph]);

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={280}
      className="w-full max-w-xl mx-auto rounded bg-surface-container-lowest/50"
    />
  );
}
