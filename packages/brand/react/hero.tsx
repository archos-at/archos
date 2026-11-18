import type { ReactNode } from 'react';
import { joinClasses } from './join-classes';

export interface HeroProps {
  title: ReactNode;
  text?: ReactNode;
  media?: ReactNode;
  as?: 'h1' | 'h2';
  className?: string;
}

export function Hero({ title, text, media, as: Title = 'h1', className }: HeroProps) {
  return (
    <section className={className}>
      <div className="ui-container">
        <div className={joinClasses('ui-hero', !media && 'ui-hero-plain')}>
          <Title className="ui-hero-title display-xl">{title}</Title>
          {text ? <p className="ui-hero-text lead">{text}</p> : null}
        </div>
      </div>
      {media ? <div className="ui-wide ui-hero-media">{media}</div> : null}
    </section>
  );
}
