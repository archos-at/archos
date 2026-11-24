'use client'

import type { JSX } from 'react'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslations } from '@/i18n'
import { searchCopy } from '@/i18n/namespaces/search'
import type { SearchKind } from '@/lib/search/search-wire'
import { PALETTE_HITS_PER_KIND } from '../hooks/use-palette-search'

export const PALETTE_KINDS = ['all', 'files', 'chats', 'projects'] as const
export type PaletteKind = (typeof PALETTE_KINDS)[number]

export const PALETTE_ONE_KIND_HITS = 8

const SEARCHED: Record<PaletteKind, readonly SearchKind[] | undefined> = {
  all: undefined,
  files: ['document', 'annotation', 'folder'],
  chats: ['conversation'],
  projects: ['project'],
}

export function paletteKindQuery(kind: PaletteKind): { kinds?: readonly SearchKind[]; limit: number } {
  const kinds = SEARCHED[kind]
  return { kinds, limit: kinds?.length === 1 ? PALETTE_ONE_KIND_HITS : PALETTE_HITS_PER_KIND }
}

const isPaletteKind = (value: string): value is PaletteKind => PALETTE_KINDS.some((kind) => kind === value)

export function PaletteKinds({ value, onChange }: { value: PaletteKind; onChange: (kind: PaletteKind) => void }): JSX.Element {
  const t = useTranslations(searchCopy)
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={value}
      onValueChange={(next: string) => {
        if (isPaletteKind(next)) onChange(next)
      }}
      aria-label={t('kindFilter.label')}
      className="flex-nowrap gap-0.5"
      data-testid="palette-kinds"
    >
      {PALETTE_KINDS.map((kind) => (
        <ToggleGroupItem
          key={kind}
          value={kind}
          className="rounded-full px-3 data-[state=on]:bg-selected data-[state=on]:font-medium pointer-coarse:min-h-11"
          data-testid={`palette-kind-${kind}`}
        >
          {t(`palette.kinds.${kind}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
