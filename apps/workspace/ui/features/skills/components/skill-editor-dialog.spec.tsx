import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test-utils'

vi.mock('@/adapters/api/skills-client', async (importActual) => {
  const actual = await importActual<typeof import('@/adapters/api/skills-client')>()
  return {
    ...actual,
    createSkill: vi.fn(),
    updateSkill: vi.fn(),
    deleteSkill: vi.fn(),
    reviewSkill: vi.fn(),
  }
})

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { toast } from 'sonner'
import * as client from '@/adapters/api/skills-client'
import { SkillEditorDialog } from './skill-editor-dialog'

const createSkillMock = vi.mocked(client.createSkill)
const updateSkillMock = vi.mocked(client.updateSkill)
const deleteSkillMock = vi.mocked(client.deleteSkill)
const reviewSkillMock = vi.mocked(client.reviewSkill)

const STEP_TESTID = { 1: 'skill-step-what', 2: 'skill-step-instructions', 3: 'skill-step-check' }

function goToStep(n: 1 | 2 | 3): void {
  for (let guard = 0; guard < 6; guard += 1) {
    if (screen.queryByTestId(STEP_TESTID[n])) return
    const back = screen.queryByRole('button', { name: new RegExp(`^${n}\\.`) })
    if (back && !back.hasAttribute('disabled')) {
      fireEvent.click(back)
      continue
    }
    const next = screen.queryByTestId('skill-next')
    if (!next) return
    fireEvent.click(next)
  }
}

async function passTheCheck(): Promise<void> {
  fireEvent.click(screen.getByTestId('skill-review-run'))
  await waitFor(() => expect(reviewSkillMock).toHaveBeenCalled())
}

async function reachTheSave(): Promise<void> {
  goToStep(3)
  await passTheCheck()
}

function openAdvanced(): void {
  goToStep(3)
  fireEvent.click(screen.getByTestId('skill-advanced'))
}

const orgSkill: client.SkillListItem = {
  id: 'skill-1',
  name: 'acoustic-report',
  description: 'Drafts the acoustic compliance report.',
  body: 'Draft a report on sound insulation per OIB Richtlinie 5.',
  metadata: { 'grid-execution': 'deep-research', 'grid-agents': 'voice-ana' },
  origin: 'org',
  enabled: true,
  clonedFrom: null,
  categoryId: null,
  createdAt: '2026-07-16T00:00:00Z',
  updatedAt: '2026-07-16T00:00:00Z',
}

const noop = () => {}

const dialogProps = {
  open: true,
  onOpenChange: noop,
  onSaved: noop,
}

