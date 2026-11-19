import { describe, expect, it } from 'vitest'
import { FOLDERS, mail, messagePart, part, thread } from '@/app/dev/inbound-mail/fixtures'
import {
  checkAllAttachments,
  checkedAttachmentIds,
  decisionOf,
  fileCheckedInto,
  rebaseDraft,
  draftSummary,
  initialDraft,
  targetForPath,
  updateAttachment,
  updateMessage,
  type DraftCopy,
} from './draft'

const copy: DraftCopy = { unnamedAttachment: (position) => `Attachment ${position}`, untitledThread: '(no subject)' }
const permitDecision = part({ name: 'Bescheid.pdf', suggestion: { folderId: null, folderPath: 'Behörde/Bescheide', newFolder: false, documentType: 'Bescheid', reason: 'MA 37' } })
const message = messagePart({ id: '11111111-1111-4111-8111-111111111111' })

describe('targetForPath', () => {
  it('resolves a path the project has to its folder, anything else to a folder filing creates', () => {
    expect(targetForPath('Behörde/Bescheide', FOLDERS)).toMatchObject({ kind: 'existing', path: 'Behörde/Bescheide' })
    expect(targetForPath(' Fotos / Baustelle ', FOLDERS)).toEqual({ kind: 'new', path: 'Fotos/Baustelle' })
    expect(targetForPath('', FOLDERS)).toEqual({ kind: 'existing', folderId: null, path: '' })
  })
})

describe('initialDraft', () => {
  it('takes the agent’s suggestion and the pre-selected thread', () => {
    const view = mail({ parts: [message, permitDecision] })
    const draft = initialDraft(view, FOLDERS, copy)
    expect(draft.message).toMatchObject({ checked: true, target: { kind: 'append', threadId: view.threadCandidates[0].threadId } })
    expect(draft.attachments[0]).toMatchObject({
      checked: true,
      name: 'Bescheid.pdf',
      documentType: 'Bescheid',
      folder: { kind: 'existing', path: 'Behörde/Bescheide' },
      suggested: { folder: true, name: false, documentType: true },
    })
  })

  it('starts a new thread named after the subject where none is pre-selected', () => {
    const view = mail({ subject: 'AW: Baustellenbegehung', parts: [message], threadCandidates: [thread({ preselected: false, blocks: ['weak_match'] })] })
    expect(initialDraft(view, FOLDERS, copy).message?.target).toEqual({
      kind: 'create',
      name: 'Baustellenbegehung',
      folder: { kind: 'existing', folderId: FOLDERS[3].id, path: 'Korrespondenz' },
      folderSuggested: false,
      releaseName: false,
    })
  })

  it('leaves an already filed text unchecked, and asks to mask a text with findings', () => {
    const view = mail({ parts: [messagePart({ id: message.id, contentFindings: ['iban'] })], sender: { ...mail().sender!, flags: ['already_filed'] } })
    const draft = initialDraft(view, FOLDERS, copy)
    expect(draft.message).toMatchObject({ checked: false, findingChoice: 'masked' })
  })

  it('names a nameless part by its position', () => {
    const view = mail({ parts: [message, part({ filename: null, position: 4, contentType: 'image/png' })] })
    expect(initialDraft(view, FOLDERS, copy).attachments[0].name).toBe('Attachment 4')
  })
})

describe('edits', () => {
  it('a field stops being the agent’s once the person gives it another value', () => {
    const view = mail({ parts: [message, permitDecision] })
    const draft = initialDraft(view, FOLDERS, copy)
    const same = updateAttachment(draft, permitDecision.id, { name: 'Bescheid.pdf', documentType: 'Bescheid' })
    expect(same.attachments[0].suggested).toEqual({ folder: true, name: false, documentType: true })
    const edited = updateAttachment(draft, permitDecision.id, { documentType: 'Gutachten' })
    expect(edited.attachments[0].suggested.documentType).toBe(false)
  })

  it('a text with findings filed unabridged as a new thread is the old „Getrennt ablegen“: full text, a thread of its own', () => {
    const view = mail({ parts: [messagePart({ id: message.id, contentFindings: ['term'] })] })
    const draft = updateMessage(initialDraft(view, FOLDERS, copy), {
      findingChoice: 'full',
      target: { kind: 'create', name: 'Kontodaten', folder: targetForPath('Korrespondenz', FOLDERS), folderSuggested: false, releaseName: false },
    })
    expect(decisionOf(view, draft).message).toMatchObject({ text: 'full', thread: { action: 'create' } })
    expect(decisionOf(view, updateMessage(draft, { findingChoice: 'masked' })).message).toMatchObject({ text: 'masked' })
  })
})

