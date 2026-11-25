import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn(), loading: vi.fn(() => 'toast-1') } }))
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
const media = vi.hoisted(() => ({ phone: false }))
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => media.phone }))
vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/app/projects/p/files/mail',
  useSearchParams: () => new URLSearchParams(),
}))

import { toast } from 'sonner'
import { capturePosthog } from '@/lib/analytics/posthog'
import { act, fireEvent, render, screen, waitFor, within } from '@/test-utils'
import {
  ADDRESS_VARIANTS,
  DETAIL_BY_ID,
  DETAIL_VARIANTS,
  FIXTURE_NOW,
  FOLDERS,
  LIST_VARIANTS,
  PROJECT_ID,
  PROJECT_NAME,
  fixtureAddressClient,
  fixtureClient,
  fixtureId,
  listPage,
} from '@/app/dev/inbound-mail/fixtures'
import { refreshInboundMailWaiting, resetInboundMailWaitingForTests } from '@/hooks/use-inbound-mail-waiting'
import { SHORTCUTS_PREFERENCE_KEY } from '@/hooks/use-shortcuts-preference'
import { ProjectSectionFrame, SectionActionsInline } from '@/components/shell/project-section-frame'
import { TOOL_ROW_SEARCH_CLASS } from '@/features/documents'
import { InboundMailWorkspace } from './inbound-mail-workspace'

function renderWorkspace(variant: string, overrides: Partial<Parameters<typeof InboundMailWorkspace>[0]> = {}) {
  const fixture = LIST_VARIANTS[variant]
  const client = fixtureClient({ list: fixture })
  const status = fixture.status ?? 'waiting'
  const rendered = render(
    <InboundMailWorkspace
      projectId={PROJECT_ID}
      projectName={PROJECT_NAME}
      projectClosed={fixture.closed ?? false}
      folders={FOLDERS}
      status={status}
      outcome={fixture.outcome ?? null}
      initialList={fixture.load ? null : listPage(fixture.items.filter((item) => item.status === status), fixture.nextCursor ?? null)}
      initialListFailed={fixture.load === 'error'}
      mailId={null}
      initialMail={null}
      client={client}
      addressClient={fixtureAddressClient(
        fixture.everReceived === false ? { ...(ADDRESS_VARIANTS.manager as Exclude<(typeof ADDRESS_VARIANTS)['manager'], string>), lastReceivedAt: null } : ADDRESS_VARIANTS.manager
      )}
      now={FIXTURE_NOW}
      holdMs={0}
      initialChecked={fixture.checked}
      {...overrides}
    />
  )
  return { client, unmount: rendered.unmount }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetInboundMailWaitingForTests()
  media.phone = false
  window.localStorage.removeItem(SHORTCUTS_PREFERENCE_KEY)
})

const EXPIRING = fixtureId('mail:outsider-expiring')

function renderOpen(variant: string, mailId: string, overrides: Partial<Parameters<typeof InboundMailWorkspace>[0]> = {}) {
  const fixture = DETAIL_BY_ID.get(mailId)
  return renderWorkspace(variant, { mailId, initialMail: fixture?.view ?? null, initialText: fixture?.text ?? null, ...overrides })
}

function listWithout(variant: string, ...gone: string[]) {
  const items = LIST_VARIANTS[variant].items.filter((item) => item.status === 'waiting' && !gone.includes(item.id))
  return listPage(items, null)
}

