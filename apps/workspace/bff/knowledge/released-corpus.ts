/**
 * The base corpus as one office reads it (ADR-0173, ADR-0175): its listing and
 * its source PDFs, limited to the files released in a country the office is
 * entitled to.
 *
 * There is one rule and this module adds none. The countries are the office's
 * entitlement (`corpusCountriesFor`, the list signed onto every collection
 * scope); a file's country is the mark its release wrote, which its chunks
 * carry too. So the viewer opens a file exactly when a search of the same
 * office can find it (`vector_store.scope.corpus_country_condition`). A text
 * attached to a draft change request carries no mark, and a rolled-back one
 * the mark nobody is entitled to: neither is listed or served, and the PDF
 * route answers them as it answers a name that does not exist.
 *
 * A session with no organization reads nothing. Platform operators read the
 * whole corpus through their own routes (`/api/platform/knowledge/documents`),
 * never through these.
 */

import 'server-only'
import { corpusCountriesFor } from '@/lib/base-knowledge/context/corpus-countries'
import { getReleasedKnowledgeBaseStatus, type KnowledgeBaseStatus } from './service'
import { streamReleasedKnowledgeBaseDocument } from './source-pdf'

/** The session fields the office's corpus reads decide by. */
interface CorpusReader {
  organizationId: string | null
}

async function countriesOf(reader: CorpusReader): Promise<string[]> {
  return reader.organizationId ? corpusCountriesFor(reader.organizationId) : []
}

/** What the office's knowledge page and source preview list: the released files of its countries. */
export async function getKnowledgeBaseStatusFor(reader: CorpusReader): Promise<KnowledgeBaseStatus> {
  return getReleasedKnowledgeBaseStatus(await countriesOf(reader))
}

/** The source PDF of a file released to the office; a 404 for every other name, existing or not. */
export async function streamKnowledgeBaseDocumentFor(reader: CorpusReader, fileName: string): Promise<Response> {
  return streamReleasedKnowledgeBaseDocument(fileName, await countriesOf(reader))
}
