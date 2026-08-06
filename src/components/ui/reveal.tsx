'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';

type Tag = 'div' | 'section' | 'article' | 'header' | 'li' | 'span' | 'tr';

/**
 * Light entrance animation. Content always becomes visible — even if the
 * IntersectionObserver never fires (overflow clipping, odd viewports, etc.).
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
  const [forceShow, setForceShow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setForceShow(true), 800 + delay * 1000);
    return () => window.clearTimeout(timer);
  }, [delay]);

  if (reduced) {
    return <Component className={className}>{children}</Component>;
  }

  return (
    <Component
      className={className}
      initial={{ opacity: 0, y }}
      animate={forceShow ? { opacity: 1, y: 0 } : undefined}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.05 }}
      transition={{ duration: 0.35, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
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
