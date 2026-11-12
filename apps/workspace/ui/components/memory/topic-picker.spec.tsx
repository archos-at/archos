/**
 * TopicPicker (ADR-0180): the field offers the shelf's topics and takes what is
 * typed through the shelf's spelling. What must hold: a name typed in another
 * case lands in the topic the shelf already has, a name over the topic bound
 * says so and takes nothing, "no topic" is an option of its own, and a choice
 * the note already has calls nothing.
 */
import { describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test-utils'
import { TopicPicker } from './topic-picker'

const TOPICS = ['Brandschutz', 'Stellplätze']

const field = (): HTMLElement => screen.getByRole('combobox', { name: 'Topic' })

describe('TopicPicker', () => {
  test('with the field empty it offers no topic first, then every topic of the shelf', async () => {
    render(<TopicPicker topics={TOPICS} value={null} onChange={vi.fn()} />)

    await userEvent.click(field())
    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['No topic', 'Brandschutz', 'Stellplätze'])
  })

  test('typing offers only the topics that match, ignoring case', async () => {
    render(<TopicPicker topics={TOPICS} value={null} onChange={vi.fn()} />)

    await userEvent.type(field(), 'STELL')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Stellplätze'])
  })

  test('picking an offered topic hands its shelf spelling to the caller', async () => {
    const onChange = vi.fn()
    render(<TopicPicker topics={TOPICS} value={null} onChange={onChange} />)

    await userEvent.type(field(), 'stell')
    await userEvent.click(screen.getByRole('option', { name: 'Stellplätze' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Stellplätze')
  })

  test('a name typed in another case takes the shelf’s topic instead of a second one', async () => {
    const onChange = vi.fn()
    render(<TopicPicker topics={TOPICS} value={null} onChange={onChange} />)

    await userEvent.type(field(), 'brandschutz{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Brandschutz')
  })

  test('a new name is taken as typed, once it is left', async () => {
    const onChange = vi.fn()
    render(<TopicPicker topics={TOPICS} value={null} onChange={onChange} />)

    await userEvent.type(field(), '  Fluchtwege   Plan ')
    await userEvent.tab()
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Fluchtwege Plan')
  })

  test('a name over the topic bound says so and takes nothing', async () => {
    const onChange = vi.fn()
    render(<TopicPicker topics={TOPICS} value={null} onChange={onChange} />)

    await userEvent.type(field(), 'x'.repeat(41))
    expect(screen.getByText('At most 40 characters.')).toBeInTheDocument()
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    await userEvent.keyboard('{Enter}')
    expect(onChange).not.toHaveBeenCalled()
  })

  test('clearing the field and picking no topic clears the note’s topic', async () => {
    const onChange = vi.fn()
    render(<TopicPicker topics={TOPICS} value="Brandschutz" onChange={onChange} />)

    await userEvent.clear(field())
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'No topic' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
  })

  test('leaving the field on the note’s own topic calls nothing', async () => {
    const onChange = vi.fn()
    render(<TopicPicker topics={TOPICS} value="Brandschutz" onChange={onChange} />)

    await userEvent.click(field())
    await userEvent.keyboard('{Enter}')
    await userEvent.tab()
    expect(onChange).not.toHaveBeenCalled()
  })

  test('compact: the note’s button says “Move to …” and shows no field until it is pressed', () => {
    render(<TopicPicker topics={TOPICS} value={null} onChange={vi.fn()} compact />)

    expect(screen.getByRole('button', { name: 'Move to …' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Topic' })).not.toBeInTheDocument()
  })

  test('compact: pressing the button opens the same field, and a pick hands the topic over and closes it', async () => {
    const onChange = vi.fn()
    render(<TopicPicker topics={TOPICS} value={null} onChange={onChange} compact />)

    await userEvent.click(screen.getByRole('button', { name: 'Move to …' }))
    await userEvent.type(field(), 'stell')
    await userEvent.click(screen.getByRole('option', { name: 'Stellplätze' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Stellplätze')
    expect(screen.queryByRole('combobox', { name: 'Topic' })).not.toBeInTheDocument()
  })
})
