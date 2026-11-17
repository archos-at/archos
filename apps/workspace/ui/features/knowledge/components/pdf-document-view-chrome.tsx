import { useState, type FC, type JSX, type ReactNode } from 'react'

import { AlertTriangle, Check, ExternalLink, LockKeyhole, Quote, RotateCcw, TextSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

import { Input } from '@/components/ui/input'

import { cn } from '@/lib/utils'

import { capturePosthog } from '@/lib/analytics/posthog'
import { useTranslations } from '@/i18n'
import { knowledgeCopy } from '@/i18n/namespaces/knowledge'

import { QuoteSelection } from './pdf-document-view-helpers'

export function HostGround({ className, children }: { className?: string; children?: ReactNode }): JSX.Element {
  return <div className={cn('relative min-h-0 min-w-0', className)}>{children}</div>
}

export const PdfFailure: FC<{ href: string; onRetry: () => void }> = ({ href, onRetry }) => {
  const t = useTranslations(knowledgeCopy)
  return (
    <EmptyState
      variant="bare"
      icon={AlertTriangle}
      tone="warning"
      title={t('viewer.failedTitle')}
      description={t('viewer.failedBody')}
      data-testid="pdf-load-failed"
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden />
            {t('viewer.retry')}
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => capturePosthog('document_opened', { kind: 'pdf', library: 'browser' })}
            >
              <ExternalLink aria-hidden />
              {t('viewer.openInBrowser')}
            </a>
          </Button>
        </div>
      }
    />
  )
}

export const PdfPasswordPrompt: FC<{ incorrect: boolean; onSubmit: (password: string) => void }> = ({
  incorrect,
  onSubmit,
}) => {
  const t = useTranslations(knowledgeCopy)
  const [value, setValue] = useState('')
  return (
    <EmptyState
      variant="bare"
      icon={LockKeyhole}
      title={t('viewer.passwordTitle')}
      description={t('viewer.passwordBody')}
      data-testid="pdf-password"
      action={
        <form
          className="flex w-full max-w-xs flex-col items-stretch gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (value) onSubmit(value)
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            autoFocus
            enterKeyHint="go"
            aria-label={t('viewer.passwordLabel')}
            placeholder={t('viewer.passwordLabel')}
            aria-invalid={incorrect || undefined}
            aria-describedby={incorrect ? 'pdf-password-error' : undefined}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          {incorrect && (
            <p id="pdf-password-error" role="alert" className="text-destructive text-left text-xs">
              {t('viewer.passwordIncorrect')}
            </p>
          )}
          <Button type="submit" size="sm" disabled={!value}>
            {t('viewer.passwordSubmit')}
          </Button>
        </form>
      }
    />
  )
}

export const QuoteBar: FC<{
  selection: QuoteSelection
  state: 'idle' | 'done' | 'failed'
  onCopy?: () => void
  onFindSimilar?: () => void
}> = ({ selection, state, onCopy, onFindSimilar }) => {
  const t = useTranslations(knowledgeCopy)
  const label =
    state === 'done'
      ? t('viewer.quoteCopied')
      : state === 'failed'
        ? t('viewer.copyFailed')
        : t('viewer.copyQuote')
  return (
    <div
      data-testid="pdf-quote-bar"
      className="absolute z-10 -translate-y-full pb-1.5"
      style={{ left: Math.max(0, selection.x), top: selection.y }}
    >
      <span className="flex items-center gap-1.5">
        {onCopy && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onCopy}
            className="bg-card shadow-sm"
          >
            {state === 'done' ? (
              <Check aria-hidden className="size-3.5" />
            ) : (
              <Quote aria-hidden className="size-3.5" />
            )}
            {label}
          </Button>
        )}
        {onFindSimilar && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onFindSimilar}
            className="bg-card shadow-sm"
            data-testid="pdf-find-similar"
          >
            <TextSearch aria-hidden className="size-3.5" />
            {t('viewer.findSimilar')}
          </Button>
        )}
      </span>
    </div>
  )
}
