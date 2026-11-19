import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => 'toast-1') } }))
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
  it('steps the group presses back while mails are picked: the bar under the list files them', () => {
    renderWorkspace('selected')
    const group = screen.getByRole('region', { name: /Mail thread “Stellplatznachweis”\s· 4 new mails/ })
    expect(within(group).queryByTestId('thread-group-file')).toBeNull()
    expect(screen.queryByTestId('readiness-file-all')).toBeNull()
    expect(screen.getByTestId('inbound-mail-selection-bar')).toBeInTheDocument()
  })

  it('groups a conversation with one button that files it as suggested', async () => {
    renderWorkspace('selected')
    await userEvent.click(screen.getByTestId('selection-clear'))
    const group = screen.getByRole('region', { name: /Mail thread “Stellplatznachweis”\s· 4 new mails/ })
    expect(within(group).getByTestId('thread-group-file')).toHaveTextContent('File all 4 into the mail thread')
    await userEvent.click(within(group).getByTestId('thread-group-file'))
    const destinations = await screen.findByTestId('bulk-destinations')
    expect(destinations).toHaveTextContent('In mail thread “Stellplatznachweis”: 4')
    expect(destinations).toHaveTextContent('In “Tragwerk”: 1')
  })

  it('splits a conversation: its ready replies go in one press, the ones that need a look are gone through in order', () => {
    renderWorkspace('thread-group')
    const ready = screen.getByRole('region', { name: /3 new mails/ })
    expect(within(ready).getByTestId('thread-group-file')).toHaveTextContent('File all 3 into the mail thread')
    const waiting = screen.getByRole('region', { name: /2 new mails/ })
    expect(within(waiting).queryByTestId('thread-group-file')).toBeNull()
    expect(within(waiting).getByTestId('thread-group-open')).toHaveAttribute('href', expect.stringContaining('/files/mail/'))
    expect(screen.getByTestId('readiness-ready').compareDocumentPosition(ready) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('readiness-needs_you').compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens the first mail of a group that changed since the list was read and no longer goes in one press', async () => {
    const { client } = renderWorkspace('selected')
    const get = client.get.bind(client)
    vi.spyOn(client, 'get').mockImplementation(async (projectId, mailId) => ({ ...(await get(projectId, mailId)), incompleteReason: 'scanning' }))
    await userEvent.click(screen.getByTestId('selection-clear'))
    const group = screen.getByRole('region', { name: /4 new mails/ })
    await userEvent.click(within(group).getByTestId('thread-group-file'))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(expect.stringContaining('/files/mail/')))
    expect(screen.queryByTestId('bulk-destinations')).not.toBeInTheDocument()
  })

  it('files the first twenty of a longer conversation, the most one request decides, and says so before the press', async () => {
    const { client } = renderWorkspace('worst-case')
    const file = vi.spyOn(client, 'file')
    const press = screen.getByTestId('thread-group-file')
    expect(press).toHaveTextContent('File the first 20 into the mail thread')
    expect(screen.queryByTestId('readiness-file-all')).toBeNull()
    await userEvent.click(press)
    await userEvent.click(await screen.findByTestId('bulk-file-confirm'))
    await waitFor(() => expect(file).toHaveBeenCalledTimes(1))
    expect(file.mock.calls[0][1].mails).toHaveLength(20)
  })

  it('heads the list with „Bereit“ and „Braucht Sie“, and says on each waiting row what it needs', () => {
    renderWorkspace('many')
    expect(screen.getByTestId('readiness-ready')).toHaveTextContent('Ready to file3')
    expect(screen.getByTestId('readiness-needs_you')).toHaveTextContent('Needs you6')
    const nameStop = screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['name-stop'].view.id}`)
    expect(within(nameStop).getByTestId('inbound-mail-row-reason')).toHaveTextContent('Check an attachment')
    const unvouched = screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['unverified-thread'].view.id}`)
    expect(within(unvouched).getByTestId('inbound-mail-row-reason')).toHaveAttribute('data-reason', 'needs_person')
    const forged = screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['impersonation-colleague'].view.id}`)
    expect(within(forged).queryByTestId('inbound-mail-row-reason')).toBeNull()
    expect(within(forged).queryByTestId('inbound-mail-row-file')).toBeNull()
    expect(within(nameStop).queryByTestId('inbound-mail-row-file')).toBeNull()
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

  it('files a ready row in one press: the same request as bulk, no confirmation, and says where everything goes', async () => {
    const { client } = renderWorkspace('many', { pollMs: 1 })
    const file = vi.spyOn(client, 'file')
    const id = DETAIL_VARIANTS['authority-statement'].view.id
    await userEvent.click(within(screen.getByTestId(`inbound-mail-row-${id}`)).getByTestId('inbound-mail-row-file'))
    await waitFor(() => expect(file).toHaveBeenCalledTimes(1))
    const body = file.mock.calls[0][1]
    expect(body.mails).toHaveLength(1)
    expect(body.mails[0]).toMatchObject({ mailId: id, message: { thread: { action: 'append' } }, parts: [{ name: 'Stellungnahme_MA37_Brandschutz.pdf' }] })
    expect(body.mails[0]).not.toHaveProperty('acknowledgeSender')
    expect(body.mails[0]).not.toHaveProperty('acknowledgeRisk')
    expect(screen.queryByTestId('bulk-destinations')).not.toBeInTheDocument()
    expect(toast.loading).toHaveBeenCalledWith('1 mail is being filed as suggested', {
      description: 'In mail thread “Verfahren MA 37”: 1\u00A0· In “Behörde”: 1',
    })
    expect(capturePosthog).toHaveBeenCalledWith('inbound_mail_filed_as_suggested', { surface: 'row', mails: 1, files: 1, texts: 1 })
    // The same toast then says that it landed, and where.
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Filed 1 file and the mail text', expect.objectContaining({ id: 'toast-1', action: expect.objectContaining({ label: 'View' }) }))
    )
  })

  it('says it when a row’s filing fails, in the same toast', async () => {
    const { client } = renderWorkspace('many', { pollMs: 1 })
    const id = DETAIL_VARIANTS['authority-statement'].view.id
    const get = client.get.bind(client)
    let reads = 0
    vi.spyOn(client, 'get').mockImplementation(async (projectId, mailId) => {
      reads += 1
      const view = await get(projectId, mailId)
      if (reads === 1) return view
      return { ...view, parts: view.parts.map((part) => (part.kind === 'attachment' ? { ...part, state: 'waiting' as const, lastFailure: 'quota' as const } : { ...part, state: 'filed' as const })) }
    })
    await userEvent.click(within(screen.getByTestId(`inbound-mail-row-${id}`)).getByTestId('inbound-mail-row-file'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('storage is full'), { id: 'toast-1' }))
  })

  it('reads a ready row again before its press and files nothing that changed meanwhile', async () => {
    const { client } = renderWorkspace('many')
    const file = vi.spyOn(client, 'file')
    const get = client.get.bind(client)
    vi.spyOn(client, 'get').mockImplementation(async (projectId, mailId) => ({ ...(await get(projectId, mailId)), incompleteReason: 'scanning' }))
    const id = DETAIL_VARIANTS['authority-statement'].view.id
    await userEvent.click(within(screen.getByTestId(`inbound-mail-row-${id}`)).getByTestId('inbound-mail-row-file'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('1 mail is still being checked for malware.'))
    expect(file).not.toHaveBeenCalled()
  })

  it('files every ready mail from the „Bereit“ heading after the bulk confirmation', async () => {
    const { client } = renderWorkspace('many')
    const file = vi.spyOn(client, 'file')
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

  it('says how long a mail has left in its last days, and lifts it to the top of its section', () => {
    renderWorkspace('many')
    const row = screen.getByTestId(`inbound-mail-row-${EXPIRING}`)
    expect(within(row).getByTestId('inbound-mail-row-expiry')).toHaveTextContent('Expires in 2 days')
    const heading = screen.getByTestId('readiness-needs_you')
    const below = screen.getAllByTestId(/^inbound-mail-row-[0-9a-f]/).filter((candidate) => heading.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(below[0]).toBe(row)
    expect(within(screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['member-verified'].view.id}`)).queryByTestId('inbound-mail-row-expiry')).toBeNull()
  })

  it('filters the rows by sender and subject, says the count once, and offers to clear a search that finds nothing', async () => {
    renderWorkspace('many')
    const search = screen.getByRole('searchbox', { name: 'Filter mail by sender or subject' })
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

  it('ignores the keys while the person types', () => {
    renderWorkspace('one')
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'j' })
    expect(screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['member-verified'].view.id}`)).not.toHaveAttribute('data-focused')
    input.remove()
  })

  it('offers „File as suggested“ only when every selected mail is complete, and says why not', async () => {
    renderWorkspace('bulk-blocked')
    const file = await screen.findByTestId('selection-file')
    await waitFor(() => expect(screen.getByTestId('selection-why')).toHaveTextContent(/needs its sender confirmed/))
    expect(file).toBeDisabled()
    expect(file).toHaveAccessibleDescription(/needs its sender confirmed/)
  })

  it('never offers an impersonation for bulk filing: no checkbox, a red label, and X does not select it', async () => {
    renderWorkspace('many')
    const row = await screen.findByTestId(`inbound-mail-row-${DETAIL_VARIANTS['impersonation-colleague'].view.id}`)
    expect(within(row).queryByTestId('inbound-mail-row-checkbox')).toBeNull()
    expect(within(row).getByTestId('inbound-mail-row-impersonation')).toHaveTextContent('Poses as Miriam Huber · do not file')
    const other = screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS['member-verified'].view.id}`)
    expect(within(other).getByTestId('inbound-mail-row-checkbox')).toBeInTheDocument()
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

  it('leaves a mail that still waits (a restore, a filing that failed) where it is', async () => {
    const id = DETAIL_VARIANTS['member-verified'].view.id
    renderOpen('many', id)
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
    const box = within(screen.getByTestId(`inbound-mail-row-${DETAIL_VARIANTS.revision.view.id}`)).getByTestId('inbound-mail-row-checkbox')
    box.focus()
    fireEvent.keyDown(box, { key: 'Backspace' })
    const button = screen.getByTestId('filter-handled')
    button.focus()
    fireEvent.keyDown(button, { key: 'Delete' })
    await act(async () => {})
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('asks first before ⌫ dismisses an outsider’s unconfirmed mail, which is erased, and offers no undo', async () => {
    const { client } = renderOpen('many', EXPIRING)
    const dismiss = vi.spyOn(client, 'dismiss')
    vi.spyOn(client, 'list').mockResolvedValue(listWithout('many', EXPIRING))
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Backspace' })
    })
    expect(await screen.findByText('Dismiss this mail?')).toBeInTheDocument()
    expect(dismiss).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('dismiss-final-confirm'))
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(PROJECT_ID, { mailIds: [EXPIRING] }))
    expect(toast.success).toHaveBeenCalledWith('Mail dismissed')
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
})
