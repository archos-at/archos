'use client'

import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import type { BimComparison } from '@/lib/bim/compare'
import {
  IfcComplianceCard,
  IfcDiffCard,
  IfcElementCard,
  IfcScheduleCard,
} from '@/features/cards/components/IfcDataCards'

const PROJECT_ID = 'dev-project'

const MODELS = {
  models: [
    {
      id: 'model-v3',
      documentId: 'doc-v3',
      projectId: PROJECT_ID,
      filename: 'wohnhaus-beispielgasse_V3.ifc',
      status: 'ready',
      schemaVersion: 'IFC4',
      elementCount: 1284,
      errorMessage: null,
      summary: null,
      updatedAt: '2026-05-04T09:30:15.400Z',
    },
    {
      id: 'model-v2',
      documentId: 'doc-v2',
      projectId: PROJECT_ID,
      filename: 'wohnhaus-beispielgasse_V2.ifc',
      status: 'ready',
      schemaVersion: 'IFC4',
      elementCount: 1240,
      errorMessage: null,
      summary: null,
      updatedAt: '2026-03-18T14:05:00.000Z',
    },
  ],
}

const PROFILE = {
  facts: { building_class: { value: 4 }, main_use: { value: 'residential' } },
}

const SCHEDULE = {
  schedule: {
    storeys: [
      {
        storeyName: 'Erdgeschoss',
        elevation: 0,
        rooms: [
          {
            globalId: '1kTvXnbbzCWw8lcMd1dR40',
            name: 'Wohnen/Essen',
            storeyName: 'Erdgeschoss',
            category: 'INTERNAL',
            netFloorArea: 38.4,
            grossFloorArea: 41.2,
            netVolume: 96,
            height: 2.5,
          },
          {
            globalId: '1kTvXnbbzCWw8lcMd1dR41',
            name: 'Kind 1',
            storeyName: 'Erdgeschoss',
            category: 'INTERNAL',
            netFloorArea: 14.2,
            grossFloorArea: 15.6,
            netVolume: 35.5,
            height: 2.5,
          },
          {
            globalId: '1kTvXnbbzCWw8lcMd1dR42',
            name: 'Abstellraum',
            storeyName: 'Erdgeschoss',
            category: 'INTERNAL',
            netFloorArea: null,
            grossFloorArea: null,
            netVolume: null,
            height: null,
          },
          {
            globalId: '1kTvXnbbzCWw8lcMd1dR43',
            name: 'Vorraum',
            storeyName: 'Erdgeschoss',
            category: 'INTERNAL',
            netFloorArea: null,
            grossFloorArea: null,
            netVolume: null,
            height: null,
          },
        ],
        netFloorArea: 52.6,
        grossFloorArea: 56.8,
        netVolume: 131.5,
        roomsWithoutArea: 2,
      },
    ],
    totals: {
      rooms: 4,
      roomsWithoutArea: 2,
      netFloorArea: 52.6,
      grossFloorArea: 56.8,
      netVolume: 131.5,
    },
    units: { area: 'm²', volume: 'm³' },
  },
}

const ELEMENT = {
  element: {
    globalId: '1kTvXnbbzCWw8lcMd1dR4o',
    expressId: 4211,
    ifcType: 'IfcWallStandardCase',
    name: 'AW 38 Nord',
    description: null,
    predefinedType: 'SOLIDWALL',
    objectType: null,
    tag: 'W-01',
    typeName: 'AW 38 Stahlbeton mit WDVS',
    storeyName: 'Erdgeschoss',
    materials: ['Stahlbeton', 'EPS-W 038'],
    classifications: [{ system: 'ÖNORM B 1801-1', code: 'B.2.1', name: 'Außenwände' }],
    properties: {
      Pset_WallCommon: { FireRating: 'REI 90', LoadBearing: true, IsExternal: true },
      Pset_WallCommonAT: { ThermalTransmittance: 0.21 },
    },
    quantities: { Qto_WallBaseQuantities: { Length: 8.4, Height: 2.8, NetSideArea: 21.4 } },
  },
}

