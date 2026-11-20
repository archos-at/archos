'use client'

// PROTOTYPE, not for merge: the upload menu and the norms place of the office library (concept for ticket 81).

import type { JSX } from 'react'
import identity from '@/shared/brand/identity.json'
import { ChevronRight, FileUp, Folder, FolderUp, Mail, MailPlus, Sparkles } from 'lucide-react'

export function UploadMenu({ mail }: { mail: boolean }): JSX.Element {
  const row = 'text-name flex h-9 items-center gap-2.5 rounded-control px-2.5 font-normal'
  const icon = 'text-muted-foreground size-4 shrink-0'
  return (
    <div className="bg-sheet shadow-md absolute right-0 top-full z-30 mt-1.5 w-72 rounded-[16px] p-1.5">
      <div className={`${row} bg-desk`}>
        <FileUp className={icon} aria-hidden />
        Dateien auswählen
      </div>
      <div className={row}>
        <FolderUp className={icon} aria-hidden />
        Ordner hochladen
      </div>
      {mail && (
        <>
          <div className="bg-desk mx-1 my-1.5 h-px" />
          <div className="text-muted-foreground text-meta px-2.5 pb-1 pt-1 font-medium">E-Mails</div>
          <div className={row}>
            <MailPlus className={icon} aria-hidden />
            Per E-Mail senden …
          </div>
          <div className={row}>
            <Mail className={icon} aria-hidden />
            Outlook-Archiv importieren …
          </div>
        </>
      )}
    </div>
  )
}

const TOPICS = [
  { name: 'Barrierefreiheit', count: 2 },
  { name: 'Brandschutz', count: 4 },
  { name: 'Kommentare', count: 1 },
  { name: 'Schallschutz', count: 2 },
]

export function NormsPlace(): JSX.Element {
  return (
    <>
      <p className="mx-8 mt-4 flex items-center gap-2 rounded-control bg-[#f6ecd6] px-3 py-2 text-[13px] text-[#8a5a00]">
        <Sparkles className="size-3.5 shrink-0" aria-hidden />
        2 Normen warten auf Bestätigung. Bis dahin nutzt {identity.productName} sie nicht.
        <span className="font-medium underline underline-offset-2">Jetzt prüfen</span>
      </p>
      <div className="px-8 pt-5">
        <p className="text-muted-foreground text-meta pb-2">Themen</p>
        <div className="grid grid-cols-3 gap-4">
          {TOPICS.map((topic) => (
            <div key={topic.name} className="bg-sheet shadow-sm flex items-center gap-3 rounded-[10px] px-4 py-3">
              <Folder className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="text-name block">{topic.name}</span>
                <span className="text-muted-foreground text-meta block">
                  {topic.count} {topic.count === 1 ? 'Element' : 'Elemente'}
                </span>
              </span>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
