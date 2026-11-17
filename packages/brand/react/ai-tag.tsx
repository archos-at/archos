import { joinClasses } from './join-classes';

export interface AITagProps {
  ink?: boolean;
  className?: string;
}

export function AITag({ ink = false, className }: AITagProps) {
  return (
    <span className={joinClasses('ui-ai-tag', ink && 'ui-ai-tag-ink', className)} title="KI-generiertes Bild">
      AI
    </span>
  );
}
