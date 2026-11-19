import { PRODUCT_NAME } from '@/lib/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/app/projects/p/files',
  useSearchParams: () => new URLSearchParams(),
}))

import { toast } from 'sonner'
import { render, screen, waitFor, within } from '@/test-utils'
import {
  MAIL_THREAD_VARIANTS,
  PROJECT_ID,
  THREAD_DOCUMENT_ID,
  THREAD_FOLDER_ID,
  VIEWER_ID,
  fixtureMailThreadClient,
  type MailThreadFixture,
} from '@/app/dev/mail-thread/fixtures'
import type { MailThreadClient } from './client'
import { MailThreadTab } from './mail-thread-tab'

function renderTab(name: string, options: { client?: MailThreadClient; viewer?: string | null; focus?: { entryId?: string } } = {}) {
  const fixture: MailThreadFixture = MAIL_THREAD_VARIANTS[name]
  const client = options.client ?? fixtureMailThreadClient(fixture)
  render(
    <MailThreadTab
      projectId={PROJECT_ID}
      documentId={THREAD_DOCUMENT_ID}
      threadId={fixture.view.id}
      folderId={THREAD_FOLDER_ID}
      viewerUserId={options.viewer === undefined ? VIEWER_ID : options.viewer}
      focus={options.focus}
      client={client}
    />,
  )
  return { client, fixture }
}

const entries = () => screen.findAllByTestId('mail-thread-entry')

beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
})

