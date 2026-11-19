import type {
  BaseKnowledgeEntry,
  BaseKnowledgeFolders,
  EntryValues,
  NormRecognition,
} from '@/lib/base-knowledge/wire'

const ROOT = '00000000-0000-4000-8000-000000000001'
export const FOLDER_IDS = {
  root: ROOT,
  fire: '00000000-0000-4000-8000-000000000002',
  sound: '00000000-0000-4000-8000-000000000003',
  access: '00000000-0000-4000-8000-000000000004',
  vienna: '00000000-0000-4000-8000-000000000005',
  commentaries: '00000000-0000-4000-8000-000000000006',
}

const folder = (
  id: string,
  name: string,
  parentId = ROOT,
  parentPath = 'Grundlagen des Büros'
) => ({
  id,
  parentId,
  name,
  path: `${parentPath}/${name}`,
  description: null,
})

export const BASE_KNOWLEDGE_TERRITORIES = [
  { id: 'AT', label: null },
  ...[
    ['AT-1', 'Burgenland'],
    ['AT-2', 'Kärnten'],
    ['AT-3', 'Niederösterreich'],
    ['AT-4', 'Oberösterreich'],
    ['AT-5', 'Salzburg'],
    ['AT-6', 'Steiermark'],
    ['AT-7', 'Tirol'],
    ['AT-8', 'Vorarlberg'],
    ['AT-9', 'Wien'],
  ].map(([id, label]) => ({ id, label })),
]

export const BASE_KNOWLEDGE_FOLDERS: BaseKnowledgeFolders = {
  rootId: ROOT,
  nextCursor: null,
  folders: [
    folder(FOLDER_IDS.access, 'Barrierefreiheit'),
    folder(FOLDER_IDS.fire, 'Brandschutz'),
    folder(FOLDER_IDS.commentaries, 'Kommentare'),
    folder(FOLDER_IDS.sound, 'Schallschutz'),
    folder(FOLDER_IDS.vienna, 'Weisungen Wien'),
  ],
}

const check = (checkedAt: string, result: 'current' | 'newer_known' = 'current') => ({
  checkedAt,
  checkedBy: 'user_1',
  result,
  note: null,
})

function entry(
  id: string,
  values: Partial<EntryValues>,
  rest: Partial<BaseKnowledgeEntry> = {}
): BaseKnowledgeEntry {
  const editionLabel = values.editionLabel ?? '2017-04-01'
  return {
    id,
    editionId: `edition_${id}`,
    copyId: `manifestation_${id}`,
    documentId: `doc_${id}`,
    fileName: `${id}.pdf`,
    status: 'confirmed',
    proposedBy: 'person',
    confirmedBy: 'user_1',
    confirmedByName: 'Anna Berger',
    textUse: 'used',
    aiProcessingAttestedAt: '2026-10-01T00:00:00.000Z',
    folderId: FOLDER_IDS.access,
    workId: `work_${id}`,
    editions: [],
    createdAt: '2026-10-01T08:00:00.000Z',
    values: {
      kind: 'technical_standard',
      title: 'Barrierefreies Bauen',
      designation: 'ÖNORM B 1600:2017',
      editionLabel,
      issuedOn: /^\d{4}-\d{2}-\d{2}$/.test(editionLabel) ? editionLabel : null,
      inForceFrom: null,
      inForceTo: null,
      territoryIds: [],
      issuer: 'Austrian Standards',
      addressees: [],
      licenceClass: 'licensed',
      ...values,
    },
    freshness: {
      intervalDays: 365,
      lastCheck: check('2026-10-02T09:00:00.000Z'),
      dueAt: '2027-10-02T09:00:00.000Z',
      overdue: false,
    },
    binding: null,
    ...rest,
  }
}

const NEVER = { intervalDays: 365, lastCheck: null, dueAt: null, overdue: true }

const VIA = { designation: 'OIB-RL 4', editionLabel: '2023' }
const binds = (editionLabel: string, held: boolean) => ({ editionLabel, startsOn: editionLabel, via: VIA, held, newer: !held })

