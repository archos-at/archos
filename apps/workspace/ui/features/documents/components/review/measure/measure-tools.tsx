'use client'

import type { JSX } from 'react'
import { Pentagon, Ruler, Waypoints, type LucideIcon } from 'lucide-react'
import { ToolbarDivider, ToolbarIconButton } from '@/components/ui/floating-toolbar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import type { SheetTape, TapeTool } from '../../../hooks/use-sheet-tape'

const TAPE_TOOL_ICONS: Array<{ tool: TapeTool; icon: LucideIcon }> = [
  { tool: 'distance', icon: Ruler },
  { tool: 'path', icon: Waypoints },
  { tool: 'area', icon: Pentagon },
]

/**
 * The tape's three tools, beside the review's own on the palette: distance,
 * path, area. Offered only where the tape is (`tape.available`: a PDF, in an
 * organization that holds measuring on drawings); otherwise nothing is drawn.
 * The tool in hand is filled in ink like the review's, and picked again it is
 * put down.
 */
export function MeasureTools({
  tape,
  variant = 'icons',
}: {
  tape: Pick<SheetTape, 'available' | 'tool' | 'take'>
  /** `touch`: a word under every glyph, since a finger has no tooltip. */
  variant?: 'icons' | 'intro' | 'touch'
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  if (!tape.available) return null
  return (
    <span role="group" aria-label={t('review.measure.toolsLabel')} data-testid="measure-tools" className="contents">
      <ToolbarDivider />
      {TAPE_TOOL_ICONS.map(({ tool, icon: Icon }) => {
        const pressed = tape.tool === tool
        const name = t(`review.measure.tools.${tool}`)
        const button = (
          <ToolbarIconButton
            data-testid={`measure-tool-${tool}`}
            aria-pressed={pressed}
            aria-label={name}
            onClick={() => tape.take(pressed ? null : tool)}
            className={cn(
              'aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:text-background',
              variant === 'touch' && 'h-12 w-14 flex-col gap-0.5 pointer-coarse:size-auto pointer-coarse:h-12 pointer-coarse:w-14'
            )}
          >
            <Icon aria-hidden />
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
              {name} · {t(`review.measure.hint.${tool}`)}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </span>
  )
}