describe('InboundMailWorkspace', () => {
  it('steps the section press back while mails are picked: the bar under the list files them', () => {
    renderWorkspace('selected')
    const group = screen.getByRole('region', { name: /Mail thread “Stellplatznachweis”\s· 4 new mails/ })
    expect(within(group).queryByRole('button')).toBeNull()
    expect(screen.queryByTestId('readiness-file-all')).toBeNull()
    expect(screen.getByTestId('inbound-mail-selection-bar')).toBeInTheDocument()
  })

  it('keeps a conversation whole under its heading, in „Braucht Sie“ while any reply needs a look, and files its ready replies from the toolbar', () => {
    renderWorkspace('thread-group')
    const thread = screen.getByRole('region', { name: /5 new mails/ })
    expect(within(thread).getByRole('heading', { name: 'Stellplatznachweis' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /3 new mails/ })).toBeNull()
    expect(screen.getByTestId('readiness-needs_you').compareDocumentPosition(thread) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('readiness-file-all')).toHaveTextContent('File all 3')
  })

  it('files the first twenty of a longer conversation, the most one request decides, and says so before the press', async () => {
    const { client } = renderWorkspace('worst-case')
    const file = vi.spyOn(client, 'file')
    const press = screen.getByTestId('readiness-file-all')
    expect(press).toHaveTextContent('File the first 20')
    await userEvent.click(press)
    await userEvent.click(await screen.findByTestId('bulk-file-confirm'))
    await waitFor(() => expect(file).toHaveBeenCalledTimes(1))
    expect(file.mock.calls[0][1].mails).toHaveLength(20)
  })

  it('heads the list with „Ablagebereit“ and „Braucht Sie“, and says on each waiting row what it needs', () => {
    renderWorkspace('many')
    expect(screen.getByTestId('readiness-ready')).toHaveTextContent('Ready to file1')
    expect(screen.getByTestId('readiness-needs_you')).toHaveTextContent('Needs you8')
    const nameStop = screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['name-stop'].view.id}`)
    expect(within(nameStop).getByTestId('inbound-mail-row-reason')).toHaveTextContent('Check an attachment')
    const unvouched = screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['unverified-thread'].view.id}`)
    expect(within(unvouched).getByTestId('inbound-mail-row-reason')).toHaveAttribute('data-reason', 'needs_person')
    const forged = screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['impersonation-colleague'].view.id}`)
    expect(within(forged).queryByTestId('inbound-mail-row-reason')).toBeNull()
  })

  it('phrases a held writer’s row for its reader: a colleague checks the sender of a writer’s unsigned mail under „Braucht Sie“ (amendment of 2026-11-19)', () => {
    const { unmount } = renderWorkspace('claimed')
    const row = (variant: string) => screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS[variant].view.id}`)
    const claimed = within(row('claimed-by-colleague')).getByTestId('inbound-mail-row-reason')
    expect(claimed).toHaveAttribute('data-reason', 'sender')
    expect(claimed).toHaveTextContent('Check the sender')
    expect(screen.getByTestId('readiness-needs_you')).toBeInTheDocument()
    expect(screen.queryByTestId('readiness-others')).toBeNull()
    expect(within(row('not-filed')).getByTestId('inbound-mail-row-reason')).toHaveTextContent('Not filed directly · Choose a folder')
    unmount()
    renderWorkspace('own')
    const own = within(screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['own-unverified'].view.id}`)).getByTestId('inbound-mail-row-reason')
    expect(own).toHaveAttribute('data-reason', 'own')
    expect(own).toHaveTextContent('Did you send it? Confirm it')
    expect(within(screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS.impersonation.view.id}`)).getByTestId('inbound-mail-row-impersonation')).toHaveTextContent(
      'Your address, rejected by your domain · check it'
    )
    expect(screen.queryByText('Check the sender')).toBeNull()
  })

  it('files every ready mail from the „Bereit“ heading after the bulk confirmation', async () => {
    const { client } = renderWorkspace('many')
    const file = vi.spyOn(client, 'file')
    expect(screen.getByTestId('readiness-file-all')).toHaveTextContent(/^File all 3$/)
    await userEvent.click(screen.getByTestId('readiness-file-all'))
    const destinations = await screen.findByTestId('bulk-destinations')
    expect(destinations).toHaveTextContent('In mail thread “Stellplatznachweis”: 2')
    expect(destinations).toHaveTextContent('In mail thread “Verfahren MA 37”: 1')
    await userEvent.click(screen.getByTestId('bulk-file-confirm'))
    await waitFor(() => expect(file).toHaveBeenCalledTimes(1))
    expect(file.mock.calls[0][1].mails).toHaveLength(3)
    expect(capturePosthog).toHaveBeenCalledWith('inbound_mail_filed_as_suggested', expect.objectContaining({ surface: 'ready_section', mails: 3 }))
  })

  it('lists an outsider’s unconfirmed mail as a row with its trust glyph, and folds only automatic mail', async () => {
    renderWorkspace('unverified-group')
    const outsider = screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['external-unverified'].view.id}`)
    expect(screen.getByTestId('quiet-group')).not.toContainElement(outsider)
    expect(within(outsider).getByTestId('sender-trust-glyph')).toBeInTheDocument()
    const toggle = screen.getByTestId('quiet-group-toggle')
    expect(toggle).toHaveTextContent('Automatic1')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(within(screen.getByTestId('quiet-group')).getAllByTestId('inbound-mail-row-link')).toHaveLength(1)
  })

  it('opens the automatic group by itself when nothing else waits, and J reaches its rows', async () => {
    renderWorkspace('only-automatic')
    expect(screen.getByTestId('quiet-group-toggle')).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(window, { key: 'j' })
    const row = within(screen.getByTestId('quiet-group')).getAllByTestId(/^inbound-mail-row-[0-9a-f]/)[0]
    await waitFor(() => expect(row).toHaveAttribute('data-focused', 'true'))
  })

  it('says, calmly and dated, until when an outsider’s mail stays in its last days, and lifts it to the top of its section', () => {
    renderWorkspace('many')
    const row = screen.getByTestId(`inbound-mail-row-${EXPIRING}`)
    const day = new Intl.DateTimeFormat('en', { day: '2-digit', month: '2-digit' }).format(new Date(FIXTURE_NOW + 2 * 86_400_000))
    expect(within(row).getByTestId('inbound-mail-row-expiry')).toHaveTextContent(`until ${day}`)
    const heading = screen.getByTestId('readiness-needs_you')
    const below = screen.getAllByTestId(/^inbound-mail-row-[0-9a-f]/).filter((candidate) => heading.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(below[0]).toBe(row)
    expect(within(screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['member-verified'].view.id}`)).queryByTestId('inbound-mail-row-expiry')).toBeNull()
  })

  it('filters the rows by sender and subject on a phone, in the list’s own field, says the count once, and offers to clear a search that finds nothing', async () => {
    media.phone = true
    renderWorkspace('many')
    const search = screen.getByRole('searchbox', { name: 'Filter mail by sender, subject or attachment' })
    await userEvent.type(search, 'novak')
    expect(screen.getAllByTestId('inbound-mail-row-link')).toHaveLength(1)
    expect(screen.getByTestId('inbound-mail-search-status')).toHaveTextContent('1 match')
    await userEvent.clear(search)
    await userEvent.type(search, 'zzz')
    expect(screen.getByTestId('inbound-mail-no-match')).toHaveTextContent('No mail matches “zzz”')
    await userEvent.click(within(screen.getByTestId('inbound-mail-no-match')).getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByTestId('inbound-mail-row-link').length).toBeGreaterThan(1)
  })

  it('teaches the address when nothing ever arrived, and says „all done“ otherwise', async () => {
    renderWorkspace('empty')
    expect(await screen.findByTestId('inbound-mail-never')).toHaveTextContent('No mail to this project yet')
    expect(screen.getByTestId('inbound-mail-never-lead')).toHaveTextContent('Put this address in Cc when you write about the project.')
    expect(await screen.findByTestId('inbound-mail-address')).toHaveTextContent('project+bauplatz-12-wohnbau-seestadt.k3x7q2m5p4ab@inbox.example.org')
    expect(screen.getByTestId('address-copy')).toBeInTheDocument()
    expect(screen.getByTestId('address-not-postfach')).toHaveTextContent('The Inbox shows notices for you.')
    expect(screen.getByTestId('address-setup-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('says „nothing waits“ for a project that had mail', async () => {
    renderWorkspace('done')
    expect(await screen.findByText('Nothing waits to be filed')).toBeInTheDocument()
  })

  it('says a failed list in its own words', () => {
    renderWorkspace('error')
    expect(screen.getByText('Project mail could not be loaded.')).toBeInTheDocument()
  })

  it('walks the rows with J and K, selects with X and opens with Enter', async () => {
    renderWorkspace('one')
    const id = DETAIL_VARIANTS['member-verified'].view.id
    fireEvent.keyDown(window, { key: 'j' })
    const row = await screen.findByTestId(`inbound-mail-row-${id}`)
    expect(row).toHaveAttribute('data-focused', 'true')
    expect(row).toHaveAttribute('data-cursor', 'true')
    expect(row.querySelector('[aria-hidden].absolute.left-0')).toBeNull()
    fireEvent.keyDown(window, { key: 'x' })
    expect(within(screen.getByTestId(`inbound-mail-row-${id}`)).getByTestId('inbound-mail-row-checkbox')).toBeChecked()
    expect(await screen.findByTestId('inbound-mail-selection-bar')).toHaveTextContent('1 selected')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(nav.push).toHaveBeenCalledWith(expect.stringContaining(`/files/mail/${id}`))
  })

  it('picks as Dateien does: no boxes at rest, „Select“ shows them, a press on a row ticks it, the bar’s × ends it', async () => {
    renderWorkspace('many')
    const id = DETAIL_VARIANTS['member-verified'].view.id
    const row = await screen.findByTestId(`inbound-mail-row-${id}`)
    expect(within(row).queryByTestId('inbound-mail-row-checkbox')).toBeNull()
    expect(screen.queryByTestId('inbound-mail-selection-bar')).toBeNull()
    await userEvent.click(screen.getByTestId('selection-start'))
    expect(screen.queryByTestId('selection-start')).toBeNull()
    expect(screen.getByTestId('inbound-mail-selection-bar')).toHaveTextContent('0 selected')
    expect(screen.getByTestId('selection-file')).toBeDisabled()
    await userEvent.click(within(row).getByTestId('inbound-mail-row-link'))
    expect(nav.push).not.toHaveBeenCalled()
    expect(within(screen.getByTestId(`inbound-mail-row-${id}`)).getByTestId('inbound-mail-row-checkbox')).toBeChecked()
    expect(screen.getByTestId('inbound-mail-selection-bar')).toHaveTextContent('1 selected')
    await userEvent.click(screen.getByTestId('selection-clear'))
    expect(screen.queryByTestId('inbound-mail-selection-bar')).toBeNull()
    expect(within(screen.getByTestId(`inbound-mail-row-${id}`)).queryByTestId('inbound-mail-row-checkbox')).toBeNull()
  })

  it('ignores the keys while the person types', () => {
    renderWorkspace('one')
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'j' })
    expect(screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['member-verified'].view.id}`)).not.toHaveAttribute('data-focused')
    input.remove()
  })

  it('files the ready part of a selection, names the mail that stays, and says where the rest goes', async () => {
    const { client } = renderWorkspace('bulk-blocked')
    const fileSpy = vi.spyOn(client, 'file')
    const file = await screen.findByTestId('selection-file')
    expect(file).toHaveTextContent('File 1')
    expect(file).toBeEnabled()
    expect(screen.queryByTestId('selection-why')).toBeNull()
    expect(screen.getByTestId('selection-preview')).toHaveTextContent('File 1 of 2')
    expect(screen.getByTestId('selection-preview-held')).toHaveTextContent(/stays in Project mail/)
    expect(screen.getByTestId('selection-preview-groups')).toHaveTextContent('→')
    await userEvent.click(file)
    await userEvent.click(await screen.findByTestId('bulk-file-confirm'))
    await waitFor(() => expect(fileSpy).toHaveBeenCalledTimes(1))
    expect(fileSpy.mock.calls[0][1].mails.map((mail) => mail.mailId)).toEqual([DETAIL_VARIANTS['member-verified'].view.id])
  })

  it('blocks the bar only when nothing picked is ready, and says why under the count', async () => {
    renderWorkspace('bulk-blocked')
    await userEvent.click(within(screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['member-verified'].view.id}`)).getByTestId('inbound-mail-row-link'))
    const file = screen.getByTestId('selection-file')
    await waitFor(() => expect(screen.getByTestId('selection-why')).toHaveTextContent(/needs its sender confirmed/))
    expect(file).toBeDisabled()
    expect(file).toHaveAccessibleDescription(/needs its sender confirmed/)
  })

  it('never offers an impersonation for bulk filing: no checkbox, a red label, and X does not select it', async () => {
    renderWorkspace('many')
    const row = await screen.findByTestId(`inbound-mail-row-${DETAIL_VARIANTS['impersonation-colleague'].view.id}`)
    await userEvent.click(screen.getByTestId('selection-start'))
    expect(within(row).queryByTestId('inbound-mail-row-checkbox')).toBeNull()
    expect(within(row).getByTestId('inbound-mail-row-impersonation')).toHaveTextContent('Poses as Miriam Huber · do not file')
    const other = screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['member-verified'].view.id}`)
    expect(within(other).getByTestId('inbound-mail-row-checkbox')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('selection-clear'))
    for (let step = 0; step < 10 && row.dataset.focused !== 'true'; step += 1) {
      fireEvent.keyDown(window, { key: 'j' })
      await waitFor(() => expect(screen.getAllByTestId(/^inbound-mail-row-/).some((candidate) => candidate.dataset.focused === 'true')).toBe(true))
    }
    expect(screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['impersonation-colleague'].view.id}`)).toHaveAttribute('data-focused', 'true')
    fireEvent.keyDown(window, { key: 'x' })
    expect(screen.queryByTestId('inbound-mail-selection-bar')).toBeNull()
  })

  it('files a complete selection after a confirmation grouped by destination', async () => {
    const { client } = renderWorkspace('selected')
    const file = vi.spyOn(client, 'file')
    await waitFor(() => expect(screen.getByTestId('selection-file')).toBeEnabled())
    await userEvent.click(screen.getByTestId('selection-file'))
    expect(await screen.findByTestId('bulk-destinations')).toHaveTextContent('In mail thread “Stellplatznachweis”: 2')
    await userEvent.click(screen.getByTestId('bulk-file-confirm'))
    await waitFor(() => expect(file).toHaveBeenCalled())
    const body = file.mock.calls[0][1]
    expect(body.mails).toHaveLength(2)
    for (const decision of body.mails) {
      expect(decision).not.toHaveProperty('acknowledgeSender')
      expect(decision).not.toHaveProperty('acknowledgeRisk')
    }
  })

  it('asks before dismissing a selection with ⌫', async () => {
    renderWorkspace('selected')
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Backspace' })
    })
    expect(await screen.findByText('Dismiss 2 mails?')).toBeInTheDocument()
  })

  it('switches to the handled list by replacing the URL', async () => {
    renderWorkspace('one')
    await userEvent.click(screen.getByTestId('filter-handled'))
    expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining('status=handled'))
  })

  it('says a closed project above the rows', () => {
    renderWorkspace('closed')
    expect(screen.getByTestId('inbound-mail-closed')).toHaveTextContent('The project is closed – reopen it to file')
  })

  it('opens the next waiting mail after the open one is dismissed, and puts the focus on its row', async () => {
    const id = DETAIL_VARIANTS['member-verified'].view.id
    const { client } = renderOpen('many', id)
    const dismiss = vi.spyOn(client, 'dismiss')
    vi.spyOn(client, 'list').mockResolvedValue(listWithout('many', id))
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Backspace' })
    })
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(PROJECT_ID, { mailIds: [id] }))
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(expect.stringMatching(/\/files\/mail\/[0-9a-f-]+$/)))
    const next = (nav.replace.mock.calls.at(-1)?.[0] as string).split('/').at(-1)
    expect(next).not.toBe(id)
    expect(screen.getByTestId(`inbound-mail-row-${next}`)).toHaveAttribute('data-focused', 'true')
  })

  it('opens the next mail as soon as the open one is filed, and reports its landing in a toast meanwhile', async () => {
    const id = DETAIL_VARIANTS['member-verified'].view.id
    vi.mocked(toast.loading).mockReturnValueOnce('landing-of-the-open-mail')
    const { client } = renderOpen('many', id, { pollMs: 1 })
    const file = vi.spyOn(client, 'file')
    vi.spyOn(client, 'get').mockReturnValue(new Promise(() => {}))
    await userEvent.click(screen.getByTestId('decision-open'))
    await userEvent.click(within(await screen.findByTestId('filing-dialog')).getByTestId('decision-file'))
    await waitFor(() => expect(file).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(expect.stringMatching(/\/files\/mail\/[0-9a-f-]+$/)))
    const next = (nav.replace.mock.calls.at(-1)?.[0] as string).split('/').at(-1)
    expect(next).not.toBe(id)
    expect(screen.getByTestId(`inbound-mail-row-${next}`)).toHaveAttribute('data-focused', 'true')
    expect(toast.loading).toHaveBeenCalledWith('Filing the mail', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }))
    expect(toast.loading).toHaveBeenCalledWith('Being filed …', { id: 'landing-of-the-open-mail', action: undefined })
    expect(toast.success).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'landing-of-the-open-mail' }))
  })

  it('holds a filing behind „Undo“: the mail leaves the list at once, and undoing sends nothing and opens it again', async () => {
    const id = DETAIL_VARIANTS['member-verified'].view.id
    const { client } = renderOpen('many', id, { holdMs: 60_000 })
    const file = vi.spyOn(client, 'file')
    await userEvent.click(screen.getByTestId('decision-open'))
    await userEvent.click(within(await screen.findByTestId('filing-dialog')).getByTestId('decision-file'))
    await waitFor(() => expect(screen.queryByTestId(`inbound-mail-row-${id}`)).toBeNull())
    const call = vi.mocked(toast.loading).mock.calls.find(([label]) => label === 'Filing the mail')
    const options = call?.[1] as { action: { label: string; onClick: () => void } }
    expect(options.action.label).toBe('Undo')
    act(() => options.action.onClick())
    expect(await screen.findByTestId(`inbound-mail-row-${id}`)).toBeInTheDocument()
    expect(nav.push).toHaveBeenCalledWith(expect.stringContaining(`/files/mail/${id}`))
    expect(file).not.toHaveBeenCalled()
  })

  it('leaves a mail that still waits (a restore, a filing that failed) where it is', async () => {
    const id = DETAIL_VARIANTS['member-verified'].view.id
    const { client } = renderOpen('many', id)
    vi.spyOn(client, 'list').mockResolvedValue(listWithout('many'))
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Backspace' })
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    await act(async () => {})
    expect(nav.replace).not.toHaveBeenCalled()
  })

  it('opens the next mail on a phone too after a decision, and the list only when none is left', async () => {
    media.phone = true
    const id = DETAIL_VARIANTS['member-verified'].view.id
    const { client, unmount } = renderOpen('many', id)
    vi.spyOn(client, 'list').mockResolvedValue(listWithout('many', id))
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Backspace' })
    })
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(expect.stringMatching(/\/files\/mail\/[0-9a-f-]+$/)))
    expect((nav.replace.mock.calls.at(-1)?.[0] as string).split('/').at(-1)).not.toBe(id)
    unmount()
    nav.replace.mockClear()
    const only = renderOpen('one', id)
    vi.spyOn(only.client, 'list').mockResolvedValue(listWithout('one', id))
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Backspace' })
    })
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/app/projects/${PROJECT_ID}/files/mail`))
  })

  it('never dismisses with ⌫ while a button or a box has the focus', async () => {
    const id = DETAIL_VARIANTS['member-verified'].view.id
    const { client } = renderOpen('many', id)
    const dismiss = vi.spyOn(client, 'dismiss')
    await userEvent.click(screen.getByTestId('selection-start'))
    const box = within(screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS.revision.view.id}`)).getByTestId('inbound-mail-row-checkbox')
    box.focus()
    fireEvent.keyDown(box, { key: 'Backspace' })
    const button = screen.getByTestId('filter-handled')
    button.focus()
    fireEvent.keyDown(button, { key: 'Delete' })
    await act(async () => {})
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('dismisses an outsider’s unconfirmed mail on ⌫ without asking, as any other, with the undo', async () => {
    const { client } = renderOpen('many', EXPIRING)
    const dismiss = vi.spyOn(client, 'dismiss')
    vi.spyOn(client, 'list').mockResolvedValue(listWithout('many', EXPIRING))
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Backspace' })
    })
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(PROJECT_ID, { mailIds: [EXPIRING] }))
    expect(screen.queryByText('Dismiss this mail?')).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('Mail dismissed', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }))
  })

  it('answers no single key while the profile turned the shortcuts off', () => {
    window.localStorage.setItem(SHORTCUTS_PREFERENCE_KEY, 'false')
    renderWorkspace('one')
    fireEvent.keyDown(window, { key: 'j' })
    expect(screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['member-verified'].view.id}`)).not.toHaveAttribute('data-focused')
  })

  it('reads the list again when the shared count sees mail arrive', async () => {
    const { client } = renderWorkspace('one')
    await act(async () => {
      await refreshInboundMailWaiting(PROJECT_ID, client)
    })
    const later = Date.now() + 60_000
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later)
    vi.spyOn(client, 'list').mockResolvedValue(listPage(LIST_VARIANTS['unverified-group'].items, null))
    await act(async () => {
      await refreshInboundMailWaiting(PROJECT_ID, client)
    })
    expect(await screen.findByTestId(`inbound-mail-row-${EXPIRING}`)).toBeInTheDocument()
    clock.mockRestore()
  })

  it('puts every row of a conversation under its heading, the ready and the waiting alike', () => {
    renderWorkspace('thread-group')
    const thread = screen.getByRole('region', { name: /5 new mails/ })
    const rows = within(within(thread).getByTestId('thread-group-rows')).getAllByTestId(/^inbound-mail-row-[0-9a-f]/)
    expect(rows).toHaveLength(5)
    expect(rows.some((row) => within(row).queryByTestId('inbound-mail-row-places'))).toBe(true)
    expect(rows.some((row) => within(row).queryByTestId('inbound-mail-row-reason'))).toBe(true)
  })

  it('says after „Alle … ablegen“ how many mails went where, once they landed, with a way to look', async () => {
    renderWorkspace('many', { pollMs: 1 })
    await userEvent.click(screen.getByTestId('readiness-file-all'))
    await userEvent.click(await screen.findByTestId('bulk-file-confirm'))
    await waitFor(() => expect(toast.loading).toHaveBeenCalledWith('3 mails are being filed as suggested', expect.anything()))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('3 mails filed', expect.objectContaining({ id: 'toast-1' })))
    const options = vi.mocked(toast.success).mock.calls.at(-1)?.[1] as { description: React.ReactElement; action: { label: string; onClick: () => void } }
    render(options.description)
    expect(screen.getByTestId('bulk-landed').textContent).toBe(
      '2 mail texts →\u00A0“Stellplatznachweis”Mail text →\u00A0“Verfahren MA 37”1 file →\u00A0Behörde1 file →\u00A0Behörde/Bescheide1 file →\u00A0Tragwerk'
    )
    expect(options.action.label).toBe('View')
    act(() => options.action.onClick())
    expect(nav.replace).toHaveBeenLastCalledWith(expect.stringContaining('status=handled'))
  })

  it('says at the top how mail gets here until the project received five, with the address to copy, until dismissed', async () => {
    const fresh = { ...(ADDRESS_VARIANTS.manager as Exclude<(typeof ADDRESS_VARIANTS)['manager'], string>), receivedCount: 1 }
    const { unmount } = renderWorkspace('one', { addressClient: fixtureAddressClient(fresh) })
    const hint = await screen.findByTestId('inbound-mail-start-hint')
    expect(hint).toHaveTextContent('Put the project’s address in Cc or forward mail to it, and it lands here.')
    expect(within(hint).getByTestId('inbound-mail-start-copy')).toHaveTextContent('Copy address')
    await userEvent.click(within(hint).getByTestId('inbound-mail-start-dismiss'))
    expect(screen.queryByTestId('inbound-mail-start-hint')).toBeNull()
    expect(window.localStorage.getItem(`inbound-mail.start-hint-dismissed:${PROJECT_ID}`)).toBe('1')
    unmount()
    const again = fixtureAddressClient(fresh)
    const read = vi.spyOn(again, 'get')
    renderWorkspace('one', { addressClient: again })
    await waitFor(() => expect(read).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByTestId('inbound-mail-start-hint')).toBeNull()
    window.localStorage.clear()
  })

  it('says nothing of how mail gets here once it flows', async () => {
    const flowing = fixtureAddressClient(ADDRESS_VARIANTS.manager)
    const read = vi.spyOn(flowing, 'get')
    renderWorkspace('many', { addressClient: flowing })
    await waitFor(() => expect(read).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByTestId('inbound-mail-start-hint')).toBeNull()
  })

  describe('the search in the tool row', () => {
    const inRow = (overrides: Partial<Parameters<typeof InboundMailWorkspace>[0]> = {}) => {
      const fixture = LIST_VARIANTS.many
      return render(
        <SectionActionsInline>
          <InboundMailWorkspace
            projectId={PROJECT_ID}
            projectName={PROJECT_NAME}
            projectClosed={false}
            folders={FOLDERS}
            status="waiting"
            outcome={null}
            initialList={listPage(fixture.items.filter((item) => item.status === 'waiting'), null)}
            mailId={null}
            initialMail={null}
            client={fixtureClient({ list: fixture })}
            addressClient={fixtureAddressClient(ADDRESS_VARIANTS.manager)}
            now={FIXTURE_NOW}
            {...overrides}
          />
        </SectionActionsInline>
      )
    }
    const field = () => within(screen.getByTestId('inbound-mail-tools')).getByRole('textbox', { name: 'Filter mail by sender, subject or attachment' })
    const rows = () => screen.queryAllByTestId('inbound-mail-row-link')
    const PHOTO = DETAIL_VARIANTS['mixed-attachments'].view.id

    it('fills the head’s tool row from its start on the desk, the address’s tools at its end', async () => {
      const fixture = LIST_VARIANTS.many
      render(
        <ProjectSectionFrame projectId="p" projectName={PROJECT_NAME} inboundMail>
          <InboundMailWorkspace
            projectId={PROJECT_ID}
            projectName={PROJECT_NAME}
            projectClosed={false}
            folders={FOLDERS}
            status="waiting"
            outcome={null}
            initialList={listPage(fixture.items.filter((item) => item.status === 'waiting'), null)}
            mailId={null}
            initialMail={null}
            client={fixtureClient({ list: fixture })}
            addressClient={fixtureAddressClient(ADDRESS_VARIANTS.manager)}
            now={FIXTURE_NOW}
          />
        </ProjectSectionFrame>
      )
      const tools = screen.getByTestId('inbound-mail-tools')
      expect(within(screen.getByTestId('files-tool-row')).getByTestId('shelf-head-tools').firstElementChild).toBe(tools)
      expect(tools.firstElementChild).toBe(field().closest('form'))
      expect((await within(tools).findByTestId('inbound-mail-address-menu')).closest('.ml-auto')?.parentElement).toBe(tools)
    })

    it('stands in the tool row on the desk, not over the list, and finds a mail by an attachment’s name (Foto_Baustelle.jpg)', async () => {
      const replaceState = vi.spyOn(window.history, 'replaceState')
      const user = userEvent.setup()
      inRow()
      expect(field()).toHaveAttribute('placeholder', 'Search the project mail …')
      expect(field().closest('form')).toHaveClass(...TOOL_ROW_SEARCH_CLASS.split(' '))
      expect(within(screen.getByTestId('inbound-mail-list')).queryByRole('searchbox')).toBeNull()
      await user.type(field(), 'foto_baustelle')
      expect(rows()).toHaveLength(1)
      expect(screen.getByTestId(`inbound-mail-row-${PHOTO}`)).toBeInTheDocument()
      expect(screen.getByTestId('inbound-mail-search-status')).toHaveTextContent('1 match')
      expect(replaceState).toHaveBeenLastCalledWith(null, '', `/app/projects/${PROJECT_ID}/files/mail?q=foto_baustelle`)
    })

    it('says in the list’s empty state that nothing matches, and its button or Escape clears the search', async () => {
      const user = userEvent.setup()
      inRow()
      const all = rows().length
      await user.type(field(), 'zzz')
      expect(screen.getByTestId('inbound-mail-no-match')).toHaveTextContent('No mail matches “zzz”')
      await user.click(within(screen.getByTestId('inbound-mail-no-match')).getByRole('button', { name: 'Clear search' }))
      expect(field()).toHaveValue('')
      expect(rows()).toHaveLength(all)

      await user.type(field(), 'zzz')
      await user.keyboard('{Escape}')
      expect(field()).toHaveValue('')
      expect(rows()).toHaveLength(all)
    })

    it('starts with the query the address holds, and an opened mail keeps it in its address', () => {
      inRow({ initialQuery: 'foto_baustelle' })
      expect(field()).toHaveValue('foto_baustelle')
      expect(rows()).toHaveLength(1)
      expect(rows()[0]).toHaveAttribute('href', `/app/projects/${PROJECT_ID}/files/mail/${PHOTO}?q=foto_baustelle`)
    })
  })
})
