// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps, ReactElement } from 'react'
import { render as rtlRender, screen } from '@testing-library/react'
import { render } from '@/test-utils'
import { http, HttpResponse } from 'msw'
import { I18nProvider } from '@/i18n'
import { server } from '@/mocks/server'
import type { ApplyProposalRequest, ProposedChangeView } from '@/lib/proposals/types'
import type { ProjectProfile, ProjectProfilePatchOperation } from '@/lib/project-profile/types'
import { exportedNames, lineOf, nodesOf, parseSource, productionSources, ts, walk } from '@/test-utils/source-ast'
import { KeyTakeawaysCard } from './components/KeyTakeawaysCard'
import { DimChecksList } from './schematics/kit'
import { ProposalReceipt } from './components/ProposalReceipt'
import { DECISION_BUTTON, DECISION_ROW } from './components/card-chrome'
import { MemoryProposalCard } from './components/MemoryProposalCard'
import { ProjectProfilePatchCard } from './components/ProjectProfilePatchCard'
import { resetDecidedProposals } from './decided-proposals'
import { PROPOSAL_ID, proposalBase, requests, resetKit, serve, startRecording } from './components/proposal-test-kit'

const CARDS_DIR = 'ui/features/cards/'

const cardSources = (): string[] => productionSources().filter((file) => file.startsWith(CARDS_DIR))

const classTokens = (node: ts.Node): string[] => {
  const words: string[] = []
  walk(node, (child) => {
    if (
      ts.isStringLiteralLike(child) ||
      ts.isTemplateHead(child) ||
      ts.isTemplateMiddle(child) ||
      ts.isTemplateTail(child)
    ) {
      words.push(...child.text.split(/\s+/))
    }
  })
  return words.filter(Boolean)
}

const renderDe = (ui: ReactElement) =>
  rtlRender(
    <I18nProvider initialLocale="de" fixedLocale>
      {ui}
    </I18nProvider>
  )