describe('draftSummary', () => {
  it('counts what will be filed and names the thread', () => {
    const view = mail({ parts: [message, permitDecision] })
    const summary = draftSummary(view, initialDraft(view, FOLDERS, copy))
    expect(summary).toMatchObject({
      files: 1,
      text: true,
      thread: { name: 'Stellplatznachweis', nextVersion: 4 },
      blockers: [],
    })
  })

  it('says a dismissal is erased at once only for an unconfirmed outsider', () => {
    const outsider = mail({ sender: { ...mail().sender!, trust: 'external_unverified', reason: 'dkim_none', signerDomain: null }, threadCandidates: [] })
    expect(draftSummary(outsider, initialDraft(outsider, FOLDERS, copy)).dismissErases).toBe(true)
    const confirmed = mail()
    expect(draftSummary(confirmed, initialDraft(confirmed, FOLDERS, copy)).dismissErases).toBe(false)
  })

  it('blocks on a missing folder, an unreleased name, an unaccepted risk and an unconfirmed sender', () => {
    const view = mail({
      sender: { ...mail().sender!, trust: 'member_unverified', reason: 'dkim_none', signerDomain: null },
      parts: [message, part({ name: 'a.pdf' }), part({ name: 'Honorar.pdf', riskFlags: ['name_stop'] }), part({ name: 'm.docm', riskFlags: ['macro'] })],
      threadCandidates: [],
    })
    let draft = initialDraft(view, FOLDERS, copy)
    for (const attachment of draft.attachments) draft = updateAttachment(draft, attachment.partId, { checked: true })
    const kinds = draftSummary(view, draft).blockers.map((blocker) => blocker.kind)
    expect(kinds).toEqual(['folder_missing', 'name_stop', 'risk', 'sender'])
  })

  it('asks the thread acknowledgement only for blocks other than a weak match', () => {
    const blocked = mail({ parts: [message], threadCandidates: [thread({ preselected: false, blocks: ['header_not_signed'] })] })
    const draft = updateMessage(initialDraft(blocked, FOLDERS, copy), { target: { kind: 'append', threadId: blocked.threadCandidates[0].threadId } })
    expect(draftSummary(blocked, draft).blockers).toEqual([{ kind: 'risk', count: 1 }])
    const weak = mail({ parts: [message], threadCandidates: [thread({ preselected: false, blocks: ['weak_match'] })] })
    const weakDraft = updateMessage(initialDraft(weak, FOLDERS, copy), { target: { kind: 'append', threadId: weak.threadCandidates[0].threadId } })
    expect(draftSummary(weak, weakDraft).blockers).toEqual([])
  })
})

describe('decisionOf', () => {
  it('names only the checked parts, with the folder as id or path', () => {
    const fotos = part({ name: 'f.jpg', suggestion: { folderId: null, folderPath: 'Fotos', newFolder: true, documentType: null, reason: 'x' } })
    const unsuggested = part({ name: 'x.pdf' })
    const view = mail({ parts: [message, permitDecision, fotos, unsuggested] })
    const draft = updateAttachment(initialDraft(view, FOLDERS, copy), unsuggested.id, { checked: false })
    const decision = decisionOf(view, draft)
    expect(decision.parts).toEqual([
      { partId: permitDecision.id, folderId: FOLDERS[1].id, newFolderPath: null, name: 'Bescheid.pdf', documentType: 'Bescheid' },
      { partId: fotos.id, folderId: null, newFolderPath: 'Fotos', name: 'f.jpg' },
    ])
    expect(decision.message).toEqual({ partId: message.id, text: 'full', thread: { action: 'append', mailThreadId: view.threadCandidates[0].threadId } })
    expect(decision).not.toHaveProperty('acknowledgeSender')
    expect(decision).not.toHaveProperty('acknowledgeRisk')
  })

  it('carries the person’s acknowledgements for one mail, never in bulk (RT-S5)', () => {
    const macro = part({ name: 'm.docm', riskFlags: ['macro'], suggestion: { folderId: null, folderPath: 'Tragwerk', newFolder: false, documentType: null, reason: 'x' } })
    const view = mail({ sender: { ...mail().sender!, flags: ['stale_date'] }, parts: [message, macro] })
    let draft = initialDraft(view, FOLDERS, copy)
    draft = updateAttachment(draft, macro.id, { checked: true, acknowledgeRisk: true })
    draft = { ...draft, acknowledgeSender: true }
    expect(decisionOf(view, draft)).toMatchObject({ acknowledgeSender: true, acknowledgeRisk: [macro.id] })
    const bulk = decisionOf(view, draft, { bulk: true })
    expect(bulk).not.toHaveProperty('acknowledgeSender')
    expect(bulk).not.toHaveProperty('acknowledgeRisk')
  })

  it('files the text masked only where the person chose it', () => {
    const view = mail({ parts: [messagePart({ id: message.id, contentFindings: ['iban'] })] })
    expect(decisionOf(view, initialDraft(view, FOLDERS, copy)).message?.text).toBe('masked')
    const full = updateMessage(initialDraft(view, FOLDERS, copy), { findingChoice: 'full' })
    expect(decisionOf(view, full).message?.text).toBe('full')
  })

  it('carries a thread name release only on a new thread', () => {
    const view = mail({ parts: [message], threadCandidates: [] })
    const draft = initialDraft(view, FOLDERS, copy)
    const released = updateMessage(draft, { target: { ...(draft.message!.target as Extract<typeof draft.message, object>['target'] & { kind: 'create' }), releaseName: true } })
    expect(decisionOf(view, released).message?.thread).toMatchObject({ action: 'create', screeningRelease: 'name' })
  })
})

