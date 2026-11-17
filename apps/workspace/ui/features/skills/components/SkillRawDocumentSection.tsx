'use client'

import { useCallback, useMemo, useState, type FC } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { useTranslations } from '@/i18n'
import { skillsCopy } from '@/i18n/namespaces/skills'
import { cn } from '@/lib/utils'
import { parseSkillDocument, type ParsedSkillDocument } from '../lib/skill-document'

export interface SkillRawDocumentSectionProps {
  document: string
  onApply: (parsed: ParsedSkillDocument) => void
  className?: string
}

export const SkillRawDocumentSection: FC<SkillRawDocumentSectionProps> = ({
  document,
  onApply,
  className,
}) => {
  const t = useTranslations(skillsCopy)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(document)

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) setDraft(document)
      setOpen(next)
    },
    [document],
  )

  const parsed = useMemo(() => parseSkillDocument(draft), [draft])
  const dirty = draft !== document

  const apply = useCallback(() => {
    if (!parsed.ok) return
    onApply(parsed.value)
    setOpen(false)
  }, [onApply, parsed])

  const status = !parsed.ok
    ? { tone: 'text-destructive', message: t(`editor.raw.errors.${parsed.error}`) }
    : parsed.value.ignoredKeys.length > 0
      ? {
          tone: 'text-warning-foreground',
          message: t('editor.raw.ignored', { keys: parsed.value.ignoredKeys.join(', ') }),
        }
      : dirty
        ? { tone: 'text-muted-foreground', message: t('editor.raw.ready') }
        : { tone: 'text-muted-foreground', message: t('editor.raw.unchanged') }

  return (
    <Collapsible
      open={open}
      onOpenChange={handleOpenChange}
      className={cn('border-border rounded-xl border', className)}
      data-testid="skill-raw-document"
    >
      <CollapsibleTrigger
        type="button"
        className="hover:bg-hover focus-visible:ring-ring/50 flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors duration-quick ease-out focus-visible:outline-none focus-visible:ring-2"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{t('editor.raw.heading')}</span>
          <span className="text-muted-foreground text-xs">{t('editor.raw.subtitle')}</span>
        </span>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform duration-quick ease-out motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="border-border border-t px-4 py-3 duration-base ease-out motion-reduce:animate-none">
        <Field>
          <FieldLabel htmlFor="skill-raw-document">{t('editor.raw.documentLabel')}</FieldLabel>
          <Textarea
            id="skill-raw-document"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            rows={18}
            className="font-mono text-xs leading-relaxed"
            aria-invalid={!parsed.ok || undefined}
          />
          {!parsed.ok && <FieldError>{status.message}</FieldError>}
        </Field>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
          {parsed.ok && (
            <p role="status" className={cn('min-w-0 flex-1 text-xs max-sm:basis-full', status.tone)}>
              {status.message}
            </p>
          )}
          <div className="ml-auto flex shrink-0 gap-2 max-sm:w-full max-sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDraft(document)}
              disabled={!dirty}
            >
              {t('editor.raw.reset')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={apply}
              disabled={!parsed.ok || !dirty}
            >
              {t('editor.raw.apply')}
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
