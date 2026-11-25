'use client'

import { useCallback, useMemo, useState, useSyncExternalStore, type FC } from 'react'
import { Check, Copy, FileDown, Share } from 'lucide-react'
import { toast } from 'sonner'
import { AnimatePresence, motion, useIconSwapTransition } from '@/components/motion'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { PRESSABLE } from '@/components/ui/press'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useTransientFlag } from '@/hooks/use-transient-flag'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { copyMarkdownToClipboard } from '@/shared/utils/clipboard-rich'
import { downloadFetched } from '@/lib/browser-download'
import { capturePosthog } from '@/lib/analytics/posthog'
import { useAnswerData } from '@/shared/components/MarkdownRenderer/answer-block-context'
import type { StripOptions } from '@/lib/text/answer-directives'
import {
  answerMarkdown,
  answerMarkdownWithSources,
  hasCopyableSources,
} from '../lib/answer-markdown'
import { answerDocuments, type CitationRef, type CitedDocument } from '../lib/citations'
import { answerShareUrl, canShareNatively, shareAnswer } from '../lib/share-answer'
import { CitationFormatItems, CopiedAnnouncement, useCopyCitations } from './CopyCitation'

export interface AnswerActionsProps {
  content: string
  body: string
  documents: CitedDocument[]
  conversationId?: string | null
  messageId?: string
  className?: string
  pending?: boolean
}

type Copied = 'plain' | 'withSources' | null

const actionButton = cn(
  'inline-flex size-6 items-center justify-center rounded-control pointer-coarse:size-11',
  'text-muted-foreground',
  PRESSABLE,
  'hover:bg-hover hover:text-foreground',
  FOCUS_RING
)

const noopSubscribe = (): (() => void) => () => {}

function useNativeShare(): boolean {
  const hasShare = useSyncExternalStore(noopSubscribe, () => canShareNatively(), () => false)
  const touch = useMediaQuery('(pointer: coarse)')
  return hasShare && touch
}