describe('newThreadTarget', () => {
  it('takes the folder the agent suggested for the text (D14)', () => {
    const view = mail({ parts: [messagePart({ id: message.id, suggestion: { folderId: null, folderPath: 'Behörde', newFolder: false, documentType: null, reason: 'x' } })], threadCandidates: [] })
    expect(initialDraft(view, FOLDERS, copy).message?.target).toMatchObject({ kind: 'create', folder: { kind: 'existing', path: 'Behörde' }, folderSuggested: true })
  })
})

describe('a plan set at once', () => {
  const plans = [1, 2, 3].map((index) => part({ name: `Plan_${index}.pdf` }))
  const infected = part({ name: 'Virus.pdf', scan: 'infected' })
  const view = mail({ parts: [message, ...plans, infected] })

  it('ticks and unticks every attachment it can file, and none it cannot', () => {
    const all = checkAllAttachments(initialDraft(view, FOLDERS, copy), view, true)
    expect(checkedAttachmentIds(all, view)).toEqual(plans.map((plan) => plan.id))
    expect(all.attachments.find((attachment) => attachment.partId === infected.id)?.checked).toBe(false)
    expect(checkedAttachmentIds(checkAllAttachments(all, view, false), view)).toEqual([])
  })

  it('sends the ticked ones to one folder, and leaves a chosen next Fassung where its document is', () => {
    let draft = checkAllAttachments(initialDraft(view, FOLDERS, copy), view, true)
    draft = updateAttachment(draft, plans[2].id, { revisionOf: 'doc-1' })
    const target = targetForPath('Tragwerk', FOLDERS)
    const result = fileCheckedInto(draft, view, target)
    expect(result).toMatchObject({ moved: 2, revisions: 1 })
    expect(result.draft.attachments.filter((attachment) => attachment.folder?.path === 'Tragwerk').map((attachment) => attachment.partId)).toEqual([plans[0].id, plans[1].id])
    expect(draftSummary(view, result.draft).blockers).not.toContainEqual(expect.objectContaining({ kind: 'folder_missing' }))
  })
})

describe('rebaseDraft', () => {
  const first = part({ name: 'A.pdf' })
  const second = part({ name: 'B.pdf', scan: 'pending' })
  const before = mail({ parts: [message, first, second] })

  it('keeps every choice the person made when the re-read mail has the same parts', () => {
    const base = initialDraft(before, FOLDERS, copy)
    const edited = updateAttachment(updateAttachment(base, first.id, { checked: true, folder: targetForPath('Tragwerk', FOLDERS) }), first.id, { name: 'A_Index_C.pdf' })
    const after = mail({ parts: [message, first, { ...second, scan: 'clean', preselected: true, suggestion: { folderId: null, folderPath: 'Behörde', newFolder: false, documentType: null, reason: 'x' } }] })
    const fresh = initialDraft(after, FOLDERS, copy)
    const rebased = rebaseDraft({ ...edited, acknowledgeSender: true }, base, fresh)
    expect(rebased.attachments.find((attachment) => attachment.partId === first.id)).toMatchObject({ checked: true, name: 'A_Index_C.pdf', folder: { path: 'Tragwerk' } })
    // The part nobody touched takes what the re-read brought: its scan passed and a suggestion arrived.
    expect(rebased.attachments.find((attachment) => attachment.partId === second.id)).toMatchObject({ checked: true, folder: { path: 'Behörde' } })
    expect(rebased.ifMatch).toBe(fresh.ifMatch)
    expect(rebased.acknowledgeSender).toBe(true)
  })

  it('starts over when the parts changed, or the mail is another', () => {
    const base = initialDraft(before, FOLDERS, copy)
    const edited = updateAttachment(base, first.id, { name: 'X.pdf' })
    const fewer = initialDraft(mail({ parts: [message, first] }), FOLDERS, copy)
    expect(rebaseDraft(edited, base, fewer)).toBe(fewer)
    const other = initialDraft(mail({ key: 'other', parts: [message, first, second] }), FOLDERS, copy)
    expect(rebaseDraft(edited, base, other)).toBe(other)
  })
})