const ENTRIES: BaseKnowledgeEntry[] = [
  entry(
    'oenorm-b-1300',
    {
      designation: 'ÖNORM B 1300:2018',
      title: 'Objektsicherheitsprüfungen für Wohngebäude',
      editionLabel: '2018-11-01',
    },
    {
      status: 'proposed',
      proposedBy: 'reading',
      confirmedBy: null,
      confirmedByName: null,
      fileName: 'OENORM_B_1300_2018-11-01.pdf',
      folderId: ROOT,
      freshness: NEVER,
    }
  ),
  entry(
    'din-4109',
    {
      designation: 'DIN 4109-1:2018',
      title: 'Schallschutz im Hochbau – Teil 1: Mindestanforderungen',
      editionLabel: '2018-01',
      issuedOn: '2018-01-01',
      issuer: 'DIN',
    },
    {
      status: 'proposed',
      proposedBy: 'agent',
      confirmedBy: null,
      confirmedByName: null,
      fileName: 'DIN_4109-1_2018-01.pdf',
      folderId: FOLDER_IDS.sound,
      freshness: NEVER,
    }
  ),
  entry(
    'ma37',
    {
      kind: 'authority_directive',
      designation: null,
      title: 'Weisung Dachgeschoßausbau',
      editionLabel: '2021-03-15',
      territoryIds: ['AT-9'],
      issuer: 'MA 37',
      addressees: [{ name: 'MA 37', territoryId: 'AT-9' }],
      licenceClass: 'public_open',
    },
    {
      folderId: FOLDER_IDS.vienna,
      freshness: {
        intervalDays: 180,
        lastCheck: check('2025-12-01T09:00:00.000Z'),
        dueAt: '2026-05-30T09:00:00.000Z',
        overdue: true,
      },
    }
  ),
  entry(
    'kommentar-bo',
    {
      kind: 'commentary',
      designation: null,
      title: 'Bauordnung für Wien, Kommentar',
      editionLabel: '7. Auflage 2019',
      issuer: 'Manz',
      licenceClass: 'licensed',
    },
    { folderId: FOLDER_IDS.commentaries, freshness: NEVER }
  ),
  entry('oenorm-b-1600', {}),
  entry(
    'oenorm-b-5371',
    {
      designation: 'ÖNORM B 5371:2021',
      title: 'Treppen, Geländer und Brüstungen',
      editionLabel: '2021-01-15',
    },
    { textUse: 'metadata_only', aiProcessingAttestedAt: null, binding: binds('2021-01-15', true) }
  ),
  entry(
    'oenorm-b-3806-2023',
    { designation: 'ÖNORM B 3806:2023', title: 'Anforderungen an das Brandverhalten von Bauprodukten', editionLabel: '2023-03-01', issuedOn: '2023-03-01' },
    { workId: 'work_oenorm-b-3806', folderId: FOLDER_IDS.fire, binding: binds('2023-03-01', true) },
  ),
  entry(
    'oenorm-b-3806',
    {
      designation: 'ÖNORM B 3806:2005',
      title: 'Anforderungen an das Brandverhalten von Bauprodukten',
      editionLabel: '2005-04-01',
      issuedOn: '2005-04-01',
    },
    {
      folderId: FOLDER_IDS.fire,
      freshness: {
        intervalDays: 365,
        lastCheck: check('2026-09-12T09:00:00.000Z', 'newer_known'),
        dueAt: '2027-09-12T09:00:00.000Z',
        overdue: true,
      },
    }
  ),
  entry(
    'trvb-n-115',
    {
      kind: 'guideline',
      designation: 'TRVB N 115:2000',
      title: 'Brandschutzpläne',
      editionLabel: '2000',
      issuer: 'Österreichischer Bundesfeuerwehrverband',
      licenceClass: 'public_restricted',
    },
    { folderId: FOLDER_IDS.fire }
  ),
  entry(
    'oenorm-en-13501',
    {
      designation: 'ÖNORM EN 13501-1:2020',
      title: 'Klassifizierung von Bauprodukten und Bauarten zu ihrem Brandverhalten',
      editionLabel: '2020-01-15',
    },
    { folderId: FOLDER_IDS.fire, textUse: 'metadata_only', aiProcessingAttestedAt: null }
  ),
  entry(
    'oenorm-b-8115-2',
    {
      designation: 'ÖNORM B 8115-2:2021',
      title: 'Schallschutz und Raumakustik im Hochbau – Teil 2',
      editionLabel: '2021-11-15',
    },
    { folderId: FOLDER_IDS.sound, binding: binds('2025-03-01', false) }
  ),
  entry(
    'oib-leitfaden',
    {
      kind: 'guideline',
      designation: null,
      title: 'Leitfaden Abweichungen im Brandschutz',
      editionLabel: '2023-05',
      issuer: 'OIB',
      licenceClass: 'public_open',
    },
    { folderId: null, fileName: 'Leitfaden_Abweichungen_Brandschutz.pdf' }
  ),
]

