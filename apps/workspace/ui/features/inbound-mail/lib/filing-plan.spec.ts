import { describe, expect, it } from 'vitest'
import { DETAIL_VARIANTS, FOLDERS, mail, messagePart, part, thread } from '@/app/dev/inbound-mail/fixtures'
import { initialDraft, targetForPath, updateAttachment, updateMessage, type DraftCopy } from './draft'
import {
  attachmentOpenReason,
  fileAllInto,
  filingSteps,
  folderlessIds,
  keptWithoutFolder,
  leavesParts,
  openAttachmentIds,
  planLines,
  quickPicks,
  textNeedsDecision,
  type MissingSuggestion,
} from './filing-plan'
import { attachmentCase } from './attachment-case'

const copy: DraftCopy = { unnamedAttachment: (position) => `Attachment ${position}`, untitledThread: '(no subject)' }
const message = messagePart({ id: '11111111-1111-4111-8111-111111111111' })
const permitDecision = part({ name: 'Bescheid.pdf', suggestion: { folderId: null, folderPath: 'Behörde/Bescheide', newFolder: false, documentType: 'Bescheid', reason: 'MA 37' } })

const stepsOf = (name: string, missing: MissingSuggestion = 'none') => {
  const { view } = DETAIL_VARIANTS[name]
  return filingSteps(view, initialDraft(view, FOLDERS, copy), { missing })
}

describe('which steps a draft needs', () => {
  it('needs only „Übersicht“ when every part has a confident proposal', () => {
    expect(stepsOf('member-verified')).toEqual(['overview'])
    expect(stepsOf('mixed-attachments')).toEqual(['overview'])
    expect(stepsOf('thread-append')).toEqual(['overview'])
  })

  it('asks for the one confirmation the server wants: the own address, a colleague’s, the forgery’s phone check', () => {
    expect(stepsOf('own-unverified')).toContain('sender')
    expect(stepsOf('own-unverified')[0]).toBe('sender')
    expect(stepsOf('impersonation')[0]).toBe('sender')
    expect(stepsOf('member-verified')).not.toContain('sender')
  })

  it('asks where the text goes while an E-Mail-Verlauf could be chosen but none is preselected, or the match is unsure; a new one with nothing to choose is the proposal', () => {
    expect(stepsOf('new-thread')).toEqual(['overview'])
    expect(stepsOf('external-unverified')).not.toContain('text')
    expect(stepsOf('unverified-thread')).toContain('text')
    const unsure = mail({ parts: [message], threadCandidates: [thread({ blocks: ['weak_match'] })] })
    expect(textNeedsDecision(unsure, initialDraft(unsure, FOLDERS, copy))).toBe(true)
  })

  it('asks about a text that holds a content finding, even with its E-Mail-Verlauf preselected', () => {
    expect(stepsOf('content-finding')).toEqual(['text', 'overview'])
  })

  it('asks about an attachment without a folder, a pending suggestion and an unsure revision, and never about a copy the project has', () => {
    const { view } = DETAIL_VARIANTS['external-unverified']
    const draft = initialDraft(view, FOLDERS, copy)
    const attachment = view.parts.find((candidate) => candidate.kind === 'attachment')!
    const row = draft.attachments.find((candidate) => candidate.partId === attachment.id)!
    expect(attachmentOpenReason(attachmentCase(attachment, view), row, 'none')).toBe('no_folder')
    expect(attachmentOpenReason(attachmentCase(attachment, view), row, 'pending')).toBe('pending')
    expect(stepsOf('external-unverified')).toEqual(['attachments', 'overview'])

    const unverified = DETAIL_VARIANTS['unverified-thread'].view
    const plan = unverified.parts.find((candidate) => candidate.kind === 'attachment')!
    const planRow = initialDraft(unverified, FOLDERS, copy).attachments[0]
    expect(attachmentOpenReason(attachmentCase(plan, unverified), planRow, 'none')).toBe('revision_unsure')
    expect(stepsOf('unverified-thread')).toEqual(['text', 'attachments', 'overview'])

    const mixed = DETAIL_VARIANTS['mixed-attachments'].view
    expect(openAttachmentIds(mixed, initialDraft(mixed, FOLDERS, copy), 'none')).toEqual([])
  })

  it('keeps a step the person asks for from „Übersicht“, in its place', () => {
    const { view } = DETAIL_VARIANTS['member-verified']
    expect(filingSteps(view, initialDraft(view, FOLDERS, copy), { missing: 'none', also: ['attachments', 'text'] })).toEqual(['text', 'attachments', 'overview'])
  })

  it('stops asking about an attachment once it has a folder', () => {
    const { view } = DETAIL_VARIANTS['external-unverified']
    const draft = initialDraft(view, FOLDERS, copy)
    const id = folderlessIds(view, draft, 'none')[0]
    const placed = fileAllInto(draft, [id], targetForPath('Behörde', FOLDERS)).draft
    expect(openAttachmentIds(view, placed, 'none')).toEqual([])
  })
})

