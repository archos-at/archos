'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { Bug, ChevronDown, CircleHelp, Heart, Lightbulb, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ChoiceCard, ChoiceCardGroup } from '@/components/ui/choice-card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { isCoarsePointer } from '@/components/ui/overlay-focus'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useModifierLabel } from '@/components/shell/shortcut-keys'
import { useTranslations } from '@/i18n'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import { capturePosthog, getPosthogSupportContext } from '@/lib/analytics/posthog'
import {
  captureFeedbackContext,
  type SubmitProductFeedbackRequest,
  type SubmitProductFeedbackResult,
} from '@/lib/product-feedback/client'
import {
  type SubmittedProductFeedbackView,
  PRODUCT_FEEDBACK_KINDS,
  PRODUCT_FEEDBACK_MESSAGE_MAX,
  PRODUCT_FEEDBACK_MESSAGE_MIN,
  type ProductFeedbackKind,
} from '@/lib/product-feedback/types'
import { cn } from '@/lib/utils'

export const FEEDBACK_KIND_ICONS: Record<ProductFeedbackKind, LucideIcon> = {
  bug: Bug,
  idea: Lightbulb,
  praise: Heart,
  question: CircleHelp,
}

export const FIT_VIEWPORT = '[&>[data-radix-scroll-area-viewport]>div]:!block'

export interface FeedbackFormProps {
  defaultKind?: ProductFeedbackKind
  userEmail?: string | null
  submit: (request: SubmitProductFeedbackRequest) => Promise<SubmitProductFeedbackResult>
  onSent: (reportId: string) => void
  onCancel: () => void
  onSendingChange?: (sending: boolean) => void
}

function relayToPosthog(report: SubmittedProductFeedbackView): void {
  capturePosthog('product_feedback_submitted', { kind: report.kind })
}

