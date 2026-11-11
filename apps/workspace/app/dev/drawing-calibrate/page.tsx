'use client'

/**
 * Dev preview: calibrating a drawing's scale in the review view (ADR-0183).
 *
 *   1. Idle: the page's one active calibration, listed beside the page and
 *      outlined on it with its ratio.
 *   2. Being set: two points, the true length typed, the region drawn, and the
 *      ratio that results, before anything is saved.
 *   3. The region missing: both points and the length are there, saving is not
 *      possible, and one line says why.
 *   4. A reader who may not calibrate: the list without its controls, and why.
 *
 * Each scenario is the real hook, layer and panel over a sheet drawn here: an
 * A1 page lying on its long side, whose size in points the layer reads from the
 * page element as it does in the viewer. Backend-free: the three calls are
 * answered from fixed data in this file. Gated by `../layout.tsx`. Pinned to
 * German.
 */

import { useEffect, useMemo, useRef, useState, type FC, type ReactNode } from 'react'
import { I18nProvider } from '@/i18n'
import { PageSheet } from '@/features/knowledge/components/pdf-viewer-atoms'
import { CalibrationPageLayer } from '@/features/documents/components/review/calibration-page-layer'
import { CalibrationPanel } from '@/features/documents/components/review/calibration-panel'
import { useReviewCalibration, type CalibrationHost } from '@/features/documents/hooks/use-review-calibration'
import type { ReviewTool } from '@/features/documents/hooks/use-document-review'
import { DrawingMeasureAccess } from '@/features/documents/lib/drawing-measure-access'
import type { CalibrationClient } from '@/lib/drawing-calibrations/client'
import type { CalibrationView } from '@/lib/drawing-calibrations/wire'

/** An A1 sheet on its long side, in points. */
const SHEET = { width: 2383.94, height: 1683.78 }
const SHEET_WIDTH_PX = 620

const DOCUMENT_ID = '0b6f6a52-7d0c-4a55-9c59-3f1d2a7e1c01'
const VERSION_ID = '5f0f3c1e-2a44-4b7e-8d31-6c2b9e4a7d02'

/** The floor layout's region, and a span on its dimension line that is 21 m long at 1:100 (210 mm of paper). */
const LAYOUT_REGION = { x: 0.06, y: 0.1, w: 0.6, h: 0.78 }
const SPAN_FROM = { x: 0.15, y: 141 / 706 }
const SPAN_TO = { x: 0.15 + 595.276 / SHEET.width, y: 141 / 706 }

const SAVED: CalibrationView = {
  id: 'a3c1d5e7-1b2c-4d3e-8f4a-5b6c7d8e9f03',
  documentId: DOCUMENT_ID,
  versionId: VERSION_ID,
  page: 1,
  region: LAYOUT_REGION,
  from: SPAN_FROM,
  to: SPAN_TO,
  lengthM: 21,
  status: 'active',
  createdBy: 'user_anna',
  createdAt: '2026-11-04T09:12:00.000Z',
  withdrawnAt: null,
  withdrawnBy: null,
}

/** The three calls, answered from this scenario's own list. */
function fixtureClient(initial: readonly CalibrationView[], canCalibrate: boolean): CalibrationClient {
  let held = [...initial]
  return {
    list: async () => ({ calibrations: held, nextCursor: null, versionId: VERSION_ID, canCalibrate }),
    set: async (_documentId, input) => {
      const made: CalibrationView = {
        ...SAVED,
        ...input,
        id: crypto.randomUUID(),
        createdBy: 'user_me',
        createdAt: new Date().toISOString(),
      }
      held = [...held, made]
      return made
    },
    withdraw: async (_documentId, calibrationId) => {
      const gone = held.find((entry) => entry.id === calibrationId) ?? SAVED
      held = held.filter((entry) => entry.id !== calibrationId)
      return { ...gone, status: 'withdrawn', withdrawnAt: new Date().toISOString(), withdrawnBy: 'user_me' }
    },
  }
}

/** A sheet as an architect would hand it over: a floor layout with a dimension line, and a detail at another scale. */
const SheetDrawing: FC = () => (
  <svg aria-hidden viewBox="0 0 1000 706" className="absolute inset-0 size-full text-neutral-800">
    <g fill="none" stroke="currentColor">
      {/* The floor layout: outer walls, inner walls, the stair core. */}
      <rect x="150" y="190" width="420" height="330" strokeWidth="3" />
      <path d="M270 190v150h-120M270 340v180M400 190v120h170M400 310v210M330 400h70" strokeWidth="1.5" />
      <path d="M300 420h60v70h-60zM310 420v70M320 420v70M330 420v70M340 420v70M350 420v70" strokeWidth="0.8" />
      {/* The dimension line over it, with its ticks: 21,00 m to the inner wall, 14,28 m beyond it. */}
      <path d="M150 141h420M150 131v20M400 131v20M570 131v20" strokeWidth="1" />
      {/* A detail, drawn larger. */}
      <rect x="720" y="150" width="190" height="130" strokeWidth="2" />
      <path d="M720 195h190M720 215h190M760 150v130M790 150v130" strokeWidth="1" />
      {/* The title block. */}
      <rect x="700" y="560" width="260" height="100" strokeWidth="1.5" />
      <path d="M700 590h260M700 625h260M830 590v70" strokeWidth="0.8" />
    </g>
    <g fill="currentColor" fontFamily="ui-sans-serif, system-ui" fontSize="13">
      <text x="258" y="134">21,00</text>
      <text x="468" y="134">14,28</text>
      <text x="184" y="270">Wohnen</text>
      <text x="314" y="270">Küche</text>
      <text x="462" y="256">Zimmer</text>
      <text x="150" y="552" fontSize="12">Grundriss 1. Obergeschoss</text>
      <text x="720" y="304" fontSize="12">Detail Attika</text>
      <text x="712" y="581" fontSize="11">Wohnhaus Lindengasse</text>
      <text x="712" y="612" fontSize="11">Einreichung</text>
    </g>
  </svg>
)

