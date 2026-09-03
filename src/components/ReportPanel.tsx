"use client";
import { CONFETTI_DURATION_MS } from "@/lib/appConfig";

import { useEffect, useState } from "react";
import type { LearningReport } from "@/lib/types";
import Icon from "./Icon";

interface Props {
  report: LearningReport;
  onRestart: () => void;
  onNextTopic?: (topic: string) => void;
}

interface ConfettiPiece {
  id: number;
  left: number;
  color: string;
  delay: number;
  duration: number;
}

const CONFETTI_COLORS = ["#d0bcff", "#89ceff", "#ffb690", "#a078ff"];

function generateConfetti(score: number): ConfettiPiece[] {
  if (score < 60) return [];
  return Array.from({ length: 40 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    delay: Math.random() * 2,
    duration: Math.random() * 2 + 2,
  }));
}

export default function ReportPanel({ report, onRestart, onNextTopic }: Props) {
  const score = Math.round(report.scorePercent);
  // Lazy initializer: generated once on mount, not recomputed on re-render.
  const [confetti, setConfetti] = useState<ConfettiPiece[]>(() => generateConfetti(score));

  useEffect(() => {
    if (confetti.length === 0) return;
    const timer = setTimeout(() => setConfetti([]), CONFETTI_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-container-padding relative">
      <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
        {confetti.map((c) => (
          <div
            key={c.id}
            className="confetti"
            style={{
              left: `${c.left}vw`,
              backgroundColor: c.color,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.duration}s`,
            }}
          />
        ))}
      </div>

      <div className="glass-panel rounded-[2rem] w-full max-w-4xl p-6 sm:p-10 shadow-2xl relative z-10">
        <div className="text-center mb-10">
          <Icon
            name="workspace_premium"
            filled
            className="text-tertiary-fixed-dim text-6xl mb-4 animate-float inline-block"
          />
          <h1 className="font-display-lg text-display-lg-mobile text-primary-fixed-dim tracking-tight mb-2">
            Lesson Complete!
          </h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant">{report.topic}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-5 glass-panel rounded-xl p-6 flex flex-col items-center justify-center relative glow-hover">
            <h2 className="font-headline-md text-headline-md text-secondary mb-4 self-start">Performance</h2>
            <div className="relative w-48 h-48 my-4">
              <svg className="circular-chart absolute inset-0 w-full h-full" viewBox="0 0 36 36">
                <path
                  className="circle-bg"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="circle"
                  strokeDasharray={`${score}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display-lg-mobile text-display-lg-mobile text-primary-fixed-dim">{score}%</span>
                <span className="font-label-caps text-label-caps text-on-surface-variant mt-1">Score</span>
              </div>
            </div>
          </div>

          <div className="md:col-span-7 flex flex-col gap-6">
            <div className="glass-panel rounded-xl p-6 relative overflow-hidden border-l-4 border-l-secondary">
              <div className="absolute -right-4 -top-4 text-secondary/10">
                <Icon name="smart_toy" className="text-[100px]" />
              </div>
              <div className="flex items-start gap-4 relative z-10">
                <div className="w-10 h-10 rounded-full bg-secondary-container/20 flex items-center justify-center shrink-0">
                  <Icon name="psychology" className="text-secondary" />
                </div>
                <div>
                  <h3 className="font-label-caps text-label-caps text-secondary mb-2 uppercase tracking-wider">
                    AI Insight
                  </h3>
                  <p className="font-body-md text-body-md text-on-surface">{report.recommendation}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="glass-panel rounded-xl p-5 glow-hover">
                <div className="flex items-center gap-2 mb-3 text-secondary-fixed">
                  <Icon name="check_circle" className="text-xl" />
                  <h4 className="font-label-caps text-label-caps">Concepts Mastered</h4>
                </div>
                <div className="flex flex-wrap gap-2">
                  {report.strongAreas.length > 0 ? (
                    report.strongAreas.map((a) => (
                      <span
                        key={a}
                        className="px-3 py-1 bg-secondary/10 text-secondary-fixed-dim text-sm rounded-full border border-secondary/20"
                      >
                        {a}
                      </span>
                    ))
                  ) : (
                    <span className="text-on-surface-variant text-sm">—</span>
                  )}
                </div>
              </div>
              <div className="glass-panel rounded-xl p-5 glow-hover">
                <div className="flex items-center gap-2 mb-3 text-tertiary-fixed-dim">
                  <Icon name="flag" className="text-xl" />
                  <h4 className="font-label-caps text-label-caps">Needs Revision</h4>
                </div>
                <div className="flex flex-wrap gap-2">
                  {report.weakAreas.length > 0 ? (
                    report.weakAreas.map((a) => (
                      <span
                        key={a}
                        className="px-3 py-1 bg-tertiary/10 text-tertiary-fixed-dim text-sm rounded-full border border-tertiary/20"
                      >
                        {a}
                      </span>
                    ))
                  ) : (
                    <span className="text-on-surface-variant text-sm">None — great work!</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-8 border-t border-white/5 flex flex-col sm:flex-row gap-4 justify-center items-center">
          <button
            onClick={onRestart}
            className="w-full sm:w-auto px-8 py-3 rounded-full glass-panel text-on-surface hover:bg-white/5 border border-outline/30 font-body-md font-medium transition-all flex items-center justify-center gap-2 glow-hover"
          >
            <Icon name="home" className="text-lg" />
            New Lesson
          </button>
          {onNextTopic && report.suggestedNextTopic && (
            <button
              onClick={() => onNextTopic(report.suggestedNextTopic)}
              className="btn-sheen w-full sm:w-auto px-8 py-3 rounded-full bg-primary-container text-on-primary-container hover:bg-primary-fixed font-body-md font-semibold transition-all flex items-center justify-center gap-2 relative overflow-hidden shadow-[0_0_20px_rgba(160,120,255,0.3)] hover:shadow-[0_0_30px_rgba(160,120,255,0.5)]"
            >
              Start Next: {report.suggestedNextTopic}
              <Icon name="arrow_forward" className="text-lg" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