export function FeedbackForm({
  defaultKind = 'bug',
  userEmail = null,
  submit,
  onSent,
  onCancel,
  onSendingChange,
}: FeedbackFormProps): JSX.Element {
  const t = useTranslations(feedbackCopy)
  const mod = useModifierLabel()
  const messageId = React.useId()
  const contactId = React.useId()

  const [kind, setKind] = React.useState<ProductFeedbackKind>(defaultKind)
  const [message, setMessage] = React.useState('')
  const [allowContact, setAllowContact] = React.useState(true)
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [showLengthHint, setShowLengthHint] = React.useState(false)
  const [captured] = React.useState(() => captureFeedbackContext())
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    if (!isCoarsePointer()) textareaRef.current?.focus()
  }, [])

  const setBusy = (next: boolean): void => {
    setSending(next)
    onSendingChange?.(next)
  }

  const trimmedLength = message.trim().length
  const tooShort = trimmedLength < PRODUCT_FEEDBACK_MESSAGE_MIN

  async function send(): Promise<void> {
    if (sending) return
    if (tooShort) {
      setShowLengthHint(true)
      textareaRef.current?.focus()
      return
    }
    setError(null)
    setBusy(true)
    const result = await submit({
      kind,
      message: message.trim(),
      allowContact,
      pagePath: captured.pagePath,
      context: captured.context,
      posthog: getPosthogSupportContext(),
    })
    setBusy(false)
    if (result.ok) {
      relayToPosthog(result.report)
      onSent(result.report.id)
      return
    }
    setError(result.reason === 'rate-limited' ? t('dialog.rateLimited') : t('dialog.error'))
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault()
    void send()
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="flex min-h-0 flex-1 flex-col"
      data-testid="feedback-form"
    >
      <ScrollArea className={cn('min-h-0 flex-1', FIT_VIEWPORT)}>
        <div className="flex flex-col gap-5 p-4">
          <fieldset className="flex flex-col gap-2" disabled={sending}>
            <legend className="mb-2 text-sm font-medium">{t('dialog.kindLabel')}</legend>
            <ChoiceCardGroup
              value={kind}
              onValueChange={(value) => setKind(value as ProductFeedbackKind)}
              aria-label={t('dialog.kindLabel')}
            >
              {PRODUCT_FEEDBACK_KINDS.map((option) => (
                <ChoiceCard
                  key={option}
                  value={option}
                  icon={FEEDBACK_KIND_ICONS[option]}
                  label={t(`kinds.${option}.label`)}
                  hint={t(`kinds.${option}.hint`)}
                  data-testid={`feedback-kind-${option}`}
                />
              ))}
            </ChoiceCardGroup>
          </fieldset>

          <Field>
            <div className="flex items-baseline justify-between gap-3">
              <FieldLabel htmlFor={messageId}>{t('dialog.messageLabel')}</FieldLabel>
              <span
                className={cn(
                  'text-muted-foreground text-xs tabular-nums',
                  message.length > PRODUCT_FEEDBACK_MESSAGE_MAX * 0.9 && 'text-warning',
                )}
                aria-live="polite"
              >
                {t('dialog.counter', { count: message.length, max: PRODUCT_FEEDBACK_MESSAGE_MAX })}
              </span>
            </div>
            <Textarea
              id={messageId}
              ref={textareaRef}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onBlur={() => trimmedLength > 0 && setShowLengthHint(true)}
              placeholder={t(`kinds.${kind}.placeholder`)}
              maxLength={PRODUCT_FEEDBACK_MESSAGE_MAX}
              disabled={sending}
              aria-invalid={showLengthHint && tooShort}
              aria-describedby={`${messageId}-hint`}
              className="max-h-[40dvh] min-h-32"
              data-testid="feedback-message"
            />
            {showLengthHint && tooShort ? (
              <FieldError id={`${messageId}-hint`}>{t('dialog.tooShort', { min: PRODUCT_FEEDBACK_MESSAGE_MIN })}</FieldError>
            ) : (
              <FieldDescription id={`${messageId}-hint`} className="pointer-coarse:hidden flex items-center gap-1.5">
                <KbdGroup>
                  <Kbd>{mod}</Kbd>
                  <Kbd>↵</Kbd>
                </KbdGroup>
                {t('dialog.shortcut')}
              </FieldDescription>
            )}
          </Field>

          <CapturedContext pagePath={captured.pagePath} context={captured.context} />

          <div className="flex items-start gap-2.5">
            <Checkbox
              id={contactId}
              checked={allowContact}
              onCheckedChange={(checked) => setAllowContact(checked === true)}
              disabled={sending}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={contactId} className="touch-target text-sm font-normal">
                {t('dialog.allowContact')}
              </Label>
              {userEmail && allowContact && (
                <span className="text-muted-foreground text-xs">{t('dialog.allowContactHint', { email: userEmail })}</span>
              )}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm font-medium">
              {error}
            </p>
          )}
        </div>
      </ScrollArea>
      {/* The actions stay at the pane's foot while the fields scroll, clear of
          the home indicator, or of nothing once the keyboard covers it. */}
      <div className="flex justify-end gap-2 border-t px-4 pt-3 pb-[max(0.75rem,var(--overlay-inset-bottom,env(safe-area-inset-bottom)))]">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={sending}>
          {t('dialog.cancel')}
        </Button>
        <Button type="submit" disabled={sending} data-testid="feedback-send">
          {sending && <Spinner className="size-4" />}
          {sending ? t('dialog.sending') : t('dialog.send')}
        </Button>
      </div>
    </form>
  )
}

function CapturedContext({ pagePath, context }: ReturnType<typeof captureFeedbackContext>): JSX.Element {
  const t = useTranslations(feedbackCopy)
  const rows: Array<[string, string | undefined | null]> = [
    [t('dialog.context.page'), pagePath],
    [t('dialog.context.browser'), context.userAgent],
    [t('dialog.context.screen'), context.viewport],
  ]
  return (
    <Collapsible className="bg-muted/40 rounded-lg border">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-medium">
        {t('dialog.context.summary')}
        <ChevronDown
          aria-hidden
          className="size-3.5 transition-transform duration-quick group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 pb-3 text-xs">
          {rows.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-foreground min-w-0 break-words">{value || t('dialog.context.none')}</dd>
            </React.Fragment>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  )
}