describe('SkillEditorDialog — create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reviewSkillMock.mockResolvedValue({ findings: [] })
  })

  test('renders the authoring form and validates the name shape', async () => {
    render(<SkillEditorDialog {...dialogProps} skill={null} />)

    expect(screen.getByText('New skill')).toBeInTheDocument()
    expect(
      screen.queryByText(
        'Skill names must be lowercase a-z/0-9 separated by single hyphens (no leading, trailing or consecutive hyphens).',
      ),
    ).not.toBeInTheDocument()

    const name = screen.getByLabelText(/^Name/)
    fireEvent.change(name, { target: { value: 'UPPER CASE' } })
    fireEvent.blur(name)

    await waitFor(() =>
      expect(
        screen.getByText(
          'Skill names must be lowercase a-z/0-9 separated by single hyphens (no leading, trailing or consecutive hyphens).',
        ),
      ).toBeInTheDocument(),
    )
  })

  test('creating sends the deterministic default metadata and calls createSkill', async () => {
    createSkillMock.mockResolvedValue(orgSkill)
    render(<SkillEditorDialog {...dialogProps} skill={null} />)

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'oib-fire-check' } })
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: 'Checks fire-safety guidelines.' },
    })
    goToStep(2)
    fireEvent.change(screen.getByLabelText(/^Instruction/), {
      target: { value: 'Act as a fire-safety reviewer.' },
    })

    await reachTheSave()
    const saveButton = screen.getByRole('button', { name: 'Save skill' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(createSkillMock).toHaveBeenCalledTimes(1))
    const payload = createSkillMock.mock.calls[0][0]
    expect(payload.name).toBe('oib-fire-check')
    expect(payload.body).toBe('Act as a fire-safety reviewer.')
    expect(payload.clonedFrom).toBeUndefined()
    expect(payload.metadata).toEqual({})
    expect(payload.enabled).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('Skill created.')
  })

  test('offers nothing that decides whether the model may pick the skill', () => {
    render(<SkillEditorDialog {...dialogProps} skill={null} />)
    expect(screen.queryByRole('switch', { name: /may pick/i })).not.toBeInTheDocument()
  })

  test('turning hidden on writes grid-hidden true', async () => {
    createSkillMock.mockResolvedValue(orgSkill)
    render(<SkillEditorDialog {...dialogProps} skill={null} />)

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'house-voice' } })
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: 'How an agent answer is built.' },
    })
    goToStep(2)
    fireEvent.change(screen.getByLabelText(/^Instruction/), {
      target: { value: 'Answer first, caveats after.' },
    })

    openAdvanced()
    expect(screen.getByRole('switch', { name: 'Keep off the live line' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('switch', { name: 'Keep off the live line' }))

    await reachTheSave()
    const saveButton = screen.getByRole('button', { name: 'Save skill' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(createSkillMock).toHaveBeenCalledTimes(1))
    expect(createSkillMock.mock.calls[0][0].metadata).toEqual({
      'grid-hidden': 'true',
    })
  })

  test('offers nothing about time or output — that belongs to a job', async () => {
    render(<SkillEditorDialog {...dialogProps} skill={null} />)

    expect(screen.queryByRole('combobox', { name: 'Output' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Schedulable' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Deep-research report/)).not.toBeInTheDocument()
  })

  test('both agents is the default, and the default writes no grid-agents key', async () => {
    createSkillMock.mockResolvedValue(orgSkill)
    render(<SkillEditorDialog {...dialogProps} skill={null} />)

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'oib-fire-check' } })
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Checks stuff.' } })
    goToStep(2)
    fireEvent.change(screen.getByLabelText(/^Instruction/), { target: { value: 'Review it.' } })

    openAdvanced()
    expect(screen.getByRole('checkbox', { name: /Chat agent/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Deep research agent/ })).toBeChecked()

    await reachTheSave()
    const saveButton = screen.getByRole('button', { name: 'Save skill' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(createSkillMock).toHaveBeenCalledTimes(1))
    expect(createSkillMock.mock.calls[0][0].metadata).not.toHaveProperty('grid-agents')
  })

  test('narrowing the scope writes grid-agents, and the last agent cannot be removed', async () => {
    createSkillMock.mockResolvedValue(orgSkill)
    render(<SkillEditorDialog {...dialogProps} skill={null} />)

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'sandbox-writer' } })
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Writes files.' } })
    goToStep(2)
    fireEvent.change(screen.getByLabelText(/^Instruction/), { target: { value: 'Use execute.' } })

    openAdvanced()
    fireEvent.click(screen.getByRole('checkbox', { name: /Chat agent/ }))

    const remaining = screen.getByRole('checkbox', { name: /Deep research agent/ })
    expect(remaining).toBeDisabled()

    await waitFor(() =>
      expect(screen.getByText(/grid-agents: deep_researcher/)).toBeInTheDocument(),
    )

    await reachTheSave()
    const saveButton = screen.getByRole('button', { name: 'Save skill' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(createSkillMock).toHaveBeenCalledTimes(1))
    expect(createSkillMock.mock.calls[0][0].metadata).toEqual({
      'grid-agents': 'deep_researcher',
    })
  })

  test('picked output cards land in grid-cards and in the SKILL.md preview', async () => {
    createSkillMock.mockResolvedValue(orgSkill)
    render(<SkillEditorDialog {...dialogProps} skill={null} />)

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'oib-fire-check' } })
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: 'Checks fire-safety guidelines.' },
    })
    goToStep(2)
    fireEvent.change(screen.getByLabelText(/^Instruction/), {
      target: { value: 'Act as a fire-safety reviewer.' },
    })

    openAdvanced()
    expect(
      screen.getByText('No preference — the agent picks the card that fits the answer.'),
    ).toBeInTheDocument()

    const search = screen.getByLabelText('Search cards, e.g. comparison or escape route')
    fireEvent.change(search, { target: { value: 'staircase' } })
    fireEvent.click(screen.getByRole('button', { name: /^stair_diagram/ }))

    await waitFor(() =>
      expect(screen.getByText(/grid-cards: stair_diagram/)).toBeInTheDocument(),
    )

    await reachTheSave()
    const saveButton = screen.getByRole('button', { name: 'Save skill' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(createSkillMock).toHaveBeenCalledTimes(1))
    expect(createSkillMock.mock.calls[0][0].metadata).toEqual({
      'grid-cards': 'stair_diagram',
    })
  })

  test('the picker never offers a system card type', () => {
    render(<SkillEditorDialog {...dialogProps} skill={null} />)

    openAdvanced()
    const search = screen.getByLabelText('Search cards, e.g. comparison or escape route')
    for (const systemCard of ['memory_proposal', 'document_grid']) {
      fireEvent.change(search, { target: { value: systemCard } })
      expect(screen.getByText('No card matches that search.')).toBeInTheDocument()
    }
  })

  test('authoring never marks a skill as a copy of something else', async () => {
    createSkillMock.mockResolvedValue(orgSkill)
    render(<SkillEditorDialog {...dialogProps} skill={null} />)

    expect(screen.getByRole('heading', { name: 'New skill' })).toBeInTheDocument()
    expect(screen.queryByText(/clone/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'oib-fire-check' } })
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: 'Checks fire-safety guidelines.' },
    })
    goToStep(2)
    fireEvent.change(screen.getByLabelText(/^Instruction/), {
      target: { value: 'Act as a fire-safety reviewer.' },
    })

    await reachTheSave()
    const saveButton = screen.getByRole('button', { name: 'Save skill' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(createSkillMock).toHaveBeenCalledTimes(1))
    expect(createSkillMock.mock.calls[0][0].clonedFrom).toBeUndefined()
  })

  test('a save failure surfaces inline and as an error toast', async () => {
    createSkillMock.mockRejectedValue(new Error('boom'))
    render(<SkillEditorDialog {...dialogProps} skill={null} />)

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'oib-fire-check' } })
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: 'Checks fire-safety guidelines.' },
    })
    goToStep(2)
    fireEvent.change(screen.getByLabelText(/^Instruction/), {
      target: { value: 'Act as a fire-safety reviewer.' },
    })

    await reachTheSave()
    const saveButton = screen.getByRole('button', { name: 'Save skill' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The skill could not be saved.'))
    expect(screen.getByText('The skill could not be saved.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save skill' })).toBeEnabled()
  })
})

