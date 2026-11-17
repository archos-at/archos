import 'server-only'
import { corpusCountriesFor } from '@/lib/base-knowledge/context/corpus-countries'
import { getReleasedKnowledgeBaseStatus, type KnowledgeBaseStatus } from './service'
import { streamReleasedKnowledgeBaseDocument } from './source-pdf'

interface CorpusReader {
  organizationId: string | null
}

async function countriesOf(reader: CorpusReader): Promise<string[]> {
  return reader.organizationId ? corpusCountriesFor(reader.organizationId) : []
}

export async function getKnowledgeBaseStatusFor(reader: CorpusReader): Promise<KnowledgeBaseStatus> {
  return getReleasedKnowledgeBaseStatus(await countriesOf(reader))
}

export async function streamKnowledgeBaseDocumentFor(reader: CorpusReader, fileName: string): Promise<Response> {
  return streamReleasedKnowledgeBaseDocument(fileName, await countriesOf(reader))
}