describe('MailThreadTab', () => {
  it('lists the mails newest first, each arrived after it was sent, on the office’s clock', async () => {
    renderTab('three-messages')
    const rows = await entries()
    expect(rows.map((row) => within(row).getByTestId('mail-thread-entry-received').textContent)).toEqual(['received 09:13', 'received 11:07', 'received 16:41'])
    expect(rows.map((row) => within(row).queryByText(/revision/))).toEqual([null, null, null])
    expect(within(rows[0]).getByTestId('mail-thread-entry-heading')).toHaveTextContent('14.10.2026 09:12 · Mag. Schober (ma37.wien.gv.at)')
    expect(within(rows[0]).getByTestId('mail-thread-entry-trust')).toHaveTextContent('Domain verified: ma37.wien.gv.at')
    expect(within(rows[0]).getByTestId('mail-thread-entry-via')).toHaveTextContent(`Filed on ${PRODUCT_NAME}’s suggestion`)
    expect(screen.getByTestId('mail-thread-waiting')).toHaveTextContent('2 mails still wait in Project mail: sender not verifiable or no folder for an attachment')
  })

  it('says why mail still waits only while replies are filed without a click, else how many wait', async () => {
    renderTab('not-followed')
    await entries()
    expect(screen.getByTestId('mail-thread-waiting')).toHaveTextContent('2 mails of this mail thread wait in Project mail')
    expect(screen.getByTestId('mail-thread-waiting')).not.toHaveTextContent(/still/)
  })

  it('lists what came with a mail: links, already there, not filed with why, and a hidden one unnamed', async () => {
    renderTab('three-messages')
    const statik = (await entries())[1]
    const items = within(statik).getAllByTestId('mail-thread-attachment')
    expect(items.map((item) => item.dataset.disposition)).toEqual(['filed', 'already_present', 'not_filed', 'hidden'])
    expect(within(items[0]).getByRole('link', { name: 'S-101_B.pdf' })).toHaveAttribute('href', expect.stringMatching(/\/files\?doc=/))
    expect(items[1]).toHaveTextContent('was already in the project')
    expect(items[2]).toHaveTextContent('Honorarnote_Okt.zip')
    expect(items[2]).toHaveTextContent('not filed · archive file, not unpacked')
    expect(within(items[2]).queryByRole('link')).toBeNull()
    expect(items[3]).toHaveTextContent('Attachment not shownis in a folder with its own access rights; whoever is listed there can open it')
  })

  it('says under each filed attachment the folder it lies in, and none for one not filed or hidden', async () => {
    renderTab('three-messages')
    const [authority, statik] = await entries()
    const items = within(statik!).getAllByTestId('mail-thread-attachment')
    expect(within(items[0]!).getByTestId('mail-thread-attachment-folder')).toHaveTextContent(/^Tragwerk\/Statik$/)
    expect(within(items[1]!).getByTestId('mail-thread-attachment-folder')).toHaveTextContent(/^Tragwerk\/Statik\/Berechnungen$/)
    expect(within(items[2]!).queryByTestId('mail-thread-attachment-folder')).toBeNull()
    expect(within(items[3]!).queryByTestId('mail-thread-attachment-folder')).toBeNull()
    expect(within(authority!).getByTestId('mail-thread-attachment-folder')).toHaveTextContent(/^Files \(top level\)$/)
  })

  it('says an unconfirmed sender with the warning glyph, in ink', async () => {
    renderTab('unverified-section')
    const trust = within((await entries())[0]).getByTestId('mail-thread-entry-trust')
    expect(trust).toHaveTextContent('Sender cannot be verified')
    expect(trust.dataset.trust).toBe('unverified')
    expect(trust.className).toContain('text-foreground')
  })

  describe('the original', () => {
    it('downloads a clean one', async () => {
      const { client } = renderTab('three-messages')
      const download = vi.spyOn(client, 'downloadOriginal')
      await userEvent.click(within((await entries())[0]).getByTestId('mail-entry-original'))
      expect(download).toHaveBeenCalledWith(PROJECT_ID, MAIL_THREAD_VARIANTS['three-messages'].view.id, expect.any(String))
      expect(within((await entries())[0]).getByTestId('mail-entry-original').dataset.state).toBe('available')
    })

    it('says not clean when the scan on the download answers 409, in place of the button', async () => {
      renderTab('original-refused')
      const first = (await entries())[0]
      await userEvent.click(within(first).getByTestId('mail-entry-original'))
      await waitFor(() => expect(within(first).getByTestId('mail-entry-original').dataset.state).toBe('not_clean'))
      expect(first).toHaveTextContent('The original contains malware and cannot be downloaded')
      expect(within(first).queryByRole('button', { name: /Original/ })).toBeNull()
    })

    it('offers nothing for an infected one, and says „gone“ for an archive entry', async () => {
      renderTab('original-infected')
      expect(within((await entries())[0]).getByTestId('mail-entry-original').dataset.state).toBe('not_clean')
    })

    it('says an archive entry has no original', async () => {
      renderTab('archive-sections')
      const first = (await entries())[0]
      expect(within(first).getByTestId('mail-entry-original').dataset.state).toBe('gone')
      expect(first).toHaveTextContent('No original: taken over from the Outlook archive')
      expect(within(first).getByTestId('mail-thread-entry-trust')).toHaveTextContent('From the Outlook archive · not checked')
    })
  })

  describe('following', () => {
    it('shows the switch on for whoever filed into the Verlauf, in the words and state of „Übersicht“', async () => {
      renderTab('three-messages')
      const control = await screen.findByRole('switch', { name: 'File replies in this mail thread without a click' })
      expect(control).toBeChecked()
      expect(screen.getByTestId('mail-thread-follow-switch-state')).toHaveTextContent(/^On until /)
      expect(screen.getByTestId('mail-thread-follow-switch')).toHaveTextContent('here and in the suggested folders')
      expect(screen.getByTestId('mail-thread-follow-switch')).toHaveTextContent('listed under “Handled”')
    })

    it('switches on, and the toast offers the undo', async () => {
      const { client } = renderTab('not-followed')
      const follow = vi.spyOn(client, 'follow')
      expect(screen.queryByText(/in your name/)).toBeNull()
      const control = await screen.findByRole('switch', { name: 'File replies in this mail thread without a click' })
      expect(control).not.toBeChecked()
      expect(screen.getByTestId('mail-thread-follow-switch-state')).toHaveTextContent('Off')
      await userEvent.click(control)
      expect(follow).toHaveBeenCalledWith(PROJECT_ID, MAIL_THREAD_VARIANTS['not-followed'].view.id)
      await waitFor(() => expect(screen.getByTestId('mail-thread-follow-switch-state')).toHaveTextContent(/^On until /))
      expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Replies in “Stellplatznachweis” are filed without a click until /), expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }))
    })

    it('renews a follow in its last days and stops it', async () => {
      const { client } = renderTab('followed')
      const follow = vi.spyOn(client, 'follow')
      const unfollow = vi.spyOn(client, 'unfollow')
      await userEvent.click(await screen.findByTestId('mail-thread-follow-renew'))
      expect(follow).toHaveBeenCalledTimes(1)
      await userEvent.click(screen.getByRole('switch'))
      expect(unfollow).toHaveBeenCalledWith(PROJECT_ID, MAIL_THREAD_VARIANTS.followed.view.id)
      await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
    })

    it('lets a manager end someone else’s follow, by name', async () => {
      const { client } = renderTab('manager-follows')
      const unfollow = vi.spyOn(client, 'unfollow')
      const followers = await screen.findAllByTestId('mail-thread-follower')
      expect(followers).toHaveLength(2)
      await waitFor(() => expect(followers[0]).toHaveTextContent('Lukas Brandstätter'))
      await userEvent.click(within(followers[0]).getByRole('button', { name: 'End it for Lukas Brandstätter' }))
      expect(unfollow).toHaveBeenCalledWith(PROJECT_ID, MAIL_THREAD_VARIANTS['manager-follows'].view.id, { userId: 'user_01JLUKAS000000000000000000' })
      await waitFor(() => expect(screen.getAllByTestId('mail-thread-follower')).toHaveLength(1))
    })

    it('shows nobody else „End“: a member reads a count, and may not follow without filing rights', async () => {
      renderTab('member-sees-follows')
      expect(await screen.findByTestId('mail-thread-follow-others')).toHaveTextContent(`${PRODUCT_NAME} files replies in this mail thread without a click for 2 people.`)
      expect(screen.queryByTestId('mail-thread-followers')).toBeNull()
      expect(screen.queryByTestId('mail-thread-follower-end')).toBeNull()
      expect(screen.queryByRole('switch')).toBeNull()
    })

    it('words a refusal, never the server’s English', async () => {
      const client = fixtureMailThreadClient(MAIL_THREAD_VARIANTS['not-followed'])
      const { ApiRequestError } = await import('@/adapters/api/api-error')
      vi.spyOn(client, 'follow').mockRejectedValue(new ApiRequestError('Project is closed', 403, 'project-closed'))
      renderTab('not-followed', { client })
      await userEvent.click(await screen.findByRole('switch'))
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The project is closed. Reopen it first.'))
    })
  })

  it('shows what a mail added to the Verlauf, against the Verlauf before it', async () => {
    const { client } = renderTab('three-messages')
    const diff = vi.spyOn(client, 'diff')
    const newest = (await entries())[0]
    expect(within(newest).queryByRole('button', { name: 'What this mail added' })).toBeNull()
    await userEvent.click(within(newest).getByTestId('mail-entry-menu'))
    await userEvent.click(await screen.findByTestId('mail-thread-entry-compare'))
    expect(diff).toHaveBeenCalledWith(THREAD_DOCUMENT_ID, expect.any(String), expect.any(String))
    expect(await within(newest).findByTestId('mail-thread-entry-comparison')).toBeInTheDocument()
    await userEvent.click(within(newest).getByRole('button', { name: 'Hide the comparison for the mail of 14.10.2026 09:12 · Mag. Schober (ma37.wien.gv.at)' }))
    expect(within(newest).queryByTestId('mail-thread-entry-comparison')).toBeNull()
    await userEvent.click(within((await entries())[2]).getByTestId('mail-entry-menu'))
    expect(await screen.findByTestId('mail-entry-detach')).toBeInTheDocument()
    expect(screen.queryByTestId('mail-thread-entry-compare')).toBeNull()
  })

  it('heads the mails with their order, and keeps the original on the line that says when each came', async () => {
    renderTab('three-messages')
    expect(await screen.findByTestId('mail-thread-order')).toHaveTextContent('Newest first')
    const newest = (await entries())[0]
    const original = within(newest).getByRole('button', { name: 'Original (.eml)' })
    expect(original.closest('div')).toHaveTextContent(/^received \S+\s*Original \(\.eml\)/)
  })

  describe('detaching', () => {
    it('says the earlier revisions keep the mail, and moves it into the chosen thread', async () => {
      const { client } = renderTab('detach-confirm')
      const detach = vi.spyOn(client, 'detach')
      const statik = (await entries())[1]
      await userEvent.click(within(statik).getByTestId('mail-entry-menu'))
      await userEvent.click(await screen.findByTestId('mail-entry-detach'))
      const dialog = await screen.findByTestId('mail-thread-detach')
      expect(within(dialog).getByTestId('mail-thread-detach-keeps')).toHaveTextContent('The mail thread no longer contains this mail afterwards. Its earlier revisions under “Details” keep it.')
      expect(dialog).toHaveTextContent('Afterwards, replies in this mail thread are no longer filed without a click for anyone.')
      const confirm = screen.getByTestId('mail-thread-detach-confirm')
      expect(confirm).toBeDisabled()
      await userEvent.click(within(dialog).getByTestId('mail-thread-detach-target'))
      await userEvent.click(await screen.findByRole('option', { name: 'Fassadenmuster Hofseite' }))
      await userEvent.click(confirm)
      await waitFor(() => expect(detach).toHaveBeenCalledTimes(1))
      expect(detach.mock.calls[0][3]).toEqual({ target: { action: 'append', mailThreadId: expect.any(String) } })
      await waitFor(() => expect(screen.getAllByTestId('mail-thread-entry')).toHaveLength(2))
      expect(toast.success).toHaveBeenCalledWith('Mail moved into “Fassadenmuster Hofseite”', expect.objectContaining({ description: 'Replies are no longer filed without a click for 1 person' }))
    })

    it('says a refusal inside the dialog, which stays open', async () => {
      renderTab('detach-refused')
      const statik = (await entries())[1]
      await userEvent.click(within(statik).getByTestId('mail-entry-menu'))
      await userEvent.click(await screen.findByTestId('mail-entry-detach'))
      const dialog = await screen.findByTestId('mail-thread-detach')
      await userEvent.click(within(dialog).getByLabelText('As a new mail thread'))
      await userEvent.type(within(dialog).getByTestId('mail-thread-detach-name'), 'Stellplätze Hof')
      await userEvent.click(screen.getByTestId('mail-thread-detach-confirm'))
      expect(await within(dialog).findByTestId('mail-thread-detach-refusal')).toHaveTextContent('A document of this name is already in the project.')
      expect(screen.getByTestId('mail-thread-detach')).toBeInTheDocument()
    })

    it('asks before Escape leaves a typed name behind; keeping it keeps the name, confirming closes with nothing moved', async () => {
      const { client } = renderTab('detach-confirm')
      const detach = vi.spyOn(client, 'detach')
      const statik = (await entries())[1]
      await userEvent.click(within(statik).getByTestId('mail-entry-menu'))
      await userEvent.click(await screen.findByTestId('mail-entry-detach'))
      const dialog = await screen.findByTestId('mail-thread-detach')
      await userEvent.click(within(dialog).getByLabelText('As a new mail thread'))
      await userEvent.type(within(dialog).getByTestId('mail-thread-detach-name'), 'Stellplätze Hof')
      await userEvent.keyboard('{Escape}')
      expect(await screen.findByText('Leave without your changes?')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
      await waitFor(() => expect(screen.queryByText('Leave without your changes?')).not.toBeInTheDocument())
      expect(screen.getByTestId('mail-thread-detach-name')).toHaveValue('Stellplätze Hof')
      await userEvent.keyboard('{Escape}')
      await userEvent.click(await screen.findByTestId('unsaved-edit-confirm'))
      await waitFor(() => expect(screen.queryByTestId('mail-thread-detach')).not.toBeInTheDocument())
      expect(detach).not.toHaveBeenCalled()
    })

    it('closes at once when no name was typed', async () => {
      renderTab('detach-confirm')
      const statik = (await entries())[1]
      await userEvent.click(within(statik).getByTestId('mail-entry-menu'))
      await userEvent.click(await screen.findByTestId('mail-entry-detach'))
      await screen.findByTestId('mail-thread-detach')
      await userEvent.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByTestId('mail-thread-detach')).not.toBeInTheDocument())
      expect(screen.queryByText('Leave without your changes?')).not.toBeInTheDocument()
    })

    it('is not offered for the thread’s only mail, which cannot leave it', async () => {
      const single = { ...MAIL_THREAD_VARIANTS['three-messages'], view: { ...MAIL_THREAD_VARIANTS['three-messages'].view, entries: MAIL_THREAD_VARIANTS['three-messages'].view.entries.slice(0, 1) } }
      renderTab('three-messages', { client: fixtureMailThreadClient(single) })
      expect(await entries()).toHaveLength(1)
      expect(screen.queryByTestId('mail-entry-menu')).toBeNull()
    })

    it('is not offered to a reader who may not file mail', async () => {
      renderTab('member-sees-follows')
      await userEvent.click(within((await entries())[0]).getByTestId('mail-entry-menu'))
      expect(await screen.findByTestId('mail-thread-entry-compare')).toBeInTheDocument()
      expect(screen.queryByTestId('mail-entry-detach')).toBeNull()
    })
  })

  it('scrolls a linked entry into view and marks it', async () => {
    const fixture = MAIL_THREAD_VARIANTS.focused
    renderTab('focused', { focus: { entryId: fixture.focusEntryId } })
    const rows = await entries()
    const focused = rows.find((row) => row.dataset.focused)
    expect(focused?.dataset.entryId).toBe(fixture.focusEntryId)
    expect(focused).toHaveAttribute('aria-current', 'location')
    expect(focused).toHaveAttribute('data-current', 'true')
    expect(focused?.className).not.toMatch(/border-l/)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(focused))
  })

  it('says a failed read and reads again', async () => {
    const client = fixtureMailThreadClient(MAIL_THREAD_VARIANTS.error)
    const get = vi.spyOn(client, 'get')
    renderTab('error', { client })
    expect(await screen.findByText('The mails of this mail thread could not be loaded.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('says a confirmed domain once per run of its mails, and an unconfirmed one on every mail', async () => {
    renderTab('same-sender')
    const rows = await entries()
    const said = rows.map((row) => within(row).queryByTestId('mail-thread-entry-trust')?.textContent ?? null)
    expect(said).toEqual(['Domain verified: statik-weber.at', null, null, 'Domain verified: huber-architektur.at'])
  })

  it('keeps the heading exactly as the document prints it, while it wraps between date, name and domain', async () => {
    renderTab('three-messages')
    const [newest] = await entries()
    expect(within(newest).getByTestId('mail-thread-entry-heading')).toHaveTextContent('14.10.2026 09:12 · Mag. Schober (ma37.wien.gv.at)')
  })
})