export const AnswerActions: FC<AnswerActionsProps> = ({
  content,
  body,
  documents,
  conversationId,
  messageId,
  className,
  pending = false,
}) => {
  const t = useTranslations(chatCopy)
  const swap = useIconSwapTransition()
  const [copiedOn, raiseCopied] = useTransientFlag()
  const [copiedWhich, setCopiedWhich] = useState<Copied>(null)
  const copied = copiedOn ? copiedWhich : null
  const { project } = useAnswerData()
  const strip = useMemo(
    (): StripOptions => ({ projectValue: (key) => (project ? project(key).text : null) }),
    [project]
  )
  const [exporting, setExporting] = useState(false)

  const copy = useCallback(
    async (text: string, which: Exclude<Copied, null>): Promise<void> => {
      if (!text.trim()) return
      try {
        await copyMarkdownToClipboard(text)
        setCopiedWhich(which)
        raiseCopied()
      } catch {
        toast.error(t('answerActions.copyFailed'))
      }
    },
    [t, raiseCopied]
  )

  const handleDownloadDocx = useCallback(async (): Promise<void> => {
    if (!conversationId || !messageId || exporting) return
    setExporting(true)
    const result = await downloadFetched(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/export`,
      'piloti.docx'
    )
    setExporting(false)
    if (!result.saved) {
      toast.error(t('answerActions.downloadFailed'))
      return
    }
    capturePosthog('report_exported', { kind: 'answer', format: 'docx' })
  }, [conversationId, messageId, exporting, t])

  const handleCopyAnswer = useCallback((): void => {
    void copy(answerMarkdown(content, strip), 'plain')
  }, [copy, content, strip])

  const handleCopyWithSources = useCallback((): void => {
    void copy(
      answerMarkdownWithSources(body, documents, {
        heading: t('answerActions.sourcesHeading'),
        page: (page) => t('answerSources.page', { page }),
        pages: (pages) => t('answerSources.pages', { pages: pages.join(', ') }),
        untitled: t('answerActions.untitledSource'),
      }, strip),
      'withSources'
    )
  }, [copy, body, documents, t, strip])

  const withSources = hasCopyableSources(documents)
  const citationRefs = useMemo(
    (): CitationRef[] => answerDocuments(documents).map((document) => ({ document })),
    [documents]
  )
  const nativeShare = useNativeShare()

  const handleShare = useCallback(async (): Promise<void> => {
    const text = withSources
      ? answerMarkdownWithSources(body, documents, {
          heading: t('answerActions.sourcesHeading'),
          page: (page) => t('answerSources.page', { page }),
          pages: (pages) => t('answerSources.pages', { pages: pages.join(', ') }),
          untitled: t('answerActions.untitledSource'),
        }, strip)
      : answerMarkdown(content, strip)
    if (!text.trim()) return
    const outcome = await shareAnswer(
      {
        title: t('answerActions.shareTitle'),
        text,
        url: answerShareUrl(conversationId, window.location),
      },
      copyMarkdownToClipboard
    )
    if (outcome === 'copied') {
      setCopiedWhich(withSources ? 'withSources' : 'plain')
      raiseCopied()
    } else if (outcome === 'failed') {
      toast.error(t('answerActions.copyFailed'))
    }
  }, [withSources, body, documents, content, strip, t, conversationId, raiseCopied])
  const canExport = Boolean(conversationId && messageId)
  const showPlainCopy = !withSources
  const copyLabel = copied === 'plain' ? t('answerActions.copied') : t('answerActions.copy')
  const downloadLabel = t('answerActions.downloadDocx')
  const citations = useCopyCitations(citationRefs)
  const menuCopied = copied !== null || citations.copied
  const copyMenuLabel = menuCopied ? t('answerActions.copied') : t('answerActions.copyMenu')

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 transition-opacity duration-base ease-out motion-reduce:transition-none',
        pending && 'opacity-0',
        className
      )}
      inert={pending}
      aria-hidden={pending || undefined}
    >
      {showPlainCopy && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button data-attr="chat-copy-answer"
              type="button"
              onClick={handleCopyAnswer}
              aria-label={copyLabel}
              className={actionButton}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={copied === 'plain' ? 'check' : 'copy'}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1, transition: swap.enter }}
                  exit={{ opacity: 0, scale: 0.6, transition: swap.exit }}
                  className="inline-flex"
                  aria-hidden="true"
                >
                  {copied === 'plain' ? (
                    <Check className="size-3.5 pointer-coarse:size-4" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5 pointer-coarse:size-4" aria-hidden="true" />
                  )}
                </motion.span>
              </AnimatePresence>
            </button>
          </TooltipTrigger>
          <TooltipContent>{copyLabel}</TooltipContent>
        </Tooltip>
      )}
      {withSources && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  data-attr="chat-copy-menu"
                  type="button"
                  aria-label={copyMenuLabel}
                  className={actionButton}
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={menuCopied ? 'check' : 'copy'}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1, transition: swap.enter }}
                      exit={{ opacity: 0, scale: 0.6, transition: swap.exit }}
                      className="inline-flex"
                      aria-hidden="true"
                    >
                      {menuCopied ? (
                        <Check className="size-3.5 pointer-coarse:size-4" aria-hidden="true" />
                      ) : (
                        <Copy className="size-3.5 pointer-coarse:size-4" aria-hidden="true" />
                      )}
                    </motion.span>
                  </AnimatePresence>
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{copyMenuLabel}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem data-attr="chat-copy-with-sources" onSelect={handleCopyWithSources}>
              {t('answerActions.copyMenuWithSources')}
            </DropdownMenuItem>
            <DropdownMenuItem data-attr="chat-copy-answer" onSelect={handleCopyAnswer}>
              {t('answerActions.copyMenuPlain')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <CitationFormatItems onPick={(format) => void citations.copy(format)} />
          </DropdownMenuContent>
          <CopiedAnnouncement copied={menuCopied} />
        </DropdownMenu>
      )}
      {nativeShare && (
        <button data-attr="answer-share"
          type="button"
          onClick={() => void handleShare()}
          aria-label={t('answerActions.share')}
          data-testid="answer-share"
          className={actionButton}
        >
          <Share className="size-3.5 pointer-coarse:size-4" aria-hidden="true" />
        </button>
      )}
      {canExport && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button data-attr="chat-download-docx"
              type="button"
              onClick={() => void handleDownloadDocx()}
              disabled={exporting}
              aria-busy={exporting || undefined}
              aria-label={downloadLabel}
              className={cn(actionButton, exporting && 'cursor-progress opacity-50')}
            >
              <FileDown className="size-3.5 pointer-coarse:size-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{downloadLabel}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
