'use client';

import { useEffect, useRef, useState } from 'react';

const TITLE = 'V2 is loading';

/**
 * Full-site lock while PonsVault prepares for pons v2.
 */
export function V2Lock() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

  return (
    <div className="pv-v2-lock" role="dialog" aria-modal="true" aria-labelledby="pv-v2-lock-title">
      <div className="pv-v2-lock-glow" aria-hidden />

      <main className="pv-v2-lock-main">
        <p className="pv-v2-lock-kicker">
          <span className="pv-mono">02</span>
          incoming
        </p>
        <h1 id="pv-v2-lock-title" className="pv-v2-lock-title" aria-label={TITLE}>
          <InteractiveLetters text={TITLE} />
        </h1>
        <p className="pv-v2-lock-lead">
          The vault layer is being rewritten for the next pons. Stand by.
        </p>

        <div className="pv-v2-lock-spinner" aria-hidden>
          <span className="pv-v2-lock-spinner-ring" />
        </div>
      </main>
    </div>
  );
}

function InteractiveLetters({ text }: { text: string }) {
  const [active, setActive] = useState<number | null>(null);
  const clearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearRef.current) clearTimeout(clearRef.current);
    };
  }, []);

  return (
    <span className="pv-v2-lock-letters" aria-hidden>
      {Array.from(text).map((char, index) => {
        if (char === ' ') {
          return (
            <span key={`space-${index}`} className="pv-v2-lock-letter is-space">
              {'\u00a0'}
            </span>
          );
        }

        return (
          <button
            key={`${char}-${index}`}
            type="button"
            className={`pv-v2-lock-letter${active === index ? ' is-active' : ''}`}
            tabIndex={0}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
            onClick={() => {
              setActive(index);
              if (clearRef.current) clearTimeout(clearRef.current);
              clearRef.current = setTimeout(() => setActive(null), 220);
            }}
          >
            {char}
          </button>
        );
      })}
    </span>
  );
}
