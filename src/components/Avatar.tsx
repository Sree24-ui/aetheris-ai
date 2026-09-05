"use client";
import { BLINK_DURATION_MS } from "@/lib/appConfig";
import { expressionFor, type AvatarState } from "@/lib/avatarState";

import { useEffect, useState } from "react";

/**
 * The AI teacher.
 *
 * Previously a floating head with a rounded rectangle for a body, driven by
 * two booleans. A teacher a learner watches for twenty minutes has to do more
 * than open and close its mouth: it looks at them while they answer, it
 * considers what they wrote, and it reacts to whether they got it. So the
 * avatar takes a teaching state and has a face for each one.
 *
 * Still a single inline SVG with no dependency, no rig and no vendor — the
 * expressions are a handful of interpolated control points, and they live in
 * `@/lib/avatarState` where the lookup is total: an unknown state resolves to
 * the resting face rather than returning undefined and taking the teaching
 * session down with it. Every motion is a CSS animation or transition, so the
 * global `prefers-reduced-motion` rule in globals.css switches all of it off
 * without this component knowing.
 */

export type { AvatarState };

interface AvatarProps {
  /** Typed, but not trusted: an unrecognised value renders the resting face. */
  state: AvatarState;
  /** Drives the mouth while speaking; ignored otherwise. */
  mouthOpen: boolean;
  /**
   * True when the lesson is running without a voice. The mouth stays closed
   * rather than miming speech nobody can hear, which would be a lie about
   * what the device is doing.
   */
  silent?: boolean;
}

export default function Avatar({ state, mouthOpen, silent = false }: AvatarProps) {
  const expression = expressionFor(state);
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let inner: ReturnType<typeof setTimeout> | undefined;
    const cycle = () => {
      // Irregular on purpose: a blink on a fixed interval reads as a machine.
      const delay = 2200 + Math.random() * 2500;
      const timer = setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        inner = setTimeout(() => !cancelled && setBlink(false), BLINK_DURATION_MS);
        cycle();
      }, delay);
      return timer;
    };
    const timer = cycle();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(inner);
    };
  }, []);

  const speaking = state === "speaking";
  const open = speaking && mouthOpen && !silent;
  // Pupils track towards the learner while listening and away while thinking —
  // the two moments a real teacher's gaze is doing something.
  const { brow, gaze, mouthCurve } = expression;

  return (
    <div className="flex items-center justify-center w-full h-full min-h-0">
      <svg
        viewBox="0 0 260 250"
        role="img"
        aria-label={`AI teacher, ${state}`}
        className="w-full max-w-[17rem] md:max-w-[21rem] max-h-full drop-shadow-xl"
      >
        <defs>
          <linearGradient id="aetheris-jacket" x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0%" stopColor="#3d4a7a" />
            <stop offset="100%" stopColor="#232c50" />
          </linearGradient>
          <linearGradient id="aetheris-shirt" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f7f9fd" />
            <stop offset="100%" stopColor="#dfe5f2" />
          </linearGradient>
          <radialGradient id="aetheris-halo" cx="50%" cy="42%" r="52%">
            <stop offset="0%" stopColor="var(--color-primary, #d0bcff)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* A soft spotlight, so the teacher is lit rather than pasted on. */}
        <ellipse cx="130" cy="112" rx="118" ry="112" fill="url(#aetheris-halo)" />
        <ellipse cx="130" cy="240" rx="86" ry="10" fill="#00000026" />

        {/* One breathing group so head and torso move together, the way
            a person does. `animation` rather than JS so reduced-motion wins. */}
        <g
          style={{
            transformOrigin: "130px 200px",
            animation: speaking
              ? "aetheris-teach 3.6s ease-in-out infinite"
              : "aetheris-breathe 5.5s ease-in-out infinite",
          }}
        >
          {/* Torso: a jacket over a collared shirt, so this reads as a person
              at the front of a room rather than a head above some text. */}
          <path d="M 56 246 Q 60 196 100 180 L 160 180 Q 200 196 204 246 Z" fill="url(#aetheris-jacket)" />
          <path d="M 100 180 L 130 222 L 160 180 L 146 176 L 130 200 L 114 176 Z" fill="url(#aetheris-shirt)" />
          {/* Lapels */}
          <path d="M 100 180 L 130 222 L 116 224 L 92 190 Z" fill="#2b3560" />
          <path d="M 160 180 L 130 222 L 144 224 L 168 190 Z" fill="#2b3560" />
          {/* Neck */}
          <path d="M 113 164 h 34 v 22 q -17 12 -34 0 Z" fill="#e0ab86" />

          {/* Head */}
          <ellipse cx="130" cy="114" rx="55" ry="61" fill="#F2C6A0" />
          <ellipse cx="77" cy="118" rx="7" ry="12" fill="#e0ab86" />
          <ellipse cx="183" cy="118" rx="7" ry="12" fill="#e0ab86" />
          <path d="M 75 105 A 55 59 0 0 1 185 105 Q 177 75 130 71 Q 83 75 75 105 Z" fill="#3B2A20" />

          {/* Brows — most of the expression, in four numbers. */}
          <path
            d={`M 101 ${97 + brow.lift + brow.tilt} Q 112 ${91 + brow.lift} 123 ${97 + brow.lift - brow.tilt}`}
            stroke="#3B2A20"
            strokeWidth="3.4"
            fill="none"
            strokeLinecap="round"
            style={{ transition: "d 0.3s ease" }}
          />
          <path
            d={`M 137 ${97 + brow.lift - brow.tilt} Q 148 ${91 + brow.lift} 159 ${97 + brow.lift + brow.tilt}`}
            stroke="#3B2A20"
            strokeWidth="3.4"
            fill="none"
            strokeLinecap="round"
            style={{ transition: "d 0.3s ease" }}
          />

          {/* Eyes */}
          <ellipse cx="111" cy="115" rx="8.5" ry={blink ? 0.7 : 9.5} fill="#ffffff" style={{ transition: "ry 0.09s" }} />
          <ellipse cx="149" cy="115" rx="8.5" ry={blink ? 0.7 : 9.5} fill="#ffffff" style={{ transition: "ry 0.09s" }} />
          <circle
            cx={111 + gaze}
            cy="116"
            r={blink ? 0.6 : 4.2}
            fill="#2B2118"
            style={{ transition: "cx 0.45s ease, r 0.09s" }}
          />
          <circle
            cx={149 + gaze}
            cy="116"
            r={blink ? 0.6 : 4.2}
            fill="#2B2118"
            style={{ transition: "cx 0.45s ease, r 0.09s" }}
          />

          <path d="M 130 123 q -4 12 3 14" stroke="#d9a882" strokeWidth="2.4" fill="none" strokeLinecap="round" />

          {/* Mouth: an open ellipse while speaking aloud, otherwise a curve
              whose direction carries the state. */}
          {open ? (
            <ellipse cx="130" cy="152" rx="14" ry="10.5" fill="#7d3535" style={{ transition: "all 0.08s ease" }} />
          ) : (
            <path
              d={`M 115 151 Q 130 ${151 + mouthCurve} 145 151`}
              stroke="#7d3535"
              strokeWidth="3.6"
              fill="none"
              strokeLinecap="round"
              style={{ transition: "d 0.25s ease" }}
            />
          )}
        </g>
      </svg>
    </div>
  );
}