type Seed = 'idle' | 'complete' | 'regionMissing'

const Scenario: FC<{
  id: string
  title: string
  note: string
  saved: readonly CalibrationView[]
  canCalibrate: boolean
  seed: Seed
}> = ({ id, title, note, saved, canCalibrate, seed }) => {
  const [tool, setTool] = useState<ReviewTool>(seed === 'idle' ? 'select' : 'calibrate')
  const client = useMemo(() => fixtureClient(saved, canCalibrate), [saved, canCalibrate])
  const host: CalibrationHost = useMemo(
    () => ({
      documentId: DOCUMENT_ID,
      load: 'ready',
      tool,
      setTool,
      me: 'user_me',
      annotations: [{ createdBy: 'user_anna', createdByName: 'Anna Berger' }],
    }),
    [tool]
  )
  const calibration = useReviewCalibration(host, { client })
  const { shown, active, setOpen, pick, setLength, drawRegion } = calibration

  // The state the scenario shows, set once the list has answered: the clicks, the length and the box a person would make.
  const seeded = useRef(false)
  useEffect(() => {
    if (!shown || seeded.current) return
    if (seed === 'idle') {
      seeded.current = true
      setOpen(true)
      return
    }
    if (!active) return
    seeded.current = true
    pick(1, SPAN_FROM, SHEET)
    pick(1, SPAN_TO, SHEET)
    setLength(21)
    if (seed === 'complete') drawRegion(1, LAYOUT_REGION)
  }, [shown, active, seed, setOpen, pick, setLength, drawRegion])

  return (
    <section data-testid={`calibrate-scenario-${id}`} className="flex flex-col gap-3">
      <div>
        <h2 className="text-foreground text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground text-xs">{note}</p>
      </div>
      <div className="bg-muted/60 flex items-start gap-4 rounded-lg p-4">
        <PageSheet
          data-page={1}
          data-page-width-pt={SHEET.width}
          data-page-height-pt={SHEET.height}
          style={{ width: SHEET_WIDTH_PX, height: (SHEET_WIDTH_PX * SHEET.height) / SHEET.width }}
        >
          <SheetDrawing />
          <CalibrationPageLayer page={1} calibration={calibration} />
        </PageSheet>
        <CalibrationPanel calibration={calibration} page={1} className="shrink-0" />
      </div>
    </section>
  )
}

const ONE_SAVED = [SAVED] as const
const NONE_SAVED: readonly CalibrationView[] = []

const Preview: FC = () => (
  <main data-testid="drawing-calibrate-preview" className="text-foreground mx-auto flex w-full max-w-[1040px] flex-col gap-10 p-4 sm:p-6">
    <Scenario
      id="idle"
      title="Kalibrierter Maßstab"
      note="Die Seite hat einen kalibrierten Maßstab: neben der Seite gelistet, auf der Seite mit seinem Bereich."
      saved={ONE_SAVED}
      canCalibrate
      seed="idle"
    />
    <Scenario
      id="complete"
      title="Maßstab wird kalibriert"
      note="Zwei Punkte, die wahre Länge und der gezeichnete Bereich: der Maßstab steht da, bevor gespeichert wird."
      saved={NONE_SAVED}
      canCalibrate
      seed="complete"
    />
    <Scenario
      id="region-missing"
      title="Der Bereich fehlt"
      note="Punkte und Länge sind da, der Bereich nicht: Speichern geht nicht, und eine Zeile sagt, warum."
      saved={NONE_SAVED}
      canCalibrate
      seed="regionMissing"
    />
    <Scenario
      id="read-only"
      title="Ohne Recht zu kalibrieren"
      note="Wer die Dokumente des Projekts nicht bearbeiten darf, sieht den Maßstab und kann ihn nicht ändern."
      saved={ONE_SAVED}
      canCalibrate={false}
      seed="idle"
    />
  </main>
)

export default function DrawingCalibratePreviewPage(): ReactNode {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <DrawingMeasureAccess enabled>
        <Preview />
      </DrawingMeasureAccess>
    </I18nProvider>
  )
}
