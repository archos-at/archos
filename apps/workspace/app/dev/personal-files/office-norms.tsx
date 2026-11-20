'use client'

// PROTOTYPE, not for merge: the upload menu and the norms place of the office library (concept for ticket 81).

import type { JSX } from 'react'
import { ChevronDown, FileUp, FolderUp, Mail, MailPlus } from 'lucide-react'

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

const NORMS = [
  { name: 'DIN 4109-1:2018', sub: 'Schallschutz im Hochbau – Teil 1: Mindestanforderungen', topic: 'Schallschutz', kind: 'Norm', edition: '2018-01', state: 'Zu bestätigen', use: 'Erst nach Bestätigung' },
  { name: 'ÖNORM B 1300:2018', sub: 'Objektsicherheitsprüfungen für Wohngebäude', topic: 'Brandschutz', kind: 'Norm', edition: '2018-11-01', state: 'Zu bestätigen', use: 'Erst nach Bestätigung' },
  { name: 'ÖNORM B 8115-2:2021', sub: 'Schallschutz und Raumakustik im Hochbau – Teil 2', topic: 'Schallschutz', kind: 'Norm', edition: '2021-11-15', state: 'Neuere Ausgabe', use: 'Wird zitiert' },
  { name: 'Bauordnung für Wien, Kommentar', sub: 'kommentar-bo.pdf', topic: 'Kommentare', kind: 'Kommentar', edition: '7. Auflage 2019', state: 'Prüfung fällig', use: 'Wird zitiert' },
  { name: 'Weisung Dachgeschoßausbau', sub: 'ma37.pdf', topic: 'Weisungen Wien', kind: 'Weisung', edition: '2021-03-15', state: 'Prüfung fällig', use: 'Wird zitiert' },
  { name: 'ÖNORM B 1600:2023', sub: 'Barrierefreies Bauen – Planungsgrundlagen', topic: 'Barrierefreiheit', kind: 'Norm', edition: '2023-05-01', state: 'Geprüft am 12.11.2026', use: 'Wird zitiert' },
  { name: 'OIB-Richtlinie 2: Brandschutz', sub: 'Ausgabe Mai 2023', topic: 'Brandschutz', kind: 'Richtlinie', edition: '2023-05', state: 'Geprüft am 12.11.2026', use: 'Wird zitiert' },
]

const STATE_TONE: Record<string, string> = {
  'Zu bestätigen': 'bg-[#f6ecd6] text-[#8a5a00]',
  'Neuere Ausgabe': 'bg-[#f6ecd6] text-[#8a5a00]',
  'Prüfung fällig': 'bg-desk text-muted-foreground',
}

export function NormsPlace(): JSX.Element {
  const chip = 'text-name inline-flex items-center gap-1.5 rounded-full px-2.5 py-1'
  const count = 'text-meta rounded-full px-1.5 font-medium'
  const head = 'text-muted-foreground text-meta px-3 py-2 text-left font-normal'
  const drop = 'text-muted-foreground text-name inline-flex items-center gap-1'
  return (
    <div className="px-8 pt-4">
      <div className="flex items-center gap-1">
        <span className={`${chip} bg-desk font-medium`}>
          Alle <span className={`${count} bg-sheet`}>12</span>
        </span>
        <span className={`${chip} text-muted-foreground`}>
          Zu bestätigen <span className={`${count} bg-[#f6ecd6] text-[#8a5a00]`}>2</span>
        </span>
        <span className={`${chip} text-muted-foreground`}>
          Neuere Ausgabe <span className={`${count} bg-[#f6ecd6] text-[#8a5a00]`}>1</span>
        </span>
        <span className={`${chip} text-muted-foreground`}>
          Prüfung fällig <span className={`${count} bg-desk text-foreground`}>2</span>
        </span>
        <span className="ml-auto flex items-center gap-4">
          <span className={drop}>
            Alle Themen
            <ChevronDown className="size-3.5" aria-hidden />
          </span>
          <span className={drop}>
            Alle Arten
            <ChevronDown className="size-3.5" aria-hidden />
          </span>
        </span>
      </div>
      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-hairline border-b">
            <th className={head}>Norm</th>
            <th className={head}>Thema</th>
            <th className={head}>Art</th>
            <th className={head}>Ausgabe</th>
            <th className={head}>Stand</th>
            <th className={head}>In Antworten</th>
          </tr>
        </thead>
        <tbody>
          {NORMS.map((norm) => (
            <tr key={norm.name} className="border-hairline border-b">
              <td className="px-3 py-2.5">
                <span className="text-name block">{norm.name}</span>
                <span className="text-muted-foreground text-meta block">{norm.sub}</span>
              </td>
              <td className="text-name px-3 font-normal">{norm.topic}</td>
              <td className="text-name px-3 font-normal">{norm.kind}</td>
              <td className="text-name px-3 font-normal">{norm.edition}</td>
              <td className="px-3">
                <span className={`text-meta whitespace-nowrap rounded-full px-2 py-0.5 ${STATE_TONE[norm.state] ?? 'border-hairline border'}`}>{norm.state}</span>
              </td>
              <td className="text-muted-foreground text-meta px-3">{norm.use}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground text-meta pb-6 pt-3">7 von 12 Normen und Richtlinien</p>
    </div>
  )
}