const COMPLIANCE = {
  compliance: [
    {
      ruleId: 'oib2-fire-resistance-load-bearing',
      richtlinie: 'OIB 2',
      clause: '3',
      titleDe: 'Tragende Bauteile — Feuerwiderstand',
      thresholdDe: 'Feuerwiderstand nach Gebäudeklasse (GK1 R 30 … GK5 REI 90)',
      applicable: true,
      passed: 0,
      failed: 0,
      undecidable: 34,
      failures: [],
      unknowns: [],
      truncated: false,
      missing: [{ path: 'Pset_WallCommon.FireRating', elements: 34 }],
    },
    {
      ruleId: 'oib3-room-height',
      richtlinie: 'OIB 3',
      clause: '2',
      titleDe: 'Aufenthaltsräume — lichte Raumhöhe',
      thresholdDe: 'lichte Raumhöhe ≥ 2,50 m',
      applicable: true,
      passed: 9,
      failed: 0,
      undecidable: 0,
      failures: [],
      unknowns: [],
      truncated: false,
      missing: [],
    },
  ],
}

const COMPARISON: { comparison: BimComparison } = {
  comparison: {
    added: [
      {
        globalId: '0GridFixture00Door0009',
        ifcType: 'IfcDoor',
        name: 'Fluchttür OG',
        storeyName: 'Obergeschoss',
      },
    ],
    removed: [],
    changed: [
      {
        globalId: '1kTvXnbbzCWw8lcMd1dR4o',
        ifcType: 'IfcWallStandardCase',
        name: 'AW 38 Nord',
        storeyName: 'Erdgeschoss',
        changes: [
          { field: 'Pset_WallCommon.FireRating', before: 'REI 90', after: 'REI 30', delta: null },
        ],
      },
    ],
    unchangedCount: 99,
    counts: { added: 1, removed: 0, changed: 1 },
    totals: { base: 100, revision: 101 },
    truncated: false,
  },
}

const QUERY_FIXTURES: Record<string, unknown> = {
  schedule: SCHEDULE,
  element: ELEMENT,
  compliance: COMPLIANCE,
  compare: COMPARISON,
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __bimCardsShim?: boolean }
  if (!w.__bimCardsShim) {
    w.__bimCardsShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/query')) {
        const op = String(JSON.parse(String(init?.body ?? '{}')).op ?? '')
        const fixture = QUERY_FIXTURES[op]
        return fixture ? Response.json(fixture) : new Response(null, { status: 404 })
      }
      if (url.includes('/bim/models')) return Response.json(MODELS)
      if (url.includes('/profile')) return Response.json(PROFILE)
      return real(input, init)
    }
  }
}

export default function BimCardsDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8" data-testid="bim-cards-preview">
      <div>
        <h1 className="text-lg font-semibold">Chat cards — model-backed</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The agent supplies an identifier; the card fetches the numbers. So an answer can point at
          the wrong table, which is visible — it can never state a floor area that is not in the
          model.
        </p>
      </div>

      <IfcScheduleCard
        title="Raumbuch Erdgeschoss"
        modelFile="wohnhaus-beispielgasse_V3.ifc"
        storey="Erdgeschoss"
        note="Zwei Räume führen keine Fläche — die Summe ist eine Teilsumme."
        projectId={PROJECT_ID}
      />

      <IfcElementCard
        title="AW 38 Nord"
        globalId="1kTvXnbbzCWw8lcMd1dR4o"
        modelFile="wohnhaus-beispielgasse_V3.ifc"
        note={null}
        projectId={PROJECT_ID}
      />

      <IfcComplianceCard
        title="Offene Anforderungen"
        modelFile="wohnhaus-beispielgasse_V3.ifc"
        ruleIds={[]}
        note={null}
        projectId={PROJECT_ID}
      />

      <IfcDiffCard
        title="Was V3 gegenüber V2 verändert hat"
        baseModelFile="wohnhaus-beispielgasse_V2.ifc"
        modelFile="wohnhaus-beispielgasse_V3.ifc"
        note={null}
        projectId={PROJECT_ID}
      />
    </main>
  )
}
