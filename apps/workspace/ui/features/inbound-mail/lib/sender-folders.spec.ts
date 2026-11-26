import { describe, expect, it } from 'vitest'
import { translatorFor } from '@/i18n/namespace'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'
import type { InboundMailSenderView } from '@/lib/inbound-mail/inbound-mail-wire'
import { senderFolderPicks, senderMemoryName, senderMemoryReason, type SenderMemoryCopy } from './sender-folders'

const FACADE = '11111111-1111-4111-8111-111111111111'
const PLANS = '22222222-2222-4222-8222-222222222222'

const sender: InboundMailSenderView = {
  name: 'Petra Weber',
  address: 'p.weber@fassade-weber.at',
  domain: 'fassade-weber.at',
  signerDomain: null,
  trust: 'external_unverified',
  reason: 'dkim_none',
  flags: [],
}

function copyIn(locale: 'de' | 'en'): SenderMemoryCopy {
  const t = translatorFor(inboundMailCopy, locale)
  return {
    pick: (count, name) => t('senderMemory.pick', { count, name }),
    suggestion: (name) => t('senderMemory.suggestion', { name }),
  }
}

const senderFolders = [
  { folderId: FACADE, path: 'Planung/Fassade', count: 3 },
  { folderId: PLANS, path: 'Planung', count: 1 },
]

describe('senderFolderPicks', () => {
  it('offers the folders in the order the server gave, each saying how many of this sender’s attachments went there', () => {
    expect(senderFolderPicks({ sender, senderFolders }, copyIn('de'))).toEqual([
      { folderId: FACADE, path: 'Planung/Fassade', count: 3, reason: 'Hierhin gingen 3 Anhänge von Petra Weber' },
      { folderId: PLANS, path: 'Planung', count: 1, reason: 'Hierhin ging 1 Anhang von Petra Weber' },
    ])
    expect(senderFolderPicks({ sender, senderFolders }, copyIn('en')).map((pick) => pick.reason)).toEqual([
      '3 attachments from Petra Weber went here',
      '1 attachment from Petra Weber went here',
    ])
  })

  it('names the sender by the address when the mail carried no name', () => {
    const [pick] = senderFolderPicks({ sender: { ...sender, name: '  ' }, senderFolders }, copyIn('de'))
    expect(pick?.reason).toBe('Hierhin gingen 3 Anhänge von p.weber@fassade-weber.at')
  })

  it('leaves out a folder the reader may not write into', () => {
    const picks = senderFolderPicks({ sender, senderFolders }, copyIn('de'), { writable: (folderId) => folderId !== FACADE })
    expect(picks.map((pick) => pick.folderId)).toEqual([PLANS])
  })

  it('offers nothing without a sender or without earlier filings', () => {
    expect(senderFolderPicks({ sender: null, senderFolders }, copyIn('de'))).toEqual([])
    expect(senderFolderPicks({ sender, senderFolders: [] }, copyIn('de'))).toEqual([])
  })
})

describe('senderMemoryReason', () => {
  const memory = { folderId: FACADE, folderPath: 'Planung/Fassade', newFolder: false, documentType: null, reason: '', source: 'sender_memory' as const }

  it('says the folder comes from the sender’s earlier mails, not from the agent', () => {
    expect(senderMemoryReason({ sender }, { suggestion: memory }, copyIn('de'))).toBe('Wie die letzten E-Mails von Petra Weber')
    expect(senderMemoryReason({ sender }, { suggestion: memory }, copyIn('en'))).toBe('Like the last emails from Petra Weber')
  })

  it('says nothing for the agent’s own suggestion or none', () => {
    const model = { ...memory, reason: 'Fassadenpläne.', source: 'model' as const }
    expect(senderMemoryReason({ sender }, { suggestion: model }, copyIn('de'))).toBeNull()
    expect(senderMemoryReason({ sender }, { suggestion: { ...model, source: undefined } }, copyIn('de'))).toBeNull()
    expect(senderMemoryReason({ sender }, { suggestion: null }, copyIn('de'))).toBeNull()
  })

  it('names the sender as the folder picks do', () => {
    expect(senderMemoryName(null)).toBeNull()
    expect(senderMemoryName({ name: null, address: 'p.weber@fassade-weber.at' })).toBe('p.weber@fassade-weber.at')
  })
})
