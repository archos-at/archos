export {
  CitationAccumulator,
  citationNumbers,
  citedLoci,
  citedPages,
  documentPages,
  readPages,
  compareDocuments,
  documentIdentity,
  hitCount,
  identityMatches,
  isCited,
  locusKey,
  locusOf,
  normalizeFileKey,
  normalizeFileName,
  refHost,
  refKey,
  refNumber,
  refPage,
  refPages,
  oibDocumentKey,
  resolveKind,
  resolveTint,
  resolveTitle,
  stripOriginToken,
  type CitationLocus,
  type CitationOrigin,
  type CitationRef,
  type CitedDocument,
  type DocumentIdentityInput,
} from './model'

export { hostnameOf, isHttpUrl, normalizeUrl } from './text'

export { parseKbLocator, locatorFromPseudoUrl, type KbCitationLocator } from './locator'

export {
  CITATION_PARAM,
  citationShareUrl,
  encodeCitationLink,
  parseCitationLink,
  resolveCitationLink,
  type CitationLink,
} from './deep-link'

export {
  CITATIONS_PAYLOAD_VERSION,
  decodeCitations,
  encodeCitations,
  type PersistedCitations,
} from './persistence'

export { buildCitationModel, citationSnippet, type CitationInputs } from './build'

export {
  citedFileName,
  openAtLocus,
  resolveCitationTarget,
  type CitationTarget,
  type StoredDocumentRef,
} from './target'

export {
  ANSWER_SOURCE_ANCHOR_PREFIX,
  anchoredNumbers,
  answerDocuments,
  answerSourceAnchorPrefix,
  bibliographyRows,
  documentShelfLabel,
  documentTabLabel,
  referencesByNumber,
  proseLength,
  splitAnswerBody,
  totalHits,
  unusedDocuments,
  type AnswerBodySplit,
  type BibliographyRow,
} from './views'
