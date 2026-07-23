'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

type Tag = 'div' | 'section' | 'article' | 'header' | 'li' | 'span' | 'tr';

/**
 * Entrance animation for content scrolling into view.
 *
 * Kept deliberately small: 8px of travel over 0.4s with no blur or scale. A
 * reveal you consciously notice reads as decoration; this one just takes the
 * edge off content appearing.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as = 'div',
  y = 8,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: Tag;
  y?: number;
}) {
  const reduced = useReducedMotion();
  const Component = motion[as];

  if (reduced) {
    return <Component className={className}>{children}</Component>;
  }

  return (
    <Component
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px -10% 0px' }}
      transition={{ duration: 0.4, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {children}
    </Component>
  );
}

/** Reveals a list of siblings with a short offset between each. */
export function Stagger({
  children,
  className,
  step = 0.05,
}: {
  children: ReactNode[];
  className?: string;
  step?: number;
}) {
  return (
    <div className={className}>
      {children.map((child, index) => (
        <Reveal key={index} delay={index * step}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}
