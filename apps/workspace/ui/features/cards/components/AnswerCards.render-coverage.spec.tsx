import { discriminatedOptions } from '@/lib/api/zod-union'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { render } from '@/test-utils'
import { answerCardSchema, type AnswerCard } from '@/shared/cards/schemas'
import { PREVIEW_EXCLUDED, previewFixtureFor } from '../preview-fixtures'
import { AnswerCardItem } from './AnswerCards'
import { rendererSettled } from '@/features/a2ui/A2uiCard'
import { loadCardJsonSchema } from '@/test-utils/card-json-schema'

const cardJsonSchema = loadCardJsonSchema()

const READY_MODEL = {
  id: 'model-1',
  documentId: 'doc-1',
  projectId: 'p1',
  filename: 'haus-a.ifc',
  displayName: null,
  status: 'ready',
  schemaVersion: 'IFC4',
  elementCount: 120,
  errorMessage: null,
  summary: null,
  updatedAt: '2026-02-11T09:00:00.000Z',
}

vi.mock('@/features/bim/hooks/use-bim-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/bim/hooks/use-bim-model')>()
  return {
    ...actual,
    useProjectBimModels: () => ({
      data: [READY_MODEL],
      isLoading: false,
      error: null,
      reload: () => {},
    }),
  }
})

const RESOLVED_FILE = {
  id: 'file-1',
  filename: 'einreichplan.pdf',
  displayName: null,
  fileSize: 1024,
  contentType: 'application/pdf',
  status: 'ready',
  folderId: null,
  createdAt: '2026-01-01T00:00:00Z',
  errorMessage: null,
  summary: 'Einreichplan mit Fluchtwegen.',
  pageCount: 3,
  chunkCount: 7,
  contentTypes: null,
  tags: null,
}

vi.mock('@/features/documents/hooks/use-surfaced-documents', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/features/documents/hooks/use-surfaced-documents')
  >()
  return {
    ...actual,
    useSurfacedDocuments: (documents: { file_name: string }[]) => ({
      resolved: documents.map((surfaced, position) => ({
        key: `${surfaced.file_name}-${position}`,
        surfaced,
        file: { ...RESOLVED_FILE, filename: surfaced.file_name },
        docSource: 'project' as const,
      })),
      isLoading: false,
      error: false,
      retry: () => {},
    }),
  }
})

type CardInput = z.input<typeof answerCardSchema>

interface JsonSchemaDocument {
  $defs: Record<
    string,
    {
      required?: string[]
      properties?: { type?: { const?: string; default?: string } }
    }
  >
}

const EXCLUDED_FIXTURES: Record<string, CardInput> = {
  ifc_viewer: { type: 'ifc_viewer', title: 'Modell ansehen' },
  ifc_compliance: { type: 'ifc_compliance', title: 'Prüfbuch' },
  ifc_schedule: { type: 'ifc_schedule', title: 'Raumbuch' },
  ifc_element: { type: 'ifc_element', title: 'Wand W-01', global_id: '2O2Fr$t4X7Zf8NOew3FLKU' },
  ifc_diff: { type: 'ifc_diff', title: 'Änderungen gegenüber Vorabzug', base_model_file: 'haus-a.ifc' },
  ifc_model_picker: { type: 'ifc_model_picker', title: 'Welches Modell?' },
  document_grid: {
    type: 'document_grid',
    title: 'Passende Dokumente',
    query: 'Fluchtwege',
    documents: [{ file_name: 'einreichplan.pdf', summary: 'Einreichplan' }],
  },
}

const ALL_TYPES = [...discriminatedOptions(answerCardSchema).keys()].filter(
  (type): type is string => typeof type === 'string'
)

function fixtureFor(type: string): AnswerCard | undefined {
  const preview = previewFixtureFor(type)
  if (preview) return preview
  const excluded = EXCLUDED_FIXTURES[type]
  return excluded ? answerCardSchema.parse(excluded) : undefined
}

const REQUIRED_FIELDS: Record<string, string[]> = Object.fromEntries(
  Object.values((cardJsonSchema as JsonSchemaDocument).$defs)
    .map((definition) => {
      const literal = definition.properties?.type?.const ?? definition.properties?.type?.default
      if (typeof literal !== 'string') return null
      return [literal, [...new Set(['type', ...(definition.required ?? [])])]] as const
    })
    .filter((entry): entry is readonly [string, string[]] => entry !== null)
)

function minimalFrom(card: AnswerCard): AnswerCard {
  const keep = new Set(REQUIRED_FIELDS[card.type] ?? ['type'])
  const stripped = Object.fromEntries(
    Object.entries(card).filter(([name]) => keep.has(name))
  )
  return answerCardSchema.parse(stripped)
}

function drawn(card: AnswerCard): { text: string; elements: number } {
  const { container } = render(
    <AnswerCardItem card={card} index={0} projectId="p1" messageId="message-1" />
  )
  return {
    text: (container.textContent ?? '').trim(),
    elements: container.querySelectorAll('*').length,
  }
}

function expectDrawsSomething(card: AnswerCard, shape: 'fixture' | 'minimal'): void {
  const { text, elements } = drawn(card)
  const blame =
    `card type "${card.type}" (${shape}) rendered nothing — ` +
    'AnswerCardItem has no branch for it, or its renderer bailed out on a field ' +
    'the schema does not require'
  expect(elements, blame).toBeGreaterThan(0)
  expect(text, blame).not.toBe('')
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
  )
})

beforeAll(rendererSettled)
afterEach(() => vi.unstubAllGlobals())

describe('every card type renders', () => {
  it('has a card to mount for every member of the union', () => {
    const missing = ALL_TYPES.filter((type) => !fixtureFor(type))
    expect(
      missing,
      'add a fixture to preview-fixtures.ts (or, if the gallery cannot preview the type, ' +
        'name it in PREVIEW_EXCLUDED and add a stand-in to EXCLUDED_FIXTURES here)'
    ).toEqual([])
  })

  it('knows what every type requires, so a minimal card is really minimal', () => {
    const unknown = ALL_TYPES.filter((type) => !REQUIRED_FIELDS[type])
    expect(
      unknown,
      'card type is in the Zod union but not in contracts/cards/schemas.json — regenerate the schema'
    ).toEqual([])
  })

  it('mounts every excluded type rather than skipping it', () => {
    const unmocked = Object.keys(PREVIEW_EXCLUDED).filter((type) => !(type in EXCLUDED_FIXTURES))
    expect(unmocked, 'a type excluded from the gallery still has to render').toEqual([])
  })

  it.each(ALL_TYPES)('%s draws its fixture', (type) => {
    const card = fixtureFor(type)
    expect(card, `no fixture for card type "${type}"`).toBeDefined()
    expectDrawsSomething(card as AnswerCard, 'fixture')
  })

  it.each(ALL_TYPES)('%s draws with only its required fields', (type) => {
    const card = fixtureFor(type)
    expect(card, `no fixture for card type "${type}"`).toBeDefined()
    expectDrawsSomething(minimalFrom(card as AnswerCard), 'minimal')
  })
})
