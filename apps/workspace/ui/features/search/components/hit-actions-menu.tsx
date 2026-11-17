'use client'

import type { JSX, ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { MoreHorizontal } from 'lucide-react'

import { ActionMenu } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { searchCopy } from '@/i18n/namespaces/search'
import type { DocumentHit } from '@/lib/search/search-wire'
import { useDocumentHitActions } from '../hooks/use-document-hit-actions'

export interface HitMenuState {
  openKey: string | null
  onOpenKeyChange: (key: string | null) => void
}

const HitMenuContext = createContext<HitMenuState | null>(null)

export function HitMenuProvider({ value, children }: { value: HitMenuState; children: ReactNode }): JSX.Element {
  return <HitMenuContext.Provider value={value}>{children}</HitMenuContext.Provider>
}

export function useHitMenus(): boolean {
  return useContext(HitMenuContext) !== null
}

export function DocumentHitMenu({ hit }: { hit: DocumentHit }): JSX.Element | null {
  const state = useContext(HitMenuContext)
  const t = useTranslations(searchCopy, 'hitActions')
  const entries = useDocumentHitActions(hit)
  if (!state) return null
  const key = `document:${hit.id}`
  return (
    <ActionMenu
      mode="dropdown"
      entries={entries}
      open={state.openKey === key}
      onOpenChange={(open) => state.onOpenKeyChange(open ? key : null)}
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={t('label', { name: hit.title ?? hit.name })}
          title={t('menuLabel')}
          data-testid={`search-hit-actions-${hit.id}`}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      }
    />
  )
}
