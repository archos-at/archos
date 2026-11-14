import type { ReactNode } from 'react';
import { joinClasses } from './join-classes';

export interface QuoteProps {
  quote: string;
  name: string;
  role?: string;
  office?: string;
  /** Portrait (an <img>, 4:5) to the right, portrait-width wide */
  portrait?: ReactNode;
  /** The photo keeps its own landscape proportions and takes 7 of 12 columns */
  wide?: boolean;
  /** Photo credit under the photo: a `.ui-quote-credit-holder` span, then the links side by side */
  credit?: ReactNode;
  className?: string;
}

export function Quote({ quote, name, role, office, portrait, wide, credit, className }: QuoteProps) {
  const meta = [role, office].filter(Boolean).join(', ');
  const figure = (
    <figure className="ui-quote">
      <blockquote>
        <p className="ui-quote-text heading-2">{quote}</p>
      </blockquote>
      <figcaption className="ui-quote-cite small">
        <span className="ui-quote-name">{name}</span>
        {meta ? ` · ${meta}` : null}
      </figcaption>
    </figure>
  );

  if (!portrait) return <div className={className}>{figure}</div>;

  return (
    <div className={joinClasses('ui-quote-wrap', wide ? 'ui-quote-wrap--wide' : undefined, className)}>
      {figure}
      <figure className="ui-quote-portrait">
        {portrait}
        {credit ? <figcaption className="ui-quote-credit caption">{credit}</figcaption> : null}
      </figure>
    </div>
  );
}