describe('SkillEditorDialog — edit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reviewSkillMock.mockResolvedValue({ findings: [] })
  })

  test('prefills every field and preserves opaque metadata on save', async () => {
    updateSkillMock.mockResolvedValue(orgSkill)
    render(<SkillEditorDialog {...dialogProps} skill={orgSkill} />)

    expect(screen.getByRole('heading', { name: 'Edit skill' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Name/)).toHaveValue('acoustic-report')
    expect(screen.getByLabelText(/^Description/)).toHaveValue('Drafts the acoustic compliance report.')
    openAdvanced()
    expect(screen.getByRole('checkbox', { name: /Chat agent/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Deep research agent/ })).toBeChecked()

    await reachTheSave()
    const saveButton = screen.getByRole('button', { name: 'Save skill' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(updateSkillMock).toHaveBeenCalledTimes(1))
    const [skillId, payload] = updateSkillMock.mock.calls[0]
    expect(skillId).toBe('skill-1')
    expect(payload.metadata).toEqual({
      'grid-execution': 'deep-research',
      'grid-agents': 'voice-ana',
    })
    expect(toast.success).toHaveBeenCalledWith('Skill saved.')
  })

  test('offers the categories in a picker and saves the pick', async () => {
    updateSkillMock.mockResolvedValue(orgSkill)
    const user = (await import('@testing-library/user-event')).default.setup()
    render(
      <SkillEditorDialog
        {...dialogProps}
        skill={orgSkill}
        categories={[
          { id: 'cat-1', name: 'Recherche', description: null, slug: 'research', sortOrder: 0, scope: 'platform' },
        ]}
      />,
    )

    openAdvanced()
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('Unsorted')
    await user.click(screen.getByRole('combobox', { name: 'Category' }))
    await user.click(screen.getByRole('option', { name: 'Recherche' }))

    await reachTheSave()
    const saveButton = screen.getByRole('button', { name: 'Save skill' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(updateSkillMock).toHaveBeenCalledTimes(1))
    expect(updateSkillMock.mock.calls[0][1]).toHaveProperty('categoryId', 'cat-1')
  })

  test('creating without a pick omits the category', async () => {
    createSkillMock.mockResolvedValue(orgSkill)
    render(<SkillEditorDialog {...dialogProps} skill={null} />)

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'oib-fire-check' } })
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: 'Checks fire-safety guidelines.' },
    })
    goToStep(2)
    fireEvent.change(screen.getByLabelText(/^Instruction/), {
      target: { value: 'Act as a fire-safety reviewer.' },
    })

    await reachTheSave()
    const saveButton = screen.getByRole('button', { name: 'Save skill' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(createSkillMock).toHaveBeenCalledTimes(1))
    expect(createSkillMock.mock.calls[0][0]).not.toHaveProperty('categoryId')
  })

  test('carries a stored grid-auto-invoke through untouched, and shows no control for it', async () => {
    updateSkillMock.mockResolvedValue(orgSkill)
    render(
      <SkillEditorDialog
        {...dialogProps}
        skill={{
          ...orgSkill,
          metadata: {
            ...orgSkill.metadata,
            'grid-auto-invoke': 'false',
            'grid-hidden': 'true',
          },
        }}
      />,
    )

    expect(screen.queryByRole('switch', { name: /may pick/i })).not.toBeInTheDocument()
    openAdvanced()
    expect(screen.getByRole('switch', { name: 'Keep off the live line' })).toBeChecked()

    await reachTheSave()
    const saveButton = screen.getByRole('button', { name: 'Save skill' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(updateSkillMock).toHaveBeenCalledTimes(1))
    expect(updateSkillMock.mock.calls[0][1].metadata).toEqual({
      'grid-execution': 'deep-research',
      'grid-agents': 'voice-ana',
      'grid-auto-invoke': 'false',
      'grid-hidden': 'true',
    })
  })

  test('prefills the card chips and drops the key when the last one is removed', async () => {
    updateSkillMock.mockResolvedValue(orgSkill)
    render(
      <SkillEditorDialog
        {...dialogProps}
        skill={{ ...orgSkill, metadata: { ...orgSkill.metadata, 'grid-cards': 'calculation' } }}
      />,
    )

    openAdvanced()
    expect(screen.getByText(/Rechenweg/)).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove card type “calculation” from the preference' }),
    )

    await reachTheSave()
    const saveButton = screen.getByRole('button', { name: 'Save skill' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(updateSkillMock).toHaveBeenCalledTimes(1))
    expect(updateSkillMock.mock.calls[0][1].metadata).toEqual({
      'grid-execution': 'deep-research',
      'grid-agents': 'voice-ana',
    })
  })

  test('the advanced section rewrites every field from a pasted document', async () => {
    updateSkillMock.mockResolvedValue(orgSkill)
    render(<SkillEditorDialog {...dialogProps} skill={orgSkill} />)

    goToStep(2)
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))

    fireEvent.change(await screen.findByLabelText('SKILL.md document'), {
      target: {
        value: [
          '---',
          'name: geaenderter-skill',
          'description: A pasted description that says when to use it.',
          'metadata:',
          '  grid-execution: chat',
          '  grid-cards: calculation',
          '---',
          '',
          '# Pasted',
          '',
          'Do the pasted thing.',
        ].join('\n'),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(screen.getByLabelText(/^Instruction/)).toHaveValue('# Pasted\n\nDo the pasted thing.')
    goToStep(1)
    await waitFor(() => expect(screen.getByLabelText(/^Name/)).toHaveValue('geaenderter-skill'))
    expect(screen.getByLabelText(/^Description/)).toHaveValue(
      'A pasted description that says when to use it.',
    )
    openAdvanced()
    expect(screen.getByRole('checkbox', { name: /Chat agent/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Deep research agent/ })).toBeChecked()
    expect(screen.getByText(/Rechenweg/)).toBeInTheDocument()

    await reachTheSave()
    const saveButton = screen.getByRole('button', { name: 'Save skill' })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(updateSkillMock).toHaveBeenCalledTimes(1))
    expect(updateSkillMock.mock.calls[0][1].metadata).toEqual({
      'grid-execution': 'chat',
      'grid-cards': 'calculation',
    })
  })

  test('a document that does not parse applies nothing', async () => {
    render(<SkillEditorDialog {...dialogProps} skill={orgSkill} />)

    goToStep(2)
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))
    fireEvent.change(await screen.findByLabelText('SKILL.md document'), {
      target: { value: 'no frontmatter here' },
    })

    expect(
      screen.getByText(
        'The document does not start with a “---” block. A SKILL.md always opens with YAML frontmatter.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    goToStep(1)
    expect(screen.getByLabelText(/^Name/)).toHaveValue('acoustic-report')
  })

  test('the delete flow removes the skill after confirmation', async () => {
    deleteSkillMock.mockResolvedValue()
    const onSaved = vi.fn()
    render(<SkillEditorDialog {...dialogProps} skill={orgSkill} onSaved={onSaved} />)

    goToStep(3)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete skill' }))

    await waitFor(() => expect(deleteSkillMock).toHaveBeenCalledWith('skill-1'))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })
})

