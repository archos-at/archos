import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { joinClasses } from './join-classes';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'text';
  size?: 'sm' | 'md' | 'lg';
  arrow?: boolean;
  href?: string;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  arrow = false,
  href,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = joinClasses('ui-btn', `ui-btn-${variant}`, `ui-btn-${size}`, className);
  const content = (
    <>
      {children}
      {arrow ? (
        <span className="ui-btn-arrow" aria-hidden="true">
          →
        </span>
      ) : null}
    </>
  );
  const attributes: ButtonHTMLAttributes<HTMLElement> = rest;
  if (href) {
    return (
      <a {...attributes} href={href} className={classes}>
        {content}
      </a>
    );
  }
  return (
    <button {...attributes} type={rest.type ?? 'button'} className={classes}>
      {content}
    </button>
  );
}
