'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import { Command, CommandList } from '@/components/ui/command'
import { useTranslations } from '@/i18n'
import { searchCopy } from '@/i18n/namespaces/search'
import type { SearchHit } from '@/lib/search/search-wire'
import type { PaletteSearch } from '../hooks/use-palette-search'
import { PaletteSearchResults, paletteHits, paletteHitValue } from './palette-search'
import { PaletteStatusLine } from './palette-atoms'
import { COMPOSER_COMMAND_CLASS, ComposerPickerFrame } from './search-atoms'

export const COMPOSER_PICKER_HITS = 6

export interface ComposerSearchPickerHandle {
  move: (delta: number) => void
  selectActive: () => boolean
}

export interface ComposerSearchPickerAria {
  listboxId: string | null
  activeOptionId: string | null
}

export interface ComposerSearchPickerProps {
  query: string
  search: PaletteSearch
  onPick: (hit: SearchHit) => void
  onAriaChange?: (aria: ComposerSearchPickerAria) => void
}

export const ComposerSearchPicker = forwardRef<ComposerSearchPickerHandle, ComposerSearchPickerProps>(function ComposerSearchPicker(
  { query, search, onPick, onAriaChange },
  ref
) {
  const t = useTranslations(searchCopy, 'composerPicker')
  const rootRef = useRef<HTMLDivElement>(null)
  const hits = useMemo(() => paletteHits(search.response, COMPOSER_PICKER_HITS), [search.response])
  const [activeIndex, setActiveIndex] = useState(0)
  const hitsKey = hits.map((hit) => `${hit.kind}:${hit.id}`).join('|')
  useEffect(() => {
    setActiveIndex(0)
  }, [hitsKey])
  const active = hits[Math.min(activeIndex, Math.max(hits.length - 1, 0))] ?? null

  useImperativeHandle(
    ref,
    () => ({
      move: (delta: number) => {
        if (hits.length === 0) return
        setActiveIndex((current) => {
          const next = (current + delta) % hits.length
          return next < 0 ? next + hits.length : next
        })
      },
      selectActive: () => {
        if (!active) return false
        onPick(active)
        return true
      },
    }),
    [active, hits.length, onPick]
  )

  const reported = useRef<ComposerSearchPickerAria>({ listboxId: null, activeOptionId: null })
  useEffect(() => {
    if (!onAriaChange) return
    const root = rootRef.current
    const next: ComposerSearchPickerAria = {
      listboxId: root?.querySelector('[cmdk-list]')?.id ?? null,
      activeOptionId: root?.querySelector('[cmdk-item][aria-selected="true"]')?.id ?? null,
    }
    if (next.listboxId === reported.current.listboxId && next.activeOptionId === reported.current.activeOptionId) return
    reported.current = next
    onAriaChange(next)
  })

  const words = query.trim()
  return (
    <div ref={rootRef}>
      <ComposerPickerFrame hints={{ move: t('hints.move'), open: t('hints.open'), close: t('hints.close') }} testId="composer-search-picker">
        <Command
          shouldFilter={false}
          loop
          label={t('label')}
          value={active ? paletteHitValue(active) : ''}
          onValueChange={(value) => {
            const index = hits.findIndex((hit) => paletteHitValue(hit) === value)
            if (index >= 0) setActiveIndex(index)
          }}
          className={COMPOSER_COMMAND_CLASS}
        >
          <CommandList label={t('label')} className="max-h-none p-1.5">
            {words === '' ? (
              <PaletteStatusLine testId="composer-search-hint">{t('hint')}</PaletteStatusLine>
            ) : (
              <PaletteSearchResults
                text={query}
                answered={search.answered}
                response={search.response}
                loading={search.loading}
                failed={search.failed}
                onOpen={() => {}}
                onPick={onPick}
                allHref={null}
                perKind={COMPOSER_PICKER_HITS}
              />
            )}
          </CommandList>
        </Command>
      </ComposerPickerFrame>
    </div>
  )
})
