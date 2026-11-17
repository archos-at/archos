import type { HTMLAttributes } from 'react';
import identity from '../identity.json';
import { joinClasses } from './join-classes';

export interface WordmarkProps extends HTMLAttributes<HTMLElement> {
  size?: 'sm' | 'md' | 'lg';
  href?: string;
}

export function Wordmark({ size = 'md', href, className, children: _children, ...rest }: WordmarkProps) {
  const classes = joinClasses('ui-wordmark', `ui-wordmark-${size}`, className);
  if (href) {
    return (
      <a {...rest} href={href} className={classes}>
        {identity.name}
      </a>
    );
  }
  return (
    <span {...rest} className={classes}>
      {identity.name}
    </span>
  );
}
