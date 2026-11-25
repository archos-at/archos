import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, test, expect } from 'vitest'
import { ConfidenceChip } from './ConfidenceChip'
import { PRODUCT_NAME } from '@/lib/brand'

describe('ConfidenceChip', () => {
  test('renders nothing when confidence is absent', () => {
    const { container } = render(<ConfidenceChip confidence={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('renders the chip label for a self-assessed level', () => {
    render(<ConfidenceChip confidence="low" />)
    expect(screen.getByText('Confidence: low')).toBeInTheDocument()
  })

  test('shows the ungrounded reason in the tooltip when capped for grounding', async () => {
    const user = userEvent.setup()
    render(<ConfidenceChip confidence="low" cappedReason="ungrounded" />)

    await user.hover(screen.getByRole('button'))

    expect(
      (await screen.findAllByText(/Low confidence: answer not backed by sources\./)).length
    ).toBeGreaterThan(0)
  })

  test('shows the quote-unverified reason in the tooltip when a quote could not be verified', async () => {
    const user = userEvent.setup()
    render(<ConfidenceChip confidence="medium" cappedReason="quote_unverified" />)

    await user.hover(screen.getByRole('button'))

    expect(
      (
        await screen.findAllByText(
          /A quote could not be verified verbatim against the source; the assessment is capped accordingly\./
        )
      ).length
    ).toBeGreaterThan(0)
  })

  test("labels the model's reason as the one it gave before the cap", async () => {
    const user = userEvent.setup()
    render(
      <ConfidenceChip
        confidence="medium"
        cappedReason="quote_unverified"
        reason="Every claim is backed by the cited paragraph."
      />
    )

    await user.hover(screen.getByRole('button'))

    expect((await screen.findAllByText(/Assistant's reason before the cap:/)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Assistant's reason:$/)).not.toBeInTheDocument()
  })

  test("labels the model's reason plainly when nothing capped it", async () => {
    const user = userEvent.setup()
    render(<ConfidenceChip confidence="high" reason="Directly stated in the cited paragraph." />)

    await user.hover(screen.getByRole('button'))

    expect((await screen.findAllByText(/Assistant's reason:/)).length).toBeGreaterThan(0)
  })

  test('falls back to the generic tooltip when no reason is present', async () => {
    const user = userEvent.setup()
    render(<ConfidenceChip confidence="high" />)

    await user.hover(screen.getByRole('button'))

    expect((await screen.findAllByText(/It can be wrong\./)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Low confidence:/)).not.toBeInTheDocument()
  })

  test('shows the level meaning in the tooltip', async () => {
    const user = userEvent.setup()
    render(<ConfidenceChip confidence="high" />)

    await user.hover(screen.getByRole('button'))

    expect((await screen.findAllByText(/directly grounded in the retrieved sources/)).length)
      .toBeGreaterThan(0)
  })

  test("shows the model's own reason verbatim in the tooltip when present", async () => {
    const user = userEvent.setup()
    render(<ConfidenceChip confidence="medium" reason="Keine Quelle zur Sonderregel" />)

    await user.hover(screen.getByRole('button'))

    expect((await screen.findAllByText(/Assistant's reason/)).length).toBeGreaterThan(0)
    expect((await screen.findAllByText(/Keine Quelle zur Sonderregel/)).length).toBeGreaterThan(0)
  })

  test('shows no reason block when reason is absent', async () => {
    const user = userEvent.setup()
    render(<ConfidenceChip confidence="medium" />)

    await user.hover(screen.getByRole('button'))

    expect((await screen.findAllByText(/It can be wrong\./)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Assistant's reason/)).not.toBeInTheDocument()
  })
})

describe('ConfidenceChip on a stored per-sentence turn (ADR-0125)', () => {
  test('keeps the copy of the rule it was stored under', async () => {
    const user = userEvent.setup()
    render(<ConfidenceChip confidence="low" cappedReason="normative_claim_uncited" version={2} />)

    await user.hover(screen.getByRole('button'))

    expect(
      (await screen.findAllByText(/A workspace record or a measurement does not back a legal statement\./)).length
    ).toBeGreaterThan(0)
    expect((await screen.findAllByText(/held to the weakest statement/)).length).toBeGreaterThan(0)
  })
})

describe('ConfidenceChip for a checked answer (ADR-0139)', () => {
  const finding = {
    statement: 'The stair is 1.50 m wide',
    problem: 'contradicted',
    reason: 'the section gives 1.10 m',
    source: '[1] Section A-A.pdf, p.2',
  } as const

  test('names what the check found, and the source it checked against', async () => {
    const user = userEvent.setup()
    render(
      <ConfidenceChip
        confidence="low"
        reason="Everything is backed."
        version={2}
        check={{ status: 'judged', level: 'low', findings: [finding], sourcesChecked: 3 }}
      />
    )

    expect(screen.getByRole('button')).toHaveAccessibleName('Source check of the answer: low')
    await user.hover(screen.getByRole('button'))

    const findings = (await screen.findAllByTestId('confidence-check-findings'))[0]
    expect(findings).toHaveTextContent('The stair is 1.50 m wide')
    expect(findings).toHaveTextContent('The source says something else: the section gives 1.10 m')
    expect(findings).toHaveTextContent('Checked against [1] Section A-A.pdf, p.2')
    expect((await screen.findAllByTestId('confidence-check-scope'))[0]).toHaveTextContent(
      '3 cited sources checked.'
    )
    expect(screen.queryByText(/Everything is backed\./)).not.toBeInTheDocument()
  })

  test('tells a silent source from a statement of law without a citation', async () => {
    const user = userEvent.setup()
    const silent = {
      statement: 'Treppe 1,20 m',
      problem: 'unbacked',
      reason: '',
      source: '[2] OIB-RL 4',
    } as const
    const law = {
      statement: 'Ein Handlauf ist Pflicht',
      problem: 'unbacked',
      reason: '',
      source: 'none',
    } as const
    render(
      <ConfidenceChip
        confidence="medium"
        check={{
          status: 'judged',
          level: 'medium',
          findings: [silent, law],
          sourcesChecked: 1,
        }}
      />
    )

    await user.hover(screen.getByRole('button'))

    const findings = (await screen.findAllByTestId('confidence-check-findings'))[0]
    const silentLine = within(findings).getByText('„Treppe 1,20 m“').parentElement
    const lawLine = within(findings).getByText('„Ein Handlauf ist Pflicht“').parentElement
    expect(silentLine).toHaveTextContent('The source says nothing about it')
    expect(silentLine).toHaveTextContent('Checked against [2] OIB-RL 4')
    expect(lawLine).toHaveTextContent('Statement of law without a citation')
    expect(lawLine).not.toHaveTextContent('Checked against')
  })

  test('says the level is the assistant’s own when nothing was cited', async () => {
    const user = userEvent.setup()
    render(
      <ConfidenceChip
        confidence="high"
        check={{ status: 'judged', level: 'high', findings: [], sourcesChecked: 0 }}
      />
    )

    await user.hover(screen.getByRole('button'))

    expect(
      (await screen.findAllByText("The answer cites no source. The level is the assistant's own assessment.")).length
    ).toBeGreaterThan(0)
    expect(screen.queryByText(/^High:/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('confidence-check-scope')).not.toBeInTheDocument()
  })

  test('with nothing cited, a statement of law without a citation still explains the level', async () => {
    const user = userEvent.setup()
    render(
      <ConfidenceChip
        confidence="medium"
        check={{
          status: 'judged',
          level: 'medium',
          findings: [{ statement: 'Ein Handlauf ist Pflicht', problem: 'unbacked', reason: '', source: 'none' }],
          sourcesChecked: 0,
        }}
      />
    )

    await user.hover(screen.getByRole('button'))

    expect((await screen.findAllByText(/^Medium: a source says nothing/)).length).toBeGreaterThan(0)
    expect((await screen.findAllByTestId('confidence-check-scope'))[0]).toHaveTextContent('No source cited.')
    expect(screen.queryByText(/The level is the assistant's own assessment/)).not.toBeInTheDocument()
  })

  test('a check made under the old rule shows its level and no findings', async () => {
    const user = userEvent.setup()
    render(
      <ConfidenceChip
        confidence="low"
        check={{ status: 'judged', level: 'low', findings: [finding] }}
      />
    )

    expect(screen.getByRole('button')).toHaveAccessibleName('Evidence check of the answer: low')
    await user.hover(screen.getByRole('button'))

    expect(screen.queryByTestId('confidence-check-findings')).not.toBeInTheDocument()
  })

  test('says when a quote the server could not find capped the level', async () => {
    const user = userEvent.setup()
    render(
      <ConfidenceChip
        confidence="medium"
        cappedReason="quote_unverified"
        check={{ status: 'judged', level: 'high', findings: [] }}
      />
    )

    await user.hover(screen.getByRole('button'))

    expect((await screen.findAllByText(/A quotation could not be confirmed word for word/)).length).toBeGreaterThan(0)
    expect(screen.queryByTestId('confidence-check-findings')).not.toBeInTheDocument()
  })

  test('says when building law the records do not settle capped the level (ADR-0175)', async () => {
    const user = userEvent.setup()
    render(
      <ConfidenceChip
        confidence="medium"
        cappedReason="law_unsettled"
        check={{ status: 'judged', level: 'high', findings: [] }}
      />
    )

    await user.hover(screen.getByRole('button'))

    expect((await screen.findAllByText(/Which edition binds at this site is not yet settled/)).length).toBeGreaterThan(0)
  })

  test('says when an open point the answer names itself capped the level', async () => {
    const user = userEvent.setup()
    render(
      <ConfidenceChip
        confidence="medium"
        cappedReason="open_point"
        reason="Bindung der OIB-RL 2 nicht an der Quelle geprüft"
        check={{ status: 'judged', level: 'high', findings: [] }}
      />
    )

    await user.hover(screen.getByRole('button'))

    expect((await screen.findAllByText(/Capped by the answer itself: an open point it names/)).length).toBeGreaterThan(0)
  })

  test('an unavailable check shows no level and says the check did not run', async () => {
    const user = userEvent.setup()
    render(<ConfidenceChip confidence={null} check={{ status: 'unavailable', findings: [] }} />)

    expect(screen.getByTestId('confidence-check-unavailable')).toHaveTextContent('Evidence check unavailable')
    expect(screen.queryByText(/Confidence:/)).not.toBeInTheDocument()
    await user.hover(screen.getByRole('button'))
    expect((await screen.findAllByText(new RegExp(String.raw`so ${PRODUCT_NAME} shows no level`))).length).toBeGreaterThan(0)
  })
})
