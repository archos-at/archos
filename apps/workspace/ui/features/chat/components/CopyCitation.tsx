'use client'

import { type FC, type ReactNode } from 'react'
import { Check, Copy, Quote } from 'lucide-react'
import { toast } from 'sonner'
import { AnimatePresence, motion, useIconSwapTransition } from '@/components/motion'
import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { PRESSABLE } from '@/components/ui/press'
import { SectionLabel } from '@/components/ui/section-label'
import { useTransientFlag } from '@/hooks/use-transient-flag'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemText,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CITATION_FORMATS, renderCitations, type CitationFormat } from '../lib/citation-export'
import { toTechnicalText, toQuoteList } from '../lib/source-citation'
import type { CitationRef } from '../lib/citations'
import { useCitationStyles } from '../hooks/use-citation-styles'

const copyText = async (text: string, onDone: () => void, failedMessage: string): Promise<void> => {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    onDone()
  } catch {
    toast.error(failedMessage)
  }
}

export const COPY_ACTION_CLASSES = cn(
  'inline-flex shrink-0 items-center gap-1 rounded-control px-1.5 py-0.5 text-xs font-medium outline-none',
  'text-muted-foreground hover:text-foreground pointer-coarse:min-h-11',
  PRESSABLE,
  FOCUS_RING
)

export const CopyActionFace: FC<{
  copied: boolean
  icon: ReactNode
  label: string
  copiedLabel: string
}> = ({ copied, icon, label, copiedLabel }) => {
  const swap = useIconSwapTransition()
  return (
    <>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? 'check' : 'idle'}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1, transition: swap.enter }}
          exit={{ opacity: 0, scale: 0.6, transition: swap.exit }}
          className="inline-flex"
          aria-hidden="true"
        >
          {copied ? <Check aria-hidden="true" className="size-3" /> : icon}
        </motion.span>
      </AnimatePresence>
      <span className="grid">
        <span
          aria-hidden={copied || undefined}
          className={cn(
            'duration-quick col-start-1 row-start-1 transition-opacity ease-out motion-reduce:transition-none',
            copied && 'opacity-0'
          )}
        >
          {label}
        </span>
        <span
          aria-hidden={!copied || undefined}
          className={cn(
            'duration-quick col-start-1 row-start-1 transition-opacity ease-out motion-reduce:transition-none',
            !copied && 'opacity-0'
          )}
        >
          {copiedLabel}
        </span>
      </span>
    </>
  )
}

export const CopiedAnnouncement: FC<{ copied: boolean }> = ({ copied }) => {
  const t = useTranslations(chatCopy)
  return (
    <span role="status" className="sr-only">
      {copied ? t('answerSources.copied') : ''}
    </span>
  )
}

export const CopySourceCitationButton: FC<{ citation: CitationRef }> = ({ citation }) => {
  const t = useTranslations(chatCopy)
  const styles = useCitationStyles()
  const [copied, flashCopied] = useTransientFlag()

  const handleCopy = async (): Promise<void> => {
    await copyText(
      citation.locus?.snippet
        ? toQuoteList([citation], new Date(), styles)
        : toTechnicalText(citation, new Date(), styles),
      flashCopied,
      t('answerSources.copyFailed')
    )
  }

  return (
    <>
      <button data-attr="chat-copy"
        type="button"
        onClick={() => void handleCopy()}
        aria-label={t('answerSources.copyCitationAria', { label: citation.document.title })}
        className={COPY_ACTION_CLASSES}
      >
        <CopyActionFace
          copied={copied}
          icon={<Copy aria-hidden="true" className="size-3" />}
          label={t('answerSources.copyCitation')}
          copiedLabel={t('answerSources.copied')}
        />
      </button>
      <CopiedAnnouncement copied={copied} />
    </>
  )
}

export const CopyCitationsMenu: FC<{ citations: CitationRef[] }> = ({ citations }) => {
  const t = useTranslations(chatCopy)
  const swap = useIconSwapTransition()
  const styles = useCitationStyles()
  const [copied, flashCopied] = useTransientFlag()

  const handleCopy = async (format: CitationFormat): Promise<void> => {
    let text: string
    try {
      text = await renderCitations(citations, format, new Date(), styles)
    } catch {
      toast.error(t('answerSources.copyFailed'))
      return
    }
    await copyText(text, flashCopied, t('answerSources.copyFailed'))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* The label stays „Alle zitieren": the receipt is the icon's check
            and the announcement, because the copy happened in a menu that has
            already closed and the trigger is what the eye returns to. */}
        <button type="button" className={COPY_ACTION_CLASSES}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={copied ? 'check' : 'quote'}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1, transition: swap.enter }}
              exit={{ opacity: 0, scale: 0.6, transition: swap.exit }}
              className="inline-flex"
              aria-hidden="true"
            >
              {copied ? (
                <Check aria-hidden="true" className="size-3" />
              ) : (
                <Quote aria-hidden="true" className="size-3" />
              )}
            </motion.span>
          </AnimatePresence>
          {t('answerSources.citeAll')}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <SectionLabel>{t('answerSources.citeAsLabel')}</SectionLabel>
        </DropdownMenuLabel>
        {CITATION_FORMATS.map((format) => (
          <DropdownMenuItem key={format} onSelect={() => void handleCopy(format)}>
            <DropdownMenuItemText
              title={t(`answerSources.formats.${format}.label`)}
              hint={t(`answerSources.formats.${format}.hint`)}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
      <CopiedAnnouncement copied={copied} />
    </DropdownMenu>
  )
}
