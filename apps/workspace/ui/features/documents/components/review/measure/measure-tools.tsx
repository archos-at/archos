'use client'

import { useEffect, type JSX } from 'react'
import { Pentagon, RulerDimensionLine, Waypoints, type LucideIcon } from 'lucide-react'
import { ToolbarDivider, ToolbarIconButton } from '@/components/ui/floating-toolbar'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import type { SheetTape, TapeTool } from '../../../hooks/use-sheet-tape'

/**
 * The tape's tools with their keys. D, W and F are free on the review's palette (V, C, R, P, M and / are its
 * own; J, K and E walk and decide marks): distance, way, floor area, and in German Weg and Fläche.
 */
export const TAPE_TOOL_KEYS: Array<{ tool: TapeTool; key: string; icon: LucideIcon }> = [
  // A dimension line, not the calibrate tool's ruler: the two sit side by side on the palette.
  { tool: 'distance', key: 'D', icon: RulerDimensionLine },
  { tool: 'path', key: 'W', icon: Waypoints },
  { tool: 'area', key: 'F', icon: Pentagon },
]

/** What the tape tool in hand does next, for the line at the top of the canvas; null when none is in hand. */
export function tapeHint(t: (key: string) => string, tape: Pick<SheetTape, 'tool'>, touch: boolean): string | null {
  return tape.tool ? t(`review.measure.${touch ? 'hintTouch' : 'hint'}.${tape.tool}`) : null
}

/** Whether a key press belongs to a field the reader is typing in. */
const typing = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/**
 * The tape's three tools, beside the review's own on the palette: distance,
 * path, area. Offered only where the tape is (`tape.available`); otherwise
 * nothing is drawn and no key is taken. The tool in hand is filled in ink like
 * the review's, and picked again it is put down.
 */
export function MeasureTools({
  tape,
  variant = 'icons',
}: {
  tape: Pick<SheetTape, 'available' | 'tool' | 'take'>
  /** `intro`: every tool spelled out with its key. `touch`: a word under every glyph, since a finger has no tooltip. */
  variant?: 'icons' | 'intro' | 'touch'
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const { available, tool: inHand, take } = tape

  // The palette's keys, as the review's own tools have theirs. Only while the palette is there.
  useEffect(() => {
    if (!available) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
      const picked = TAPE_TOOL_KEYS.find(({ key }) => key.toLowerCase() === event.key.toLowerCase())
      if (picked) take(inHand === picked.tool ? null : picked.tool)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [available, inHand, take])

  if (!available) return null
  return (
    <span role="group" aria-label={t('review.measure.toolsLabel')} data-testid="measure-tools" className="contents">
      <ToolbarDivider />
      {TAPE_TOOL_KEYS.map(({ tool, key, icon: Icon }) => {
        const pressed = inHand === tool
        const name = t(`review.measure.tools.${tool}`)
        const button = (
          <ToolbarIconButton
            data-testid={`measure-tool-${tool}`}
            aria-pressed={pressed}
            aria-keyshortcuts={key}
            aria-label={name}
            onClick={() => take(pressed ? null : tool)}
            className={cn(
              'aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:text-background',
              variant === 'intro' && 'w-auto gap-1.5 px-2 text-xs font-medium @max-5xl:w-7 @max-5xl:px-0',
              variant === 'touch' && 'h-12 w-14 flex-col gap-0.5 pointer-coarse:size-auto pointer-coarse:h-12 pointer-coarse:w-14'
            )}
          >
            <Icon aria-hidden />
            {variant === 'intro' && (
              <>
                <span className="@max-5xl:sr-only">{t(`review.measure.toolsShort.${tool}`)}</span>
                <Kbd className="h-4 min-w-4 px-1 text-[10px] @max-5xl:hidden">{key}</Kbd>
              </>
            )}
            {variant === 'touch' && (
              <span className="text-[10px] leading-3 font-medium">{t(`review.measure.toolsShort.${tool}`)}</span>
            )}
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
    </span>
  )
}
