import type { CSSProperties, ReactNode } from 'react';
import identity from '../identity.json';
import { AITag } from './ai-tag';
import { joinClasses } from './join-classes';
import type { NavLink } from './nav-link';
import { Wordmark } from './wordmark';

export interface SplitPageProps {
  variant?: 'login' | 'form';
  children?: ReactNode;
  image?: string;
  imageAlt?: string;
  imageStyle?: CSSProperties;
  aside?: ReactNode;
  asideNote?: ReactNode;
  ai?: boolean;
  footer?: NavLink[];
  note?: string;
  homeHref?: string;
  className?: string;
}

export function SplitPage({
  variant,
  children,
  image,
  imageAlt,
  imageStyle,
  aside,
  asideNote,
  ai = false,
  footer = [],
  note,
  homeHref,
  className,
}: SplitPageProps) {
  const even = variant === 'form';
  const mainStyle = { maxWidth: even ? 'var(--split-form)' : 'var(--login-form)' } as CSSProperties;

  return (
    <div className={joinClasses('ui-split', even && 'ui-split-even', className)}>
      <div className="ui-split-side">
        <div className="ui-split-top">
          <Wordmark size="sm" href={homeHref || '/'} aria-label={`${identity.name} – Startseite`} />
        </div>
        <main className="ui-split-main" style={mainStyle}>
          {children}
        </main>
        <div className="ui-split-foot small">
          {footer.map((link, i) => (
            <a key={i} href={link.href}>
              {link.label}
            </a>
          ))}
          <span>{note || `© 2026 ${identity.name}`}</span>
        </div>
      </div>
      {even ? (
        <div className="ui-split-aside ui-split-panel">
          {image ? <img src={image} alt="" /> : null}
          <div className="ui-split-card">{aside}</div>
          {asideNote ? <p className="ui-split-note small" data-theme="dark">{asideNote}</p> : null}
        </div>
      ) : (
        <div className="ui-split-aside">
          {image ? <img src={image} alt={imageAlt || ''} style={imageStyle} /> : aside}
          {ai ? <AITag /> : null}
        </div>
      )}
    </div>
  );
}
