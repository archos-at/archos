'use client'

import { useEffect, useState } from 'react'

import { I18nProvider } from '@/i18n'
import { ShortcutsCheatsheet } from '@/components/shell/shortcuts-cheatsheet'
import { CommandPalette } from '@/components/shell/command-palette'

type Variant = 'default' | 'minimal' | 'palette'

const VARIANTS: readonly Variant[] = ['minimal', 'palette']

const readVariant = (): Variant => {
  if (typeof window === 'undefined') return 'default'
  const value = new URLSearchParams(window.location.search).get('variant') as Variant | null
  return value && VARIANTS.includes(value) ? value : 'default'
}

export default function ShortcutsPreviewPage() {
  const [variant, setVariant] = useState<Variant>('default')
  useEffect(() => setVariant(readVariant()), [])

  const everything = variant === 'default'

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main className="min-h-dvh bg-background px-4 py-10" data-testid="shortcuts-preview">
        <h1 className="mx-auto mb-6 max-w-2xl font-mono text-xs text-muted-foreground">
          /dev/shortcuts — Tastaturkürzel ({variant})
        </h1>
        {variant === 'palette' ? (
          <CommandPalette
            open
            onOpenChange={() => {}}
            authRequired
            canViewOrganization
            showKnowledge
            showSkills
            canAccessOfficeShelf
          />
        ) : (
        <ShortcutsCheatsheet
          open
          onOpenChange={() => {}}
          canViewOrganization={everything}
          showKnowledge={everything}
          showSkills={everything}
          canAccessOfficeShelf={everything}
          canCollaborate={everything}
          canAccessInbox={everything}
          inboundMail={everything}
        />
        )}
      </main>
    </I18nProvider>
  )
}
