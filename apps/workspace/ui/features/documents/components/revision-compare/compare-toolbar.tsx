'use client'

import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Columns2, Layers, Minus, MoveHorizontal, Plus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { isFitZoom, MAX_ZOOM, MIN_ZOOM } from './lib/pages'
import { COMPARE_MODES, type CompareMode } from './types'

const MODE_ICONS = { side: Columns2, overlay: Layers, swipe: MoveHorizontal } as const
const MODE_LABEL_KEYS = {
  side: 'compare.modeSide',
  overlay: 'compare.modeOverlay',
  swipe: 'compare.modeSwipe',
} as const

function Hinted({ hint, keys, children }: { hint: string; keys?: string; children: ReactNode }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {hint}
        {keys && <Kbd>{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

export function ModeSwitch({ mode, onMode }: { mode: CompareMode; onMode: (mode: CompareMode) => void }): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <ToggleGroup
      type="single"
      segmented
      rovingFocus={false}
      size="sm"
      value={mode}
      onValueChange={(value) => {
        if (COMPARE_MODES.includes(value as CompareMode)) onMode(value as CompareMode)
      }}
      aria-label={t('compare.viewMode')}
    >
      {COMPARE_MODES.map((entry, index) => {
        const Icon = MODE_ICONS[entry]
        return (
          <ToggleGroupItem key={entry} value={entry} data-testid={`mode-${entry}`} aria-keyshortcuts={String(index + 1)}>
            {/* Words on a phone, on its side too, where the three icons cost
                the toolbar its single row. */}
            <Icon aria-hidden className="max-sm:hidden phone:hidden" />
            <span className="max-sm:text-xs">{t(MODE_LABEL_KEYS[entry])}</span>
            <Kbd className="max-xl:hidden pointer-coarse:hidden" aria-hidden>
              {index + 1}
            </Kbd>
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}

export function PageNav({ current, count, onPage }: { current: number; count: number; onPage: (page: number) => void }): JSX.Element {
  const t = useTranslations(filesCopy)
  const [draft, setDraft] = useState(String(current))
  const [shown, setShown] = useState(current)
  if (shown !== current) {
    setShown(current)
    setDraft(String(current))
  }
  const commit = (): void => {
    const next = Number.parseInt(draft, 10)
    if (Number.isFinite(next)) onPage(next)
    else setDraft(String(current))
  }
  return (
    <nav className="flex items-center gap-1" aria-label={t('compare.pageNavigation')}>
      <Hinted hint={t('compare.previousPage')} keys="←">
        <Button variant="ghost" size="icon" aria-label={t('compare.previousPage')} disabled={current <= 1} onClick={() => onPage(current - 1)}>
          <ChevronLeft />
        </Button>
      </Hinted>
      <label className="flex items-center gap-1.5 text-sm whitespace-nowrap tabular-nums">
        <span className="sr-only">{t('compare.pageInput', { m: count })}</span>
        <Input
          type="text"
          inputMode="numeric"
          enterKeyHint="go"
          autoComplete="off"
          value={draft}
          data-testid="compare-page-input"
          onChange={(event) => setDraft(event.target.value.replace(/\D/g, ''))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          }}
          className="h-8 w-11 rounded-control px-1 text-center tabular-nums"
        />
        <span aria-hidden>{t('compare.pageOfTotal', { m: count })}</span>
      </label>
      <span className="sr-only" data-testid="compare-page-of" aria-live="polite">
        {t('compare.pageOf', { n: current, m: count })}
      </span>
      <Hinted hint={t('compare.nextPage')} keys="→">
        <Button variant="ghost" size="icon" aria-label={t('compare.nextPage')} disabled={current >= count} onClick={() => onPage(current + 1)}>
          <ChevronRight />
        </Button>
      </Hinted>
    </nav>
  )
}

export function ZoomControl({
  zoom,
  disabled,
  onStep,
  onFit,
}: {
  zoom: number
  disabled: boolean
  onStep: (direction: 1 | -1) => void
  onFit: () => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const fit = isFitZoom(zoom)
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('compare.zoomLabel')}>
      <Button variant="ghost" size="icon" aria-label={t('compare.zoomOut')} disabled={disabled || zoom <= MIN_ZOOM} onClick={() => onStep(-1)}>
        <Minus />
      </Button>
      <Hinted hint={t('compare.zoomHint')}>
        <Button
          variant="ghost"
          size="sm"
          data-testid="compare-zoom"
          disabled={disabled}
          aria-label={fit ? t('compare.zoomFitActive') : t('compare.zoomFitAction', { percent: Math.round(zoom * 100) })}
          onClick={onFit}
          className="min-w-[5.5rem] px-2 tabular-nums"
        >
          {fit ? t('compare.zoomFit') : t('compare.zoomPercent', { percent: Math.round(zoom * 100) })}
        </Button>
      </Hinted>
      <Button variant="ghost" size="icon" aria-label={t('compare.zoomIn')} disabled={disabled || zoom >= MAX_ZOOM} onClick={() => onStep(1)}>
        <Plus />
      </Button>
    </div>
  )
}

export type MarkState =
  | { kind: 'ready'; page: number }
  | { kind: 'loading'; page: number }
  | { kind: 'done'; page: number }
  | { kind: 'missing'; page: number }

export function MarkButton({ state, onMark, className }: { state: MarkState; onMark: () => void; className?: string }): JSX.Element {
  const t = useTranslations(filesCopy)
  const { page } = state
  const label =
    state.kind === 'loading'
      ? t('compare.markingPage', { page })
      : state.kind === 'done'
        ? t('compare.markedPage', { page })
        : state.kind === 'missing'
          ? t('compare.markPageMissing', { page })
          : t('compare.markPage', { page })
  return (
    <Button
      variant="secondary"
      size="sm"
      className={className}
      loading={state.kind === 'loading'}
      disabled={state.kind === 'done' || state.kind === 'missing'}
      data-testid="compare-mark"
      onClick={onMark}
    >
      {state.kind === 'done' ? <Check aria-hidden /> : <Sparkles aria-hidden />}
      {label}
    </Button>
  )
}
