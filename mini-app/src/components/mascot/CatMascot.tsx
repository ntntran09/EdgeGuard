'use client';

import { useState, useCallback } from 'react';
import type { MascotState } from '@/types';

interface CatMascotProps {
  state?: MascotState;
  size?: number;
  message?: string;
  onClick?: () => void;
}

export function CatMascot({ state = 'idle', size = 140, message, onClick }: CatMascotProps) {
  const currentState = state;
  const showMessage = Boolean(message);
  const [isClicked, setIsClicked] = useState(false);

  const handleClick = useCallback(() => {
    setIsClicked(true);
    setTimeout(() => setIsClicked(false), 500);
    onClick?.();
  }, [onClick]);

  const animationMap: Record<MascotState, string> = {
    happy: 'mascot-happy 0.7s ease-in-out infinite',
    alert: 'mascot-shake 0.38s ease infinite',
    sleep: 'mascot-float 3.2s ease-in-out infinite',
    idle:  'mascot-float 2.8s ease-in-out infinite',
  };

  return (
    <div
      className="mascot-wrapper"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label="Mascot EdgeGuard"
      style={{ animation: animationMap[currentState], cursor: 'pointer', userSelect: 'none' }}
    >
      {/* Speech bubble */}
      {showMessage && message && (
        <div className="mascot-bubble">
          {message}
          <div className="mascot-bubble-tail" />
        </div>
      )}

      {/* Zzz when sleeping */}
      {currentState === 'sleep' && (
        <div className="mascot-zzz">
          {['z', 'z', 'Z'].map((z, i) => (
            <span key={i} style={{ animationDelay: `${i * 0.6}s`, fontSize: `${0.6 + i * 0.15}rem` }}>{z}</span>
          ))}
        </div>
      )}

      {/* Alert ! badge */}
      {currentState === 'alert' && (
        <div className="mascot-alert-stars">
          <span>!</span>
        </div>
      )}

      <svg
        viewBox="0 0 100 115"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          display: 'block',
          filter: isClicked
            ? 'brightness(1.1) drop-shadow(0 6px 18px rgba(55,114,195,0.3))'
            : 'drop-shadow(0 8px 22px rgba(55,114,195,0.22))',
          transition: 'filter 0.2s ease',
          overflow: 'visible',
        }}
      >
        <defs>
          {/* Body gradient — muted, natural blue */}
          <linearGradient id="m-body" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%"   stopColor="#5b9cf6" />
            <stop offset="100%" stopColor="#3b7dd8" />
          </linearGradient>
          {/* Belly — soft tint */}
          <linearGradient id="m-belly" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%"   stopColor="#c7deff" />
            <stop offset="100%" stopColor="#a8c8f8" />
          </linearGradient>
          {/* Inner ear */}
          <linearGradient id="m-ear-inner" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%"   stopColor="#8bbcfa" />
            <stop offset="100%" stopColor="#6ba3f0" />
          </linearGradient>
          {/* Shine */}
          <radialGradient id="m-shine" cx="38%" cy="28%" r="52%">
            <stop offset="0%"   stopColor="rgba(255,255,255,0.32)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>

        {/* ── Ears ── */}
        <path
          d="M28 50 Q22 26 35 30 Z"
          fill="#3b7dd8"
          style={{
            transformOrigin: '29px 38px',
            animation: currentState === 'alert' ? 'ear-twitch 0.45s ease infinite alternate' : undefined,
          }}
        />
        <path
          d="M72 50 Q78 26 65 30 Z"
          fill="#3b7dd8"
          style={{
            transformOrigin: '71px 38px',
            animation: currentState === 'alert' ? 'ear-twitch 0.45s ease infinite alternate-reverse' : undefined,
          }}
        />
        {/* Inner ear highlight */}
        <path d="M29 48 Q24 30 35 33 Z" fill="url(#m-ear-inner)" opacity="0.7" />
        <path d="M71 48 Q76 30 65 33 Z" fill="url(#m-ear-inner)" opacity="0.7" />

        {/* ── Body blob ── */}
        <path
          d="M18 84 Q15 46 50 44 Q85 46 82 84 Q83 100 68 100 Q50 97 32 100 Q17 100 18 84 Z"
          fill="url(#m-body)"
        />
        {/* Shine on body */}
        <path
          d="M18 84 Q15 46 50 44 Q85 46 82 84 Q83 100 68 100 Q50 97 32 100 Q17 100 18 84 Z"
          fill="url(#m-shine)"
        />
        {/* Belly oval */}
        <ellipse cx="50" cy="82" rx="20" ry="14" fill="url(#m-belly)" opacity="0.65" />

        {/* ── Feet ── */}
        <ellipse cx="33" cy="102" rx="8" ry="4.5" fill="#3371cc" />
        <ellipse cx="67" cy="102" rx="8" ry="4.5" fill="#3371cc" />

        {/* ── Eyes ── */}
        {currentState === 'sleep' ? (
          /* Closed — downward arcs */
          <>
            <path d="M36 60 Q42 66 48 60" stroke="#1a3560" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            <path d="M52 60 Q58 66 64 60" stroke="#1a3560" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          </>
        ) : currentState === 'happy' ? (
          /* Happy — upward squint */
          <>
            <path d="M36 62 Q42 56 48 62" stroke="#1a3560" strokeWidth="2.8" strokeLinecap="round" fill="none" />
            <path d="M52 62 Q58 56 64 62" stroke="#1a3560" strokeWidth="2.8" strokeLinecap="round" fill="none" />
          </>
        ) : (
          /* Normal / Alert — round eyes */
          <>
            <ellipse
              cx="42" cy="60"
              rx={currentState === 'alert' ? 6.5 : 5.5}
              ry={currentState === 'alert' ? 7.5 : 6.5}
              fill="#1a3560"
              style={{ animation: currentState === 'idle' ? 'blink 4.5s ease infinite' : undefined }}
            />
            <circle cx="44.5" cy="57.5" r="2.2" fill="white" />
            <circle cx="43.2" cy="56.5" r="0.9" fill="white" opacity="0.6" />
            <ellipse
              cx="58" cy="60"
              rx={currentState === 'alert' ? 6.5 : 5.5}
              ry={currentState === 'alert' ? 7.5 : 6.5}
              fill="#1a3560"
              style={{ animation: currentState === 'idle' ? 'blink 4.5s ease infinite 0.15s' : undefined }}
            />
            <circle cx="60.5" cy="57.5" r="2.2" fill="white" />
            <circle cx="59.2" cy="56.5" r="0.9" fill="white" opacity="0.6" />
          </>
        )}

        {/* ── Mouth ── */}
        {currentState === 'happy' ? (
          <path d="M44 72 Q50 78 56 72" stroke="#1a3560" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        ) : currentState === 'alert' ? (
          <path d="M46 72 Q50 74 54 72" stroke="#1a3560" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        ) : currentState === 'sleep' ? (
          <path d="M47 72 Q50 74 53 72" stroke="#1a3560" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4" />
        ) : (
          <path d="M45 72 Q50 75.5 55 72" stroke="#1a3560" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        )}

        {/* ── Cheek blush ── */}
        {(currentState === 'happy' || currentState === 'idle') && (
          <>
            <ellipse cx="32" cy="66" rx="5" ry="3" fill="#f8a4c0" opacity={currentState === 'happy' ? 0.5 : 0.25} />
            <ellipse cx="68" cy="66" rx="5" ry="3" fill="#f8a4c0" opacity={currentState === 'happy' ? 0.5 : 0.25} />
          </>
        )}

        {/* ── Happy sparkles ── */}
        {currentState === 'happy' && (
          <>
            <text x="82" y="46" fontSize="11" fill="#f5c518" style={{ animation: 'sparkle-twinkle 0.9s ease-in-out infinite' }}>✦</text>
            <text x="8"  y="52" fontSize="9"  fill="#f5c518" style={{ animation: 'sparkle-twinkle 0.9s ease-in-out infinite 0.35s' }}>✧</text>
          </>
        )}
      </svg>
    </div>
  );
}
