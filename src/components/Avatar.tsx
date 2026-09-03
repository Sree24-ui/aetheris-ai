"use client";
import { BLINK_DURATION_MS } from "@/lib/appConfig";

import { useEffect, useState } from "react";

interface AvatarProps {
  speaking: boolean;
  mouthOpen: boolean;
}

export default function Avatar({ speaking, mouthOpen }: AvatarProps) {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cycle = () => {
      const delay = 2200 + Math.random() * 2500;
      const t = setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        setTimeout(() => !cancelled && setBlink(false), BLINK_DURATION_MS);
        cycle();
      }, delay);
      return t;
    };
    const t = cycle();
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  // `max-h-full` lets the avatar scale down when the stage is short instead of
  // pushing the captions out of the frame; the viewBox preserves the aspect
  // ratio, so shrinking letterboxes rather than distorts.
  return (
    <div className="flex items-center justify-center w-full h-full min-h-0">
      <svg
        viewBox="0 0 240 240"
        className="w-56 h-56 md:w-72 md:h-72 max-h-full max-w-full drop-shadow-lg"
        style={{ transition: "transform 0.3s ease" }}
      >
        <ellipse cx="120" cy="225" rx="70" ry="14" fill="#00000022" />
        <g style={{ transform: speaking ? "translateY(-1px)" : "none", transition: "transform 0.15s" }}>
          <rect x="95" y="150" width="50" height="55" rx="18" fill="#3454D1" />
          <circle cx="120" cy="115" r="58" fill="#F2C6A0" />
          <path d="M 62 105 A 58 58 0 0 1 178 105 L 178 85 A 58 40 0 0 0 62 85 Z" fill="#3B2A20" />
          <ellipse cx="97" cy="112" rx="6" ry={blink ? 0.6 : 7} fill="#2B2118" style={{ transition: "ry 0.09s" }} />
          <ellipse cx="143" cy="112" rx="6" ry={blink ? 0.6 : 7} fill="#2B2118" style={{ transition: "ry 0.09s" }} />
          <path d="M 90 132 Q 97 128 104 132" stroke="#8a5a3a" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M 136 132 Q 143 128 150 132" stroke="#8a5a3a" strokeWidth="2" fill="none" strokeLinecap="round" />
          <ellipse
            cx="120"
            cy={mouthOpen ? 152 : 150}
            rx={mouthOpen ? 16 : 14}
            ry={mouthOpen ? 12 : 3.5}
            fill="#8a3b3b"
            style={{ transition: "all 0.09s ease" }}
          />
        </g>
      </svg>
    </div>
  );
}
