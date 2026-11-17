'use client'

import { useEffect, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { RisDocumentDialog } from '@/features/knowledge/components/ris-document-dialog'
import { SourceSignalChip } from '@/features/layout/components/SourceSignalChip'

const URL = 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006'

const PASSAGE =
  'Über die Fluchtwege ist sicherzustellen, dass die Benützerinnen und Benützer im Brandfall ins Freie oder in einen gesicherten Bereich gelangen können.'

const TEXT = [
  'Bauordnung für Wien',
  '',
  '§ 108. Schutz vor Brandgefahr',
  '',
  '(1) Bauwerke sind so zu planen und auszuführen, dass bei einem Brand die',
  'Tragfähigkeit der Konstruktion während eines bestimmten Zeitraumes erhalten',
  'bleibt und die Entstehung und Ausbreitung von Feuer und Rauch innerhalb des',
  'Bauwerkes begrenzt wird.',
  '',
  '(2) ' + PASSAGE,
  '',
  '(3) Die Rettung von Menschen und Tieren sowie wirksame Löscharbeiten müssen',
  'möglich sein. Die Anforderungen der OIB-Richtlinie 2 in der für Wien',
  'verbindlich erklärten Fassung sind einzuhalten.',
  '',
  '§ 109. Ausführung der Fluchtwege',
  '',
  '(1) Die nutzbare Breite eines Fluchtweges darf 1,20 m nicht unterschreiten.',
  'Türen in Fluchtwegen müssen in Fluchtrichtung aufschlagen, sofern sie von',
  'mehr als 20 Personen benützt werden.',
].join('\n')

export default function RisSourcePreview() {
  const params = useSearchParams()
  const variant = params.get('variant') ?? 'default'
  const [stubbed, setStubbed] = useState(false)

  useEffect(() => {
    const original = window.fetch
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (!url.startsWith('/api/ris/document')) return original(input, init)
      if (variant === 'failed') {
        return new Response('{"error":"upstream"}', { status: 502 })
      }
      if (variant === 'busy') {
        return new Response('{"error":"rate limited"}', { status: 429 })
      }
      return new Response(
        JSON.stringify({
          url: URL,
          title: 'Bauordnung für Wien § 108',
          text: TEXT,
          truncated: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as typeof window.fetch
    setStubbed(true)
    return () => {
      window.fetch = original
    }
  }, [variant])

  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <div className="bg-background min-h-dvh p-6" data-testid="ris-source-preview">
      {stubbed && (
        <RisDocumentDialog
          open
          onOpenChange={() => {}}
          url={URL}
          title="Bauordnung für Wien § 108"
          highlight={PASSAGE}
          highlightColor="var(--source-law)"
          headerChip={<SourceSignalChip signal="law">Rechtsquelle (RIS)</SourceSignalChip>}
        />
      )}
    </div>
  )
}