describe('what „Übersicht“ says, part by part', () => {
  it('says where the text and every attachment go, and what stays out', () => {
    const { view } = DETAIL_VARIANTS['mixed-attachments']
    const lines = planLines(view, initialDraft(view, FOLDERS, copy), copy)
    expect(lines.map((line) => line.kind)).toEqual(['text_append', 'revision', 'file', 'file', 'left', 'file', 'left'])
    expect(lines[0]).toMatchObject({ thread: 'Stellplatznachweis', masked: false })
    expect(lines[1]).toMatchObject({ name: 'S-101_D.pdf', version: 4, of: 'S-101_C.pdf' })
    expect(lines[3]).toMatchObject({ name: 'Foto_Baustelle.jpg', folder: 'Fotos', newFolder: true, documentType: 'Foto' })
    expect(lines[4]).toMatchObject({ name: 'Bescheid_alt.pdf', why: 'duplicate' })
    expect(lines[6]).toMatchObject({ name: 'Attachment 6', why: 'image' })
    expect(leavesParts(lines)).toBe(true)
  })

  it('says the text stays out once unticked, and a masked text as masked', () => {
    const view = mail({ parts: [message, permitDecision] })
    const draft = initialDraft(view, FOLDERS, copy)
    expect(planLines(view, updateMessage(draft, { checked: false }), copy)[0]).toEqual({ kind: 'text_left', partId: message.id, includable: true })
    const finding = DETAIL_VARIANTS['content-finding'].view
    expect(planLines(finding, initialDraft(finding, FOLDERS, copy), copy)[0]).toMatchObject({ kind: 'text_append', masked: true })
  })

  it('names a new E-Mail-Verlauf with its folder, and an attachment without folder as such', () => {
    const { view } = DETAIL_VARIANTS['external-unverified']
    const lines = planLines(view, initialDraft(view, FOLDERS, copy), copy)
    expect(lines[0]).toMatchObject({ kind: 'text_create', thread: 'Angebot Fassadenreinigung', folder: 'Korrespondenz' })
    expect(lines[1]).toMatchObject({ kind: 'no_folder', name: 'Angebot_2026.pdf' })
  })

  it('says a part the scan has not cleared stays out, which is what filing does to it', () => {
    const { view } = DETAIL_VARIANTS['scan-pending']
    const lines = planLines(view, initialDraft(view, FOLDERS, copy), copy)
    expect(lines.filter((line) => line.kind === 'left').map((line) => line.kind === 'left' && line.why)).toEqual(['scan_pending', 'scan_failed'])
  })

  it('names a renamed attachment by its name and the name it is filed under', () => {
    const view = mail({ parts: [message, permitDecision] })
    const draft = initialDraft(view, FOLDERS, copy)
    const renamed = updateAttachment(draft, draft.attachments[0].partId, { name: 'Bescheid MA 37.pdf' })
    expect(planLines(view, renamed, copy)[1]).toMatchObject({ kind: 'file', name: 'Bescheid.pdf', rename: 'Bescheid MA 37.pdf' })
  })
})

