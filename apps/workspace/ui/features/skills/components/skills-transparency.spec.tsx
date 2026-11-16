import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InvokedSkillChip } from './InvokedSkillChip'
import { SkillsUsedDisclosure } from './SkillsUsedDisclosure'

vi.mock('@/i18n', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
  useLocale: () => 'en',
}))

const listInvocableSkills = vi.fn()
vi.mock('@/adapters/api/skills-client', () => ({
  listInvocableSkills: (...args: unknown[]) => listInvocableSkills(...args),
}))

beforeEach(() => {
  listInvocableSkills.mockReset()
  listInvocableSkills.mockResolvedValue([
    { name: 'oib-brandschutz', description: 'Prüft Brandschutz nach OIB-RL 2.', origin: 'org' },
  ])
})

describe('InvokedSkillChip', () => {
  it('names the skill and states the consequence, not just the name', () => {
    render(
      <InvokedSkillChip name="oib-brandschutz" description="Prüft Brandschutz nach OIB-RL 2." />,
    )
    expect(screen.getByTestId('invoked-skill-chip')).toBeInTheDocument()
    expect(screen.getByText('composer.invoked.label')).toBeInTheDocument()
    expect(screen.getByText('/oib-brandschutz')).toBeInTheDocument()
    expect(screen.getByText('Prüft Brandschutz nach OIB-RL 2.')).toBeInTheDocument()
    expect(screen.getByText('composer.invoked.hint')).toBeInTheDocument()
  })

  it('offers removal only where the composer can be edited', () => {
    const onRemove = vi.fn()
    const { rerender } = render(
      <InvokedSkillChip name="oib-brandschutz" description="d" onRemove={onRemove} />,
    )
    expect(screen.getByRole('button')).toBeInTheDocument()

    rerender(<InvokedSkillChip name="oib-brandschutz" description="d" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('SkillsUsedDisclosure', () => {
  it('renders nothing when the turn activated no skills', () => {
    const { container } = render(<SkillsUsedDisclosure skillsActivated={[]} />)
    expect(container).toBeEmptyDOMElement()

    const { container: none } = render(<SkillsUsedDisclosure />)
    expect(none).toBeEmptyDOMElement()
  })

  it('summarises without fetching anything until it is opened', () => {
    render(<SkillsUsedDisclosure skillsActivated={['oib-brandschutz']} />)
    expect(screen.getByTestId('skills-used-trigger')).toHaveTextContent('composer.activated.one')
    expect(listInvocableSkills).not.toHaveBeenCalled()
  })

  it('pluralises on the count', () => {
    render(<SkillsUsedDisclosure skillsActivated={['a', 'b']} />)
    expect(screen.getByTestId('skills-used-trigger')).toHaveTextContent('composer.activated.other:2')
  })

  it('explains the mechanism and names the skills once opened', async () => {
    const user = userEvent.setup()
    render(<SkillsUsedDisclosure skillsActivated={['oib-brandschutz']} />)

    await user.click(screen.getByTestId('skills-used-trigger'))

    const panel = await screen.findByTestId('skills-used-panel')
    expect(panel).toHaveTextContent('oib-brandschutz')
    expect(panel).toHaveTextContent('composer.activated.explainer')
    expect(listInvocableSkills).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Prüft Brandschutz nach OIB-RL 2.')).toBeInTheDocument()
  })

  it('names a hidden skill that ran rather than dropping it, but de-emphasised', async () => {
    const user = userEvent.setup()
    render(
      <SkillsUsedDisclosure
        skillsActivated={['oib-brandschutz', 'piloti-voice']}
        hiddenSkills={['piloti-voice']}
      />,
    )
    await user.click(screen.getByTestId('skills-used-trigger'))

    const panel = await screen.findByTestId('skills-used-panel')
    expect(panel).toHaveTextContent('oib-brandschutz')
    expect(panel).toHaveTextContent('piloti-voice')
    const hiddenRow = screen.getByTestId('skills-used-hidden-row')
    expect(hiddenRow).toHaveTextContent('piloti-voice')
    expect(hiddenRow.className).toContain('opacity-60')
  })

  it('surfaces a hidden skill at full weight once the reasoning view is on', async () => {
    const user = userEvent.setup()
    render(
      <SkillsUsedDisclosure
        skillsActivated={['piloti-voice']}
        hiddenSkills={['piloti-voice']}
        showReasoning
      />,
    )
    await user.click(screen.getByTestId('skills-used-trigger'))

    const hiddenRow = screen.getByTestId('skills-used-hidden-row')
    expect(hiddenRow).toHaveTextContent('piloti-voice')
    expect(hiddenRow.className).not.toContain('opacity-60')
  })

  it('keeps a row whose skill can no longer be described', async () => {
    listInvocableSkills.mockResolvedValue([])
    const user = userEvent.setup()
    render(<SkillsUsedDisclosure skillsActivated={['gone-since']} />)

    await user.click(screen.getByTestId('skills-used-trigger'))
    expect(await screen.findByTestId('skills-used-panel')).toHaveTextContent('gone-since')
  })
})
