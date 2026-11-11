'use client'

/**
 * Dev preview: the person's tape on a PDF drawing (ADR-0182, slice 8), as the
 * review view draws it on a page.
 *
 *   1. A distance at an ESTIMATED scale: the value with its tolerance, one
 *      line saying the scale is not confirmed yet, and the way to calibrate it.
 *   2. An area at a VERIFIED scale (a person calibrated it).
 *   3. A value read off a printed dimension, where nothing was measured.
 *   4. A measurement REFUSED on an uncalibrated region: one sentence and the
 *      one thing to do about it. The engine's own words are a tooltip only.
 *   5. A click the engine tied nowhere: several corners in reach, to pick from.
 *   6. A click on a scan.
 *   7. Measurements kept on the sheet, and their rows in the list of marks.
 *
 * Backend-free and fixed: every number here is a fixture standing in for the
 * engine's answer (`../_fixtures/drawing-tape.ts`); the components are the
 * review's own. The sheet under them is a drawn stand-in, not a PDF. Gated by
 * `../layout.tsx`. Pinned to German.
 */

import type { FC, ReactNode } from 'react'
import { I18nProvider } from '@/i18n'
import { MeasureLayer } from '@/features/documents/components/review/measure/measure-layer'
import { MeasureTools, tapeHint } from '@/features/documents/components/review/measure/measure-tools'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { MarkRowContent, markRowClassName } from '@/features/documents/components/review/mark-row'
import { FloatingNote, FloatingToolbar } from '@/components/ui/floating-toolbar'
import { CommentPin } from '@/components/ui/comment-pin'
import { IDLE_TAPE, type SheetTape } from '@/features/documents/hooks/use-sheet-tape'
import {
  AREA_VERIFIED,
  DISTANCE_ESTIMATED,
  KEPT_MARKS,
  ON_A_SCAN,
  READ_OFF_FIGURE,
  REFUSED_UNCALIBRATED,
  SEVERAL_IN_REACH,
} from '../_fixtures/drawing-tape'

/** A floor drawn in a few lines: something for a measurement to lie on. Shares of the sheet, like the fixtures. */
const WALLS = [
  'M 12 20 H 88 V 80 H 12 Z',
  'M 12 50 H 88',
  'M 44 20 V 50',
  'M 62 50 V 80',
]

const Sheet: FC<{ tape?: SheetTape; kept?: boolean; scan?: boolean }> = ({ tape = IDLE_TAPE, kept = false, scan = false }) => (
  <div className="bg-sheet border-border relative aspect-[3/2] w-full overflow-visible rounded-[2px] border shadow-xs">
    <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
      {(scan ? [] : WALLS).map((d) => (
        <path key={d} d={d} fill="none" stroke="var(--paper-ink)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
    {kept &&
      KEPT_MARKS.map((mark) => (
        <span key={mark.id} className="absolute z-20 -translate-x-1/2 -translate-y-1/2" style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}>
          <CommentPin as="span" number={mark.number} color="var(--paper-ink)" />
        </span>
      ))}
    <MeasureLayer
      review={{
        annotations: kept ? KEPT_MARKS : [],
        selectedId: kept ? KEPT_MARKS[1].id : null,
        select: () => undefined,
        tape,
        canAnnotate: true,
        setTool: () => undefined,
      }}
      page={1}
    />
  </div>
)

const Scenario: FC<{ id: string; title: string; note: string; children: ReactNode }> = ({ id, title, note, children }) => (
  <section data-testid={`drawing-tape-${id}`} className="flex flex-col gap-3">
    <div>
      <h2 className="text-foreground text-sm font-semibold">{title}</h2>
      <p className="text-muted-foreground text-xs">{note}</p>
    </div>
    {children}
  </section>
)

/** The palette's tape tools spelled out with their keys, and the line the canvas shows while one is in hand. */
const Tools: FC = () => {
  const t = useTranslations(filesCopy)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <FloatingToolbar className="w-fit">
        <MeasureTools tape={DISTANCE_ESTIMATED} variant="intro" />
      </FloatingToolbar>
      <FloatingNote>{tapeHint(t, DISTANCE_ESTIMATED, false)}</FloatingNote>
    </div>
  )
}

const Preview: FC = () => (
  <main data-testid="drawing-tape-preview" className="text-foreground mx-auto flex w-full max-w-[880px] flex-col gap-12 p-4 pb-40 sm:p-8 sm:pb-40">
    <Scenario id="tools" title="Werkzeuge" note="Strecke, Weg und Fläche neben den Werkzeugen der Prüfansicht, mit ihren Tasten, und der Hinweis über der Seite, solange eines in der Hand ist.">
      <Tools />
    </Scenario>
    <Scenario id="distance-estimated" title="Strecke, Maßstab geschätzt" note="Der Wert mit seiner Toleranz, eine Zeile, worauf er beruht, und der Weg, den Maßstab zu bestätigen.">
      <Sheet tape={DISTANCE_ESTIMATED} />
    </Scenario>
    <Scenario id="area-verified" title="Fläche, Maßstab bestätigt" note="Eine Person hat den Maßstab dieses Bereichs bestätigt.">
      <Sheet tape={AREA_VERIFIED} />
    </Scenario>
    <Scenario id="printed" title="Von der Maßzahl abgelesen" note="Wo kein Maßstab bestätigt ist, aber eine Maßzahl an der Strecke steht: der gedruckte Wert, nichts gemessen.">
      <Sheet tape={READ_OFF_FIGURE} />
    </Scenario>
    <Scenario id="refused" title="Kein bestätigter Maßstab" note="Ein Satz, warum es keinen Wert gibt, und das eine, was sich tun lässt. Nichts zu behalten.">
      <Sheet tape={REFUSED_UNCALIBRATED} />
    </Scenario>
    <Scenario id="several" title="Mehrere Ecken in Reichweite" note="Der Klick wird nicht genommen; die Ecken in Reichweite stehen zur Wahl.">
      <Sheet tape={SEVERAL_IN_REACH} />
    </Scenario>
    <Scenario id="scan" title="Ein Scan" note="Eine Seite ohne Linien: der Klick sagt es dort, wo er war.">
      <Sheet tape={ON_A_SCAN} scan />
    </Scenario>
    <Scenario id="kept" title="Auf dem Blatt behalten" note="Behaltene Messungen auf der Seite und in der Liste der Anmerkungen; die geöffnete zeigt, was beim Behalten gemessen wurde.">
      <Sheet kept />
      <ul className="border-border bg-card flex max-w-[420px] flex-col rounded-surface border p-1">
        {KEPT_MARKS.map((mark) => (
          <li key={mark.id} className={markRowClassName(mark.id === KEPT_MARKS[1].id)}>
            <MarkRowContent annotation={mark} viewerId="user_1" />
          </li>
        ))}
      </ul>
    </Scenario>
  </main>
)

export default function DrawingTapePreviewPage() {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Preview />
    </I18nProvider>
  )
}
