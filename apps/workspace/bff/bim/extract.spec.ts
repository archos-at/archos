// @disk-inputs: tests/fixtures/ifc/sample-building.ifc
/**
 * @vitest-environment node
 *
 * Extraction is the foundation every other IFC surface stands on — the viewer,
 * the query tool and the digest all read what this produces — so it is pinned
 * against a real IFC file rather than a hand-built store double. The fixture is
 * a small but complete IFC4 building: two storeys, four spaces with published
 * quantities, walls that carry both occurrence and type property sets, a
 * layered material, a classification, and one opening (which must NOT count).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractIfcModel, IfcExtractionError, looksLikeStepIfc } from './extract'
import { buildStoredRuleInputs, readStoredRuleInputs } from './rule-inputs'
import { SETTLED_BASES } from './rule-basis.fixtures'
import { runBimRules } from './rules'
import { createZip } from './zip'
import type { BimModelIndex } from './types'

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'ifc', 'sample-building.ifc')

function fixtureBuffer(): ArrayBuffer {
  const buffer = readFileSync(FIXTURE)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

let cached: BimModelIndex | null = null
async function model(): Promise<BimModelIndex> {
  cached ??= await extractIfcModel(fixtureBuffer(), 'sample-building.ifc')
  return cached
}

describe('looksLikeStepIfc', () => {
  it('accepts a STEP physical file', () => {
    expect(looksLikeStepIfc(fixtureBuffer())).toBe(true)
  })

  it('rejects arbitrary bytes wearing an .ifc name', () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nnot an ifc file at all')
    expect(looksLikeStepIfc(bytes.buffer as ArrayBuffer)).toBe(false)
  })

  it('tolerates leading whitespace before the ISO header', () => {
    const bytes = new TextEncoder().encode('\n  ISO-10303-21;\nHEADER;')
    expect(looksLikeStepIfc(bytes.buffer as ArrayBuffer)).toBe(true)
  })

  it('accepts a file that starts with a byte-order mark', () => {
    const bytes = new TextEncoder().encode('\ufeffISO-10303-21;\nHEADER;')
    expect(looksLikeStepIfc(bytes.buffer as ArrayBuffer)).toBe(true)
  })
})

describe('extractIfcModel', () => {
  it('fails with a typed error rather than a parser stack trace on non-IFC bytes', async () => {
    const bytes = new TextEncoder().encode('just some text')
    await expect(extractIfcModel(bytes.buffer as ArrayBuffer, 'fake.ifc')).rejects.toMatchObject({
      name: 'IfcExtractionError',
      code: 'not-ifc',
    })
    await expect(extractIfcModel(bytes.buffer as ArrayBuffer, 'fake.ifc')).rejects.toBeInstanceOf(
      IfcExtractionError
    )
  })

  it('unwraps a .ifczip instead of parsing the archive bytes', async () => {
    const inner = new Uint8Array(readFileSync(FIXTURE))
    const archive = createZip([{ path: 'sample-building.ifc', content: inner }])
    const index = await extractIfcModel(
      archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer,
      'sample-building.ifczip'
    )
    expect(index.totals.elements).toBeGreaterThan(0)
    expect(index.storeys.length).toBeGreaterThan(0)
  })

  it('refuses an archive whose contents are not IFC, rather than storing an empty model', async () => {
    const junk = new TextEncoder().encode('%PDF-1.7\nnot an ifc file at all')
    const archive = createZip([{ path: 'thing.ifc', content: junk }])
    await expect(
      extractIfcModel(
        archive.buffer.slice(
          archive.byteOffset,
          archive.byteOffset + archive.byteLength
        ) as ArrayBuffer,
        'thing.ifczip'
      )
    ).rejects.toMatchObject({ name: 'IfcExtractionError', code: 'not-ifc' })
  })

  it('reads the schema, header provenance and declared units', async () => {
    const index = await model()
    expect(index.schema).toBe('IFC4')
    expect(index.header.author).toEqual(['A. Muster'])
    expect(index.header.organization).toEqual(['Musterbuero ZT GmbH'])
    expect(index.header.originatingSystem).toBe('GRID')
    expect(index.units.length).toEqual({ symbol: 'mm', siScale: 0.001 })
    expect(index.units.area?.symbol).toBe('m²')
  })

  it('resolves the spatial hierarchy down to spaces', async () => {
    const index = await model()
    expect(index.projectName).toBe('Wohnhaus Beispielgasse')
    expect(index.siteName).toBe('Grundstueck Beispielgasse 12')
    expect(index.buildingNames).toEqual(['Haus A'])
    expect(index.spatial?.ifcType).toBe('IfcProject')

    const site = index.spatial?.children[0]
    const building = site?.children[0]
    expect(building?.ifcType).toBe('IfcBuilding')
    expect(building?.children.map((node) => node.name)).toEqual(['Erdgeschoss', 'Obergeschoss'])
    expect(building?.children[0].children.map((node) => node.name)).toEqual(['Wohnzimmer', 'Kueche'])
  })

  it('orders storeys by elevation and converts it out of millimetres', async () => {
    const index = await model()
    expect(index.storeys.map((storey) => [storey.name, storey.elevation])).toEqual([
      ['Erdgeschoss', 0],
      ['Obergeschoss', 3],
    ])
  })

  it('counts elements by canonical type and excludes openings', async () => {
    const index = await model()
    expect(index.typeCounts).toMatchObject({
      IfcWall: 5,
      IfcSpace: 4,
      IfcWindow: 3,
      IfcDoor: 2,
      IfcSlab: 2,
      IfcStair: 1,
      IfcColumn: 1,
      IfcRoof: 1,
    })
    expect(index.typeCounts).not.toHaveProperty('IfcOpeningElement')
    expect(index.elements.some((element) => element.ifcType === 'IfcOpeningElement')).toBe(false)
    expect(index.totals.elements).toBe(19)
    expect(index.totals.spaces).toBe(4)
    expect(index.totals.storeys).toBe(2)
  })

  it('resolves every element to the storey that contains it', async () => {
    const index = await model()
    const wall = index.elements.find((element) => element.name === 'Aussenwand Nord')
    expect(wall).toMatchObject({
      ifcType: 'IfcWall',
      globalId: '0GridFixture00Wall0001',
      tag: 'W-01',
      predefinedType: 'SOLIDWALL',
      storeyName: 'Erdgeschoss',
      containerKind: 'storey',
    })

    const room = index.elements.find((element) => element.name === 'Schlafzimmer')
    expect(room?.storeyName).toBe('Obergeschoss')
    expect(room?.ifcType).toBe('IfcSpace')

    expect(index.elements.every((element) => element.globalId.length > 0)).toBe(true)
  })

  it('merges type property sets under the element occurrence', async () => {
    const index = await model()
    const wall = index.elements.find((element) => element.name === 'Aussenwand Nord')
    expect(wall?.properties['Pset_WallCommon']).toMatchObject({
      IsExternal: true,
      LoadBearing: true,
      FireRating: 'REI 90',
      ThermalTransmittance: 0.18,
    })
    expect(wall?.properties['Pset_WallCommon']).toMatchObject({ Reference: 'AW38' })
    expect(wall?.typeName).toBe('AW 38 Stahlbeton')
  })

  it('keeps the interior wall on its own property values', async () => {
    const index = await model()
    const inner = index.elements.find((element) => element.name === 'Innenwand EG')
    expect(inner?.properties['Pset_WallCommon']).toMatchObject({
      IsExternal: false,
      FireRating: 'EI 30',
    })
  })

  it('reads quantities, materials and classifications', async () => {
    const index = await model()
    const wall = index.elements.find((element) => element.name === 'Aussenwand Nord')
    expect(wall?.quantities['Qto_WallBaseQuantities']).toEqual({
      NetSideArea: 24.5,
      NetVolume: 7.35,
      Length: 8.2,
    })
    expect(wall?.materials).toEqual(['Stahlbeton', 'Waermedaemmung EPS', 'Aussenputz'])
    expect(wall?.classifications).toEqual([
      { system: 'ON B 1800', identification: 'B.1.2', name: 'Aussenwand' },
    ])
  })

  it('totals building quantities from spaces only', async () => {
    const index = await model()
    expect(index.quantityTotals.netFloorAreaM2).toBe(69)
    expect(index.quantityTotals.grossFloorAreaM2).toBe(74.2)
    expect(index.quantityTotals.netVolumeM3).toBe(80)
  })

  it('collects the vocabularies the query UI offers as filters', async () => {
    const index = await model()
    expect(index.propertySetNames).toEqual([
      'Pset_DoorCommon',
      'Pset_WallCommon',
      'Pset_WindowCommon',
    ])
    expect(index.quantitySetNames).toEqual([
      'Qto_SpaceBaseQuantities',
      'Qto_WallBaseQuantities',
    ])
    expect(index.materialNames).toEqual(['Aussenputz', 'Stahlbeton', 'Waermedaemmung EPS'])
  })

  it('caps the element list but keeps the counts exact', async () => {
    const index = await extractIfcModel(fixtureBuffer(), 'sample-building.ifc', { elementLimit: 5 })
    expect(index.elements).toHaveLength(5)
    expect(index.truncatedAt).toBe(5)
    expect(index.totals.elements).toBe(19)
    expect(index.typeCounts.IfcWall).toBe(5)
  })

  it('keeps the floor-area totals whole when the element list is capped', async () => {
    const whole = await extractIfcModel(fixtureBuffer(), 'sample-building.ifc')
    const capped = await extractIfcModel(fixtureBuffer(), 'sample-building.ifc', {
      elementLimit: 5,
    })

    expect(capped.truncatedAt).toBe(5)
    expect(capped.elements.some((element) => element.ifcType === 'IfcSpace')).toBe(false)
    expect(whole.quantityTotals.netFloorAreaM2).not.toBeNull()
    expect(capped.quantityTotals.netFloorAreaM2).toBe(whole.quantityTotals.netFloorAreaM2)
    expect(capped.quantityTotals.grossFloorAreaM2).toBe(whole.quantityTotals.grossFloorAreaM2)
    expect(capped.quantityTotals.netVolumeM3).toBe(whole.quantityTotals.netVolumeM3)
  })
})

describe('IsExternal, from the file to the verdict', () => {
  const EXTERNAL_WALL_FLAG = "#44=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$);"

  async function envelopeRule(edit: (step: string) => string) {
    const step = edit(readFileSync(FIXTURE, 'latin1'))
    const bytes = new TextEncoder().encode(step)
    const index = await extractIfcModel(bytes.buffer as ArrayBuffer, 'sample-building.ifc')
    const stored = readStoredRuleInputs(buildStoredRuleInputs(index.elements, false))
    const results = runBimRules(stored?.elements ?? [], { bases: SETTLED_BASES, mainUse: 'residential' })
    return results.find((result) => result.ruleId === 'oib6-u-value-external-wall')
  }

  it('judges the flagged walls on the value the file publishes', async () => {
    const rule = await envelopeRule((step) => step)

    expect([rule?.passed, rule?.undecidable]).toEqual([3, 0])
  })

  it('reads a flag the exporter wrote as a label', async () => {
    const rule = await envelopeRule((step) =>
      step.replace(EXTERNAL_WALL_FLAG, "#44=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCLABEL('TRUE'),$);")
    )

    expect([rule?.passed, rule?.undecidable]).toEqual([3, 0])
  })

  it('leaves the walls undecidable when the file drops the flag', async () => {
    const rule = await envelopeRule((step) => step.replace('(#44,#45,#46,#47)', '(#45,#46,#47)'))

    expect([rule?.passed, rule?.undecidable]).toEqual([0, 3])
  })

  it('leaves the walls undecidable when the file says it does not know', async () => {
    const rule = await envelopeRule((step) =>
      step.replace(EXTERNAL_WALL_FLAG, "#44=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCLOGICAL(.U.),$);")
    )

    expect([rule?.passed, rule?.undecidable]).toEqual([0, 3])
  })
})
