'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface TextShimmerProps {
  children: string;
  as?: 'p' | 'span' | 'div' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  className?: string;
  duration?: number;
  spread?: number;
}

export function TextShimmer({
  children,
  as = 'p',
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) {
  const dynamicSpread = useMemo(() => {
    return children.length * spread;
  }, [children, spread]);

  const Component = as;

  return (
    <motion.div
      className={cn(
        'relative inline-block bg-[length:250%_100%,auto] bg-clip-text',
        'text-transparent [--base-color:#a1a1aa] [--base-gradient-color:#000]',
        '[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]',
        'dark:[--base-color:#71717a] dark:[--base-gradient-color:#ffffff] dark:[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]',
        className
      )}
      initial={{ backgroundPosition: '100% center' }}
      animate={{ backgroundPosition: '0% center' }}
      transition={{
        repeat: Infinity,
        duration,
        ease: 'linear',
      }}
      style={
        {
          '--spread': `${dynamicSpread}px`,
          backgroundImage: `var(--bg), linear-gradient(var(--base-color), var(--base-color))`,
        } as React.CSSProperties
      }
    >
      {Component === 'p' ? <p className="m-0">{children}</p> : 
       Component === 'span' ? <span>{children}</span> :
       Component === 'div' ? <div>{children}</div> :
       Component === 'h1' ? <h1 className="m-0">{children}</h1> :
       Component === 'h2' ? <h2 className="m-0">{children}</h2> :
       Component === 'h3' ? <h3 className="m-0">{children}</h3> :
       Component === 'h4' ? <h4 className="m-0">{children}</h4> :
       Component === 'h5' ? <h5 className="m-0">{children}</h5> :
       Component === 'h6' ? <h6 className="m-0">{children}</h6> :
       children}
    </motion.div>
  );
}