export const BASE_KNOWLEDGE_ENTRIES: BaseKnowledgeEntry[] = ENTRIES.map((entry) => {
  const siblings = ENTRIES.filter((other) => other.workId === entry.workId).sort((a, b) =>
    (b.values.inForceFrom ?? b.values.issuedOn ?? '').localeCompare(a.values.inForceFrom ?? a.values.issuedOn ?? ''),
  )
  const current = siblings.find((other) => other.status === 'confirmed')
  return {
    ...entry,
    editions: siblings.map((other) => ({
      id: other.id,
      editionLabel: other.values.editionLabel,
      startsOn: other.values.inForceFrom ?? other.values.issuedOn,
      status: other.status,
      inForceToday: other === current,
    })),
  }
})

export const NORM_RECOGNITION: NormRecognition = {
  proposals: [
    {
      entryId: 'recognised-b8110',
      documentId: 'doc_recognised_b8110',
      fileName: 'OENORM_B_8110-3_2020-03-15_de.pdf',
      kind: 'technical_standard',
      designation: 'ÖNORM B 8110-3:2020',
      editionLabel: '2020-03-15',
      topicId: FOLDER_IDS.sound,
      editionOf: null,
      duplicate: false,
    },
    {
      entryId: 'recognised-en1991',
      documentId: 'doc_recognised_en1991',
      fileName: 'EN_1991-1-1.pdf',
      kind: 'technical_standard',
      designation: 'EN 1991-1-1',
      editionLabel: null,
      topicId: null,
      editionOf: null,
      duplicate: false,
    },
    {
      entryId: 'recognised-b1600',
      documentId: 'doc_recognised_b1600',
      fileName: 'OENORM_B_1600_2023-02-01_de.pdf',
      kind: 'technical_standard',
      designation: 'ÖNORM B 1600',
      editionLabel: '2023-02-01',
      topicId: FOLDER_IDS.access,
      editionOf: { entryId: 'edition_oenorm-b-1600', designation: 'ÖNORM B 1600', editionLabel: '2017-04-01' },
      duplicate: false,
    },
    {
      entryId: 'recognised-ma37',
      documentId: 'doc_recognised_ma37',
      fileName: 'MA37_Weisung_Dachgeschoss_2024-09.pdf',
      kind: 'authority_directive',
      designation: null,
      editionLabel: '2024-09',
      topicId: FOLDER_IDS.vienna,
      editionOf: null,
      duplicate: false,
    },
  ],
  plain: [
    { documentId: 'doc_plain_1', fileName: 'Haus_A_2024_Einreichung.pdf', folderId: null, folderPath: null, platformHeld: false },
    { documentId: 'doc_plain_2', fileName: 'Plankopf_Vorlage_A0.pdf', folderId: null, folderPath: null, platformHeld: false },
  ],
  topics: BASE_KNOWLEDGE_FOLDERS,
}