describe('the skill check gates the save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reviewSkillMock.mockResolvedValue({ findings: [] })
  })

  const fill = (): void => {
    goToStep(1)
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'einreichcheck' } })
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: 'Was diesem Bauansuchen noch fehlt.' },
    })
    goToStep(2)
    fireEvent.change(screen.getByLabelText(/^Instruction/), {
      target: { value: 'Walk the missing Unterlagen.' },
    })
    goToStep(3)
  }

  test('a complete, valid draft still cannot be saved until it has been checked', () => {
    render(<SkillEditorDialog {...dialogProps} skill={null} />)
    fill()
    expect(screen.getByRole('button', { name: 'Save skill' })).toBeDisabled()
    expect(screen.getByTestId('skill-review-required')).toBeInTheDocument()
  })

  test('running the check opens the save', async () => {
    render(<SkillEditorDialog {...dialogProps} skill={null} />)
    fill()
    await passTheCheck()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save skill' })).toBeEnabled())
  })

  test('findings do not block the save — the author weighs them', async () => {
    reviewSkillMock.mockResolvedValue({
      findings: [
        {
          severity: 'error',
          field: 'description',
          message: 'Says nothing about when to use it.',
          fix: 'Name the situation it answers.',
        },
      ],
    })
    render(<SkillEditorDialog {...dialogProps} skill={null} />)
    fill()
    await passTheCheck()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save skill' })).toBeEnabled())
  })

  test('a reviewer that could not run blocks nothing', async () => {
    reviewSkillMock.mockResolvedValue({ findings: null })
    render(<SkillEditorDialog {...dialogProps} skill={null} />)
    fill()
    await passTheCheck()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save skill' })).toBeEnabled())
  })

  test('editing after a check closes the gate again', async () => {
    render(<SkillEditorDialog {...dialogProps} skill={null} />)
    fill()
    await passTheCheck()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save skill' })).toBeEnabled())

    goToStep(1)
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: 'Etwas ganz anderes.' },
    })
    goToStep(3)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save skill' })).toBeDisabled())
    expect(screen.getByTestId('skill-review-stale')).toBeInTheDocument()
  })
})