describe('what keeps „Weiter“ and what „Übersicht“ leaves out', () => {
  it('counts the kept attachments without a folder, and none once each has one or is unticked', () => {
    const { view } = DETAIL_VARIANTS['unknown-plan-set']
    const draft = initialDraft(view, FOLDERS, copy)
    expect(keptWithoutFolder(view, draft)).toBe(3)
    const [first, second, third] = draft.attachments.map((row) => row.partId)
    const placed = fileAllInto(draft, [first!, second!], targetForPath('Pläne/Fassade', FOLDERS)).draft
    expect(keptWithoutFolder(view, placed)).toBe(1)
    expect(keptWithoutFolder(view, updateAttachment(placed, third!, { checked: false }))).toBe(0)
  })

  it('says why a file stays out, and offers „Doch ablegen“ only where filing it is the person’s call', () => {
    const named = part({ name: 'Honorarnote.pdf', riskFlags: ['name_stop'], nameStopTerms: ['Honorar'] })
    const copyOf = part({ name: 'Bescheid_alt.pdf', duplicateOf: { documentId: 'd', name: 'Bescheid_alt.pdf', folderPath: 'Behörde' } })
    const view = mail({ parts: [message, named, copyOf] })
    const lines = planLines(view, initialDraft(view, FOLDERS, copy), copy)
    expect(lines.find((line) => line.partId === named.id)).toMatchObject({ kind: 'left', why: 'name_stop', terms: ['Honorar'], includable: true })
    expect(lines.find((line) => line.partId === copyOf.id)).toMatchObject({ kind: 'left', why: 'duplicate', includable: false })
  })

  it('takes extra quick picks right after the agent’s suggestion, once each', () => {
    const { view } = DETAIL_VARIANTS['external-unverified']
    const draft = initialDraft(view, FOLDERS, copy)
    const ids = folderlessIds(view, draft, 'none')
    const earlier = { target: targetForPath('Pläne/Fassade', FOLDERS), why: 'sibling' as const, of: 'Angebot_2025.pdf' }
    expect(quickPicks(view, draft, ids, FOLDERS, copy, { extra: [earlier, earlier] }).map((pick) => pick.target.path)).toEqual(['Pläne/Fassade'])
  })
})

describe('one folder for the attachments without one', () => {
  it('offers the folders this mail’s other attachments go to first, each once', () => {
    const view = mail({
      parts: [
        message,
        permitDecision,
        part({ name: 'Beilage.pdf' }),
        part({ name: 'S-101_D.pdf', revisionCandidate: { documentId: '22222222-2222-4222-8222-222222222222', name: 'S-101_C.pdf', folderPath: 'Tragwerk', nextVersion: 4 } }),
      ],
    })
    const draft = initialDraft(view, FOLDERS, copy)
    const ids = folderlessIds(view, draft, 'none')
    expect(ids).toHaveLength(1)
    expect(quickPicks(view, draft, ids, FOLDERS, copy).map((pick) => [pick.why, pick.target.path, pick.of])).toEqual([
      ['sibling', 'Behörde/Bescheide', 'Bescheid.pdf'],
      ['sibling', 'Tragwerk', 'S-101_D.pdf'],
    ])
  })

  it('sends every ticked one there, and ticks them all when none was', () => {
    const view = mail({ parts: [message, part({ name: 'A.pdf' }), part({ name: 'B.pdf' })], sender: { ...mail().sender!, trust: 'external_unverified', reason: 'dkim_none', signerDomain: null } })
    const draft = initialDraft(view, FOLDERS, copy)
    const ids = draft.attachments.map((row) => row.partId)
    const target = targetForPath('Behörde', FOLDERS)
    const some = fileAllInto(updateAttachment(draft, ids[1], { checked: false }), ids, target)
    expect(some.moved).toBe(1)
    expect(some.draft.attachments.map((row) => [row.checked, row.folder?.path ?? null])).toEqual([
      [true, 'Behörde'],
      [false, null],
    ])
    const none = fileAllInto(
      ids.reduce((current, id) => updateAttachment(current, id, { checked: false }), draft),
      ids,
      target,
    )
    expect(none.moved).toBe(2)
    expect(none.draft.attachments.every((row) => row.checked && row.folder?.path === 'Behörde')).toBe(true)
  })
})