describe('the E-Mails tab’s words and dialog', () => {
  it('leaves a place to wrap after the date, so a long German name hyphenates rather than breaking anywhere', async () => {
    renderTab('worst-case')
    const heading = (await entries()).map((row) => within(row).getByTestId('mail-thread-entry-heading')).find((node) => node.textContent?.includes('Rechtsanwaltskanzlei')) as HTMLElement
    expect(heading).toHaveAttribute('lang', 'de')
    const [date, name] = Array.from(heading.children) as HTMLElement[]
    expect(date.className).toContain('whitespace-nowrap')
    expect(date.textContent?.endsWith(' ')).toBe(false)
    expect(name.className).toContain('hyphens-auto')
    expect(name.className).not.toContain('anywhere')
  })

  it('names a file on one line, cut in its middle, not over lines that each carry an underline', async () => {
    renderTab('worst-case')
    const link = (await screen.findAllByTestId('mail-thread-attachment-link'))[0]
    expect(link.querySelector('[data-fitted], .truncate')).not.toBeNull()
  })

  it('asks where to as the app’s form dialog: the dialog takes the focus, no radio, and „Cancel“ is a raised press', async () => {
    renderTab('detach-confirm')
    const statik = (await entries())[1]
    await userEvent.click(within(statik).getByTestId('mail-entry-menu'))
    await userEvent.click(await screen.findByTestId('mail-entry-detach'))
    await screen.findByTestId('mail-thread-detach')
    expect(screen.getByRole('dialog')).toHaveFocus()
    expect(screen.getAllByRole('radio').some((radio) => radio === document.activeElement)).toBe(false)
    const cancel = screen.getByTestId('mail-thread-detach-cancel')
    expect(cancel.className).toContain('shadow-press')
    expect(screen.getByTestId('mail-thread-detach-confirm').className).not.toContain('bg-destructive')
  })
})
