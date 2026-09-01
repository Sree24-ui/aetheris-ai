"use client";

import type { LearningPath } from "@/lib/types";
import Icon from "./Icon";

interface Props {
  path: LearningPath;
  currentStepIndex: number;
  onSelectStep: (stepTitle: string, index: number) => void;
  onBack: () => void;
}

export default function LearningPathPanel({ path, currentStepIndex, onSelectStep, onBack }: Props) {
  return (
    <div className="w-full max-w-2xl mx-auto space-y-5 py-4">
      <button onClick={onBack} className="text-on-surface-variant hover:text-tertiary-fixed-dim text-sm flex items-center gap-1">
        <Icon name="arrow_back" className="text-[18px]" /> Back
      </button>
      <h2 className="font-display-lg-mobile text-display-lg-mobile text-on-surface flex items-center gap-3">
        <Icon name="route" className="text-primary-fixed-dim" filled />
        {path.topic}
      </h2>
      <ol className="space-y-2">
        {path.steps.map((step, i) => (
          <li key={step.id}>
            <button
              onClick={() => onSelectStep(step.title, i)}
              className={`w-full text-left glass-panel rounded-xl p-4 transition glow-hover ${
                i === currentStepIndex ? "border-primary/40 bg-primary-container/10" : i < currentStepIndex ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 ${
                    i < currentStepIndex
                      ? "bg-secondary text-on-secondary"
                      : i === currentStepIndex
                      ? "bg-primary-container text-on-primary-container"
                      : "bg-surface-container-high text-on-surface-variant"
                  }`}
                >
                  {i < currentStepIndex ? <Icon name="check" className="text-[16px]" /> : i + 1}
                </span>
                <span className="font-body-lg text-body-lg text-on-surface font-medium">{step.title}</span>
              </div>
              <p className="text-xs text-on-surface-variant mt-1.5 ml-10">{step.description}</p>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