describe('SkillEditorDialog — closing with unsaved work', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reviewSkillMock.mockResolvedValue({ findings: [] })
  })

  test('a clean form closes at once, with nothing asked', () => {
    const onOpenChange = vi.fn()
    render(<SkillEditorDialog {...dialogProps} onOpenChange={onOpenChange} skill={null} />)

    fireEvent.click(screen.getByTestId('skill-back'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument()
  })

  test('Cancel, Escape and the close X all ask before throwing typed work away', async () => {
    const onOpenChange = vi.fn()
    render(<SkillEditorDialog {...dialogProps} onOpenChange={onOpenChange} skill={null} />)
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'oib-fire-check' } })

    fireEvent.click(screen.getByTestId('skill-back'))
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument())
    expect(screen.getByLabelText(/^Name/)).toHaveValue('oib-fire-check')

    fireEvent.keyDown(screen.getByLabelText(/^Name/), { key: 'Escape' })
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('typing a letter and deleting it again is not a change', () => {
    const onOpenChange = vi.fn()
    render(<SkillEditorDialog {...dialogProps} onOpenChange={onOpenChange} skill={null} />)
    const name = screen.getByLabelText(/^Name/)
    fireEvent.change(name, { target: { value: 'a' } })
    fireEvent.change(name, { target: { value: '' } })

    fireEvent.click(screen.getByTestId('skill-back'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('the editor is a full-screen sheet on a phone, clear of the notch and the home indicator', () => {
    render(<SkillEditorDialog {...dialogProps} skill={null} />)
    const content = screen.getByRole('dialog')
    expect(content).toHaveAttribute('data-mobile-presentation', 'fullscreen')
    expect(content.className).toMatch(/phone:pt-\[env\(safe-area-inset-top\)\]/)
    expect(content.className).toMatch(/phone:pb-\[env\(safe-area-inset-bottom\)\]/)
  })
})
