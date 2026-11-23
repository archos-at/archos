'use client'

import type { JSX } from 'react'
import { MessageSquarePlus, MousePointer2, Sparkles, Speech, SquareDashed, X, type LucideIcon } from 'lucide-react'
import { ToolbarIconButton } from '@/components/ui/floating-toolbar'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import type { DocumentReview as ReviewState, ReviewTool } from '../../../hooks/use-document-review'
import { toolOffered } from '../../../lib/offered-tools'

type PaletteTool = ReviewTool | 'chat'

const TOOLS: Array<{ tool: PaletteTool; key: string; icon: LucideIcon }> = [
  { tool: 'select', key: 'V', icon: MousePointer2 },
  { tool: 'point', key: 'C', icon: MessageSquarePlus },
  { tool: 'region', key: 'R', icon: SquareDashed },
  { tool: 'ask', key: 'P', icon: Sparkles },
  { tool: 'chat', key: '/', icon: Speech },
]

export function ReviewTools({
  review,
  chatOpen,
  onChat,
  variant,
  onFold,
  onAim,
}: {
  review: ReviewState
  chatOpen: boolean
  onChat: () => void
  variant: 'icons' | 'intro' | 'touch'
  onFold?: () => void
  onAim?: () => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const offered = TOOLS.filter(({ tool }) => tool === 'chat' || toolOffered(tool, review))
  return (
    <div role="group" aria-label={t('review.toolsLabel')} data-testid="review-tools" data-variant={variant} className="flex items-center gap-0.5">
      {offered.map(({ tool, key, icon: Icon }) => {
        const pressed = tool === 'chat' ? chatOpen : review.tool === tool
        const name = tool === 'chat' ? t('review.chatOpen') : t(`review.tools.${tool}`)
        const button = (
          <ToolbarIconButton
            data-testid={`review-tool-${tool}`}
            aria-pressed={pressed}
            aria-keyshortcuts={key}
            aria-label={name}
            onClick={(event) => {
              if (tool === 'chat') return onChat()
              review.setTool(pressed ? 'select' : tool)
              if (!pressed && tool !== 'select' && event.detail === 0) onAim?.()
            }}
            className={cn(
              'aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:text-background',
              variant === 'intro' && 'w-auto gap-1.5 px-2 text-xs font-medium @max-5xl:w-7 @max-5xl:px-0',
              variant === 'touch' && 'h-12 w-14 flex-col gap-0.5 pointer-coarse:size-auto pointer-coarse:h-12 pointer-coarse:w-14'
            )}
          >
            <Icon aria-hidden />
            {variant === 'intro' && (
              <>
                {/* The short name: the pill also carries the viewer's own controls. */}
                <span className="@max-5xl:sr-only">{t(`review.toolsShort.${tool}`)}</span>
                <Kbd className="h-4 min-w-4 px-1 text-[10px] @max-5xl:hidden">{key}</Kbd>
              </>
            )}
            {variant === 'touch' && <span className="text-[10px] leading-3 font-medium">{t(`review.toolsShort.${tool}`)}</span>}
          </ToolbarIconButton>
        )
        if (variant === 'touch') return <span key={tool} className="contents">{button}</span>
        return (
          <Tooltip key={tool}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="top">
              {name} <Kbd className="ml-1">{key}</Kbd>
            </TooltipContent>
          </Tooltip>
        )
      })}
      {variant === 'intro' && onFold && (
        <ToolbarIconButton
          aria-label={t('review.toolsIntroFold')}
          title={t('review.toolsIntroFold')}
          data-testid="review-tools-fold"
          className="@max-5xl:hidden"
          onClick={onFold}
        >
          <X aria-hidden />
        </ToolbarIconButton>
      )}
    </div>
  )
}
