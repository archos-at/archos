'use client'

/**
 * The review's tools (V, C, R, P, „/“), as one row of buttons for a pill: the
 * viewer's own at the foot with a pointer, a palette above it on a touch
 * screen. A stage that owns its tools (a Skizze's canvas) shows none of these.
 */

import type { JSX } from 'react'
import { MessageSquarePlus, MousePointer2, Sparkles, Speech, SquareDashed, X, type LucideIcon } from 'lucide-react'
import { ToolbarIconButton } from '@/components/ui/floating-toolbar'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import type { DocumentReview as ReviewState, ReviewTool } from '../../hooks/use-document-review'

/** A tool on the palette: the review's own, or the cursor chat, which sets nothing. */
type PaletteTool = ReviewTool | 'chat'

const TOOLS: Array<{ tool: PaletteTool; key: string; icon: LucideIcon }> = [
  { tool: 'select', key: 'V', icon: MousePointer2 },
  { tool: 'point', key: 'C', icon: MessageSquarePlus },
  { tool: 'region', key: 'R', icon: SquareDashed },
  { tool: 'ask', key: 'P', icon: Sparkles },
  // A head speaking, not a bubble: the comment tool already is one, and this one keeps nothing.
  { tool: 'chat', key: '/', icon: Speech },
]

/** Where this browser keeps that it has seen the tools explained: the first review opens with them spelled out. */
export const TOOLS_INTRO_KEY = 'review.toolsIntroSeen'

/** Whether the tools were explained here before. Storage that cannot be read counts as seen: no intro on every open. */
export function toolsIntroSeen(): boolean {
  try {
    return window.localStorage.getItem(TOOLS_INTRO_KEY) === '1'
  } catch {
    return true
  }
}

export function rememberToolsIntro(): void {
  try {
    window.localStorage.setItem(TOOLS_INTRO_KEY, '1')
  } catch {
    // A private window: the intro shows again next time, which is harmless.
  }
}

/**
 * The tools, as one row of buttons for a pill. `icons`: glyphs with the name
 * and key in a tooltip, in the viewer's own pill. `intro`: the first review a
 * browser opens, every tool spelled out with its key, and a way to fold it.
 * `touch`: a label under every glyph, since a finger has no tooltip and no keys.
 */
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
  /** A mark tool was taken up from the keyboard: the crosshair sets the place. */
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
              review.setTool(tool)
              // `detail` is 0 for a click the keyboard made (Enter, Space).
              if (tool !== 'select' && event.detail === 0) onAim?.()
            }}
            className={cn(
              // The tool in hand is filled in ink: what the pointer will do is never a guess.
              'aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:text-background',
              // Spelled out where the stage is wide enough for the whole pill; under ~1000px of it the
              // tools fold to their glyphs, still named for a screen reader (the viewer's container).
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
        // A finger has no hover: its labels are under the glyphs. Spelled out, the
        // tools keep the tooltip too, for when a narrow stage folds them to glyphs.
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

/** Which tools a reader has: marks need the right to set them; Piloti needs a project to ask in. */
export const toolOffered = (tool: ReviewTool, review: ReviewState): boolean =>
  tool === 'select' || (tool === 'ask' ? review.piloti.available : review.canAnnotate)
