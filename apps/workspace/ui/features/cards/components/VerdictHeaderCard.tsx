import { type FC } from 'react'
import { Gavel } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations, type Translator } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { NormRefFooter } from '../schematics/kit'
import type { NormReferenceData } from '@/shared/cards/schemas'
import { CARD_SHELL } from './card-chrome'

type Confidence = 'low' | 'medium' | 'high'

interface VerdictHeaderCardProps {
  verdict: string
  subject: string
  reference?: NormReferenceData | null
  confidence?: Confidence | null
  confidence_reason?: string | null
  flat?: boolean
}

const CONFIDENCE: Record<Confidence, { label: (t: Translator) => string; level: 1 | 2 | 3 }> = {
  high: { label: (t) => t('cards.verdictHeader.confidenceHigh'), level: 3 },
  medium: { label: (t) => t('cards.verdictHeader.confidenceMedium'), level: 2 },
  low: { label: (t) => t('cards.verdictHeader.confidenceLow'), level: 1 },
}

const SEGMENTS = [1, 2, 3] as const

const LONG_VERDICT = 24

export const VerdictHeaderCard: FC<VerdictHeaderCardProps> = ({
  verdict,
  subject,
  reference,
  confidence,
  confidence_reason,
  flat = false,
}) => {
  const t = useTranslations(chatCopy)
  const conf = confidence ? CONFIDENCE[confidence] : null
  const text = verdict ?? ''

  const body = (
    <>
      <SectionLabel icon={Gavel}>{subject}</SectionLabel>

      {/* `hyphens-auto break-words` is not belt-and-braces, it is the phone.
          „Hauptgeschoßfußbodenoberkante" is one 29-character token and at 24px
          it is wider than the whole 314px column, so with only `text-balance`
          it ran straight out of the card. Hyphenation breaks it properly where
          the browser knows German (the document carries `lang`), and the hard
          break is the guarantee that nothing ever overflows the card. */}
      <p
        className={cn(
          'hyphens-auto break-words text-balance text-foreground',
          text.length > LONG_VERDICT ? 'card-figure-24' : 'card-figure-30',
        )}
      >
        {text}
      </p>

      {conf && (
        <div className="flex items-center gap-2">
          {/* Three cells, filled to level. `aria-hidden` because the word
              beside it says the same thing to a screen reader, and two readings
              of one field is one too many.

              The cells are SQUARE, not the charter's 12×3px bars. Drawn as
              bars they were correct at „gering" and „mittel" — one lit, two
              grey, obviously a level — and wrong at „hohe Sicherheit", where
              all three light up, there is no unlit portion left to see, and
              three short strokes in a row read as an em-dash rule leading into
              the label rather than as three of three. A full meter and a rule
              are the same picture; that is a property of filling to level, not
              a tuning problem, and tightening the gaps did not fix it. A square
              is a token rather than a stroke, so ▪▪▪ still counts. */}
          <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
            {SEGMENTS.map((segment) => (
              <span
                key={segment}
                className={cn(
                  'size-[5px] rounded-full',
                  segment <= conf.level ? 'bg-foreground' : 'bg-foreground/20',
                )}
              />
            ))}
          </span>
          <span className="card-meta text-muted-foreground">{conf.label(t)}</span>
        </div>
      )}

      {confidence_reason && (
        <p className="card-caption max-w-prose text-muted-foreground">{confidence_reason}</p>
      )}

      <NormRefFooter reference={reference} bare={flat} />
    </>
  )

  if (flat) {
    return <div className="flex flex-col gap-2.5">{body}</div>
  }

  return <Card className={cn(CARD_SHELL, 'gap-2.5 p-5')}>{body}</Card>
}
