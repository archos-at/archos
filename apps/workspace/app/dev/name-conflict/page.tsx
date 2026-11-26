'use client'

import type { JSX } from 'react'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { NameConflictDialog } from '@/features/documents/components/name-conflict/name-conflict-dialog'
import type { ConflictAnswer, ConflictQuestion } from '@/features/documents/hooks/use-name-conflict-prompt'
import type { ConflictRow } from '@/features/documents/lib/name-conflict'

const LONG_PATH =
  '03_Einreichung_Baubehörde_Magistratsabteilung_37/Planunterlagen_Revision_2026-11/Grundrisse_und_Schnitte_Bauteil_Ost'

function row(path: string, existingName = path.split('/').pop()!): ConflictRow {
  const name = path.split('/').pop()!
  const dot = name.lastIndexOf('.')
  return {
    key: path,
    path,
    name,
    existingName,
    within: 'folder',
    choice: 'replace',
    keepBothAs: dot > 0 ? `${name.slice(0, dot)} 2${name.slice(dot)}` : `${name} 2`,
  }
}

function question(variant: string): ConflictQuestion {
  if (variant === 'move') {
    return {
      operation: 'move',
      folderName: 'Statik',
      rows: [{ ...row('Statischer_Nachweis_Decke_über_EG.pdf'), choice: 'keep_both' }],
    }
  }
  if (variant === 'move-many') {
    return {
      operation: 'move',
      folderName: 'Pläne',
      rows: ['EG.pdf', 'OG.pdf', 'Schnitt_A-A.pdf', 'Ansicht_Nord.pdf'].map((name) => ({ ...row(name), choice: 'keep_both' })),
    }
  }
  if (variant === 'long') {
    return {
      operation: 'upload',
      folderName: '',
      rows: Array.from({ length: 120 }, (_, i) =>
        row(
          `${LONG_PATH}/EG-${100 + i}_Grundriss_Erdgeschoss_Bauteil_Ost_Index_C_2026-11-02.pdf`,
          i % 4 === 0 ? `Grundriss EG ${100 + i}, Bauteil Ost (freigegeben)` : undefined
        )
      ),
    }
  }
  return {
    operation: 'upload',
    folderName: '',
    rows: [
      row('Wohnbau Nord/Pläne/EG.pdf'),
      row('Wohnbau Nord/Pläne/Deckblatt.pdf', 'Deckblatt Einreichung'),
      row('Wohnbau Nord/Statik/Nachweis.pdf'),
    ],
  }
}

function Preview(): JSX.Element {
  const variant = useSearchParams()?.get('variant') ?? 'upload'
  const [asked, setAsked] = useState<ConflictQuestion | null>(() => question(variant))
  const [answer, setAnswer] = useState<string | null>(null)
  const resolve = (choices: ConflictAnswer | null) => {
    setAsked(null)
    setAnswer(choices ? [...choices].map(([key, choice]) => `${key} → ${choice}`).join('\n') : 'abgebrochen')
  }
  return (
    <main className="min-h-dvh bg-background px-4 py-10" data-testid="name-conflict-preview">
      <h1 className="mx-auto mb-6 max-w-lg font-mono text-xs text-muted-foreground">/dev/name-conflict — {variant}</h1>
      <NameConflictDialog prompt={{ question: asked, resolve }} />
      {answer && (
        <pre className="mx-auto max-w-lg whitespace-pre-wrap font-mono text-xs" data-testid="name-conflict-preview-answer">
          {answer}
        </pre>
      )}
    </main>
  )
}

export default function NameConflictPreviewPage(): JSX.Element {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  )
}
