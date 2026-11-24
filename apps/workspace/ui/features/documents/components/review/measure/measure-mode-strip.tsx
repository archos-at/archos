'use client'

import type { JSX, ReactNode } from 'react'
import { Undo2, X } from 'lucide-react'
import {
  FloatingToolbar,
  ToolbarDivider,
  ToolbarIconButton,
  ToolbarTextButton,
} from '@/components/ui/floating-toolbar'
import { Kbd } from '@/components/ui/kbd'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { TAPE_MODES, type SheetTape, type TapeMode } from '../../../hooks/use-sheet-tape'

export const MODE_KEYS: Record<TapeMode, string> = { distance: 'D', path: 'W', area: 'F' }

export function MeasureModeStrip({
  tape,
  scale,
  onExit,
}: {
  tape: SheetTape
  scale: ReactNode
  onExit: () => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const placing = tape.phase === 'placing' && tape.points.length > 0
  const undoable = placing || tape.phase !== 'placing'
  return (
    <FloatingToolbar
      className="pointer-events-auto"
      data-testid="measure-mode-strip"
      aria-label={t('review.measure.label')}
    >
      <ToggleGroup
        type="single"
        segmented
        size="sm"
        value={tape.mode}
        aria-label={t('review.measure.modesLabel')}
        onValueChange={(value) => {
          if ((TAPE_MODES as readonly string[]).includes(value)) tape.setMode(value as TapeMode)
        }}
      >
        {TAPE_MODES.map((mode) => (
          <Tooltip key={mode}>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value={mode}
                aria-keyshortcuts={MODE_KEYS[mode]}
                data-testid={`measure-mode-${mode}`}
                className="h-7 px-2 text-xs pointer-coarse:h-11"
              >
                {t(`review.measure.modes.${mode}`)}
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-56">
              <span className="font-medium">{t(`review.measure.modes.${mode}`)}</span>{' '}
              <Kbd className="ml-1">{MODE_KEYS[mode]}</Kbd>
              <span className="block opacity-80">{t(`review.measure.modeHelp.${mode}`)}</span>
            </TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      <ToolbarIconButton
        aria-label={t('review.measure.undoPoint')}
        title={t('review.measure.undoPoint')}
        aria-keyshortcuts="Backspace"
        data-testid="measure-undo-point"
        disabled={!undoable || tape.phase === 'measuring'}
        onClick={tape.undo}
      >
        <Undo2 aria-hidden />
      </ToolbarIconButton>
      {tape.mode !== 'distance' && (
        <ToolbarTextButton
          disabled={!tape.canFinish}
          aria-keyshortcuts="Enter"
          data-testid="measure-finish"
          className="text-foreground font-medium"
          onClick={tape.finish}
        >
          {t('review.measure.finish')}
        </ToolbarTextButton>
      )}
      <ToolbarDivider />
      {scale}
      <ToolbarDivider />
      <ToolbarIconButton
        aria-label={t('review.measure.exit')}
        title={t('review.measure.exit')}
        data-testid="measure-exit"
        onClick={onExit}
      >
        <X aria-hidden />
      </ToolbarIconButton>
    </FloatingToolbar>
  )
}