describe('a cut text always has a way to read it on touch', () => {
  it('no element truncates while holding its text in a `title`', () => {
    const offenders: string[] = []
    expect(cardSources().length).toBeGreaterThan(0)
    for (const file of cardSources()) {
      const source = parseSource(file)
      const tags = [...nodesOf(source, ts.isJsxOpeningElement), ...nodesOf(source, ts.isJsxSelfClosingElement)]
      for (const tag of tags) {
        const hasTitle = tag.attributes.properties.some(
          (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'title'
        )
        if (hasTitle && classTokens(tag.attributes).includes('truncate')) offenders.push(`${file}:${lineOf(tag)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('`line-clamp` lives in ClampedText only, which opens on a tap', () => {
    expect(cardSources().length).toBeGreaterThan(0)
    const offenders = cardSources().filter((file) => {
      const source = parseSource(file)
      if (exportedNames(source).includes('ClampedText')) return false
      return classTokens(source).some((token) => /\bline-clamp-\d/.test(token))
    })
    expect(offenders).toEqual([])
  })
})

type MemoryProposal = Extract<ProposedChangeView, { kind: 'memory' }>
type ProfileProposal = Extract<ProposedChangeView, { kind: 'project_profile' }>

const NOTE = 'Das Büro setzt bei GK 4 durchgängig REI 90 an.'

const memoryProposal = (patch: Partial<MemoryProposal> = {}): MemoryProposal => ({
  ...proposalBase(),
  kind: 'memory',
  payload: { scope: 'organization', kind: 'preference', content: NOTE, confidence: 'high', supersedes: null },
  ...patch,
})

const PATCH: ProjectProfilePatchOperation[] = [{ op: 'add', path: '/facts/heat_supply', value: 'heat_pump' }]

const profileProposal = (patch: Partial<ProfileProposal> = {}): ProfileProposal => ({
  ...proposalBase(),
  kind: 'project_profile',
  payload: { title: 'Wärmeversorgung festhalten', rationale: 'Sie haben eine Wärmepumpe genannt.', patch: PATCH },
  ...patch,
})

const storedProfile: ProjectProfile = {
  facts: {
    heat_supply: { value: 'gas', confidence: 'confirmed', source: 'onboarding', updatedAt: '2026-01-01T00:00:00.000Z' },
  },
  goals: {},
  unknowns: [],
  assumptions: {},
}

vi.mock('@/features/chat/store', () => {
  const mockStoreState = () => ({
    projectId: 'proj-1',
    currentConversation: { id: 'conv-1', messages: [{ id: 'msg-1', cardInteractions: undefined }] },
    conversations: [],
    setCardDecision: vi.fn(),
  })
  const useChatStore = (selector: (state: ReturnType<typeof mockStoreState>) => unknown) => selector(mockStoreState())
  useChatStore.getState = () => mockStoreState()
  return { useChatStore }
})

vi.mock('@/features/chat/hooks/use-project-facts', () => ({
  invalidateProjectFacts: vi.fn(),
  useProjectFacts: () => null,
}))

beforeEach(() => {
  startRecording()
  server.use(http.get('/api/projects/proj-1/profile', () => HttpResponse.json({ profile: storedProfile, profileVersion: 1 })))
})

afterEach(() => {
  resetKit()
  resetDecidedProposals()
})

const decisionRow = (container: HTMLElement): HTMLElement | undefined => {
  const tokens = DECISION_ROW.split(/\s+/)
  return Array.from(container.querySelectorAll<HTMLElement>('div')).find((element) =>
    tokens.every((token) => element.classList.contains(token))
  )
}

const expectStacked = (container: HTMLElement): void => {
  const row = decisionRow(container)
  expect(row, 'one decision row').toBeDefined()
  const buttons = Array.from(container.querySelectorAll('button'))
  expect(buttons.length).toBeGreaterThan(0)
  for (const button of buttons) {
    expect(row?.contains(button), button.textContent ?? '').toBe(true)
    for (const token of DECISION_BUTTON.split(/\s+/)) expect(button.classList).toContain(token)
  }
}

describe('a proposal’s decision row stacks on a phone', () => {
  it('MemoryProposalCard: one DECISION_ROW, and every button is a DECISION_BUTTON', async () => {
    serve(memoryProposal())
    const { container } = render(
      <MemoryProposalCard
        title="Remember this?"
        content={NOTE}
        kind="preference"
        confidence="high"
        proposalId={PROPOSAL_ID}
        messageId="msg-1"
        cardKey="memory_proposal-0"
      />
    )
    await screen.findByRole('button', { name: 'Apply' })
    expectStacked(container)
    expect(requests.length).toBeGreaterThan(0)
  })

  it('ProjectProfilePatchCard: one DECISION_ROW, and every button is a DECISION_BUTTON', async () => {
    serve(profileProposal())
    const { container } = render(
      <ProjectProfilePatchCard
        title="Update brief"
        rationale="Learned the class."
        patch={PATCH}
        projectId="proj-1"
        proposalId={PROPOSAL_ID}
        messageId="msg-1"
        cardKey="project_profile_patch-0"
      />
    )
    await screen.findByRole('button', { name: 'Apply' })
    expectStacked(container)
  })

  it('ProposalReceipt: one DECISION_ROW, and every button is a DECISION_BUTTON', () => {
    const { container } = renderDe(<ReceiptFixture />)
    expectStacked(container)
  })

  it('ProposalReceipt puts „Übernehmen" before its alternative and before „Verwerfen"', () => {
    renderDe(<ReceiptFixture />)
    const labels = screen.getAllByRole('button').map((button) => button.textContent ?? '')
    const accept = labels.findIndex((label) => label.startsWith('Übernehmen'))
    const alternative = labels.findIndex((label) => label.startsWith('Anlegen stattdessen'))
    const reject = labels.findIndex((label) => label.startsWith('Verwerfen'))
    expect(accept).toBeGreaterThan(-1)
    expect(accept).toBeLessThan(alternative)
    expect(alternative).toBeLessThan(reject)
  })
})

type ReceiptProps = ComponentProps<typeof ProposalReceipt<'memory'>>

function ReceiptFixture(): ReactElement {
  const server: ReceiptProps['server'] = {
    proposal: memoryProposal(),
    problem: null,
    refusalCode: null,
    busy: null,
    overtaken: false,
    decide: async () => {},
  }
  return (
    <ProposalReceipt<'memory'>
      server={server}
      title="Notiz merken?"
      open={null}
      headline={() => 'Notiz merken'}
      alternative={{ label: 'Anlegen stattdessen', working: 'Wird angelegt …', body: {} as ApplyProposalRequest }}
    />
  )
}

describe('KeyTakeawaysCard on a phone', () => {
  it('grows an openable row to the 44px floor under a coarse pointer', () => {
    renderDe(<KeyTakeawaysCard title={null} items={[{ text: 'Brandwand erforderlich', detail: 'Ab GK 4.' }]} />)

    expect(screen.getByRole('button', { name: /Brandwand/ })).toHaveClass('pointer-coarse:py-3')
  })
})

describe('DimChecksList', () => {
  it('wraps the label of the decisive check rather than clipping it', () => {
    const label = 'Lichteinfall 45° — Gegenüberliegendes Gebäude'
    renderDe(
      <DimChecksList
        checks={[{ label, status: 'fail', value: 4.2, required: 6, comparator: '>=', unit: 'm' }]}
      />
    )

    const element = screen.getByText(label)
    expect(element).not.toHaveClass('truncate')
    expect(element.className).toContain('overflow-wrap')
    expect(element).not.toHaveAttribute('title')
  })
})
