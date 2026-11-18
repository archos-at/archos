export const EXPORT_GLOSSARY: Record<string, string> = {
  scope:
    'The filter the export was taken in: UTC days from..to inclusive (windowStart <= occurredAt < windowEnd), and, when non-empty, only those organizationIds and projectIds. A project filter keeps only turns whose conversation belongs to one of those projects; turns with no recorded conversation are left out of it.',
  citations_removed:
    'Citation verification removed one or more citations the model wrote. problems[].reasons counts the removed citations by reason (see reason.*); problems[].failedSources lists each cited target and its reason.',
  quote_unverified:
    'A passage the answer put in quotation marks could not be found (fuzzy match) in any retrieved passage. citedSources lists the documents the answer cited; the quoted wording itself is deliberately not recorded.',
  answer_ungrounded:
    'Sources were retrieved but no citation survived verification, so the answer shipped with a visible "without source citation" gap. retrievedSources shows what the model had available; failedSources shows what it cited instead.',
  registry_empty:
    'The turn captured no source at all: retrieval returned nothing. problems[].unavailableTools names the tools reported unavailable.',
  citation_fallback:
    'Nothing the model cited survived verification, but exactly one retrieved source existed and was attached automatically. Usually a citation-format mismatch rather than a wrong answer.',
  confidence_capped:
    "The deterministic overconfidence guard lowered the answer's self-reported confidence. problems[].reasons holds exactly one confidence reason (see confidence.*).",
  precision:
    'Not a defect. turns[].precision is the retrieval_precision observation: retrievedCount unique sources retrieval returned, citedCount of them the answer cited, uncitedCount it ignored, and uncitedSources naming those (at most 10). null when the turn recorded none.',
  'reason.url_not_in_registry':
    'Removal: the cited URL was not among the sources retrieved on that turn. Means "not retrieved", not "unknown to the platform".',
  'reason.citation_key_not_in_registry':
    'Removal: the cited document key (file name, page) was not among the sources retrieved on that turn.',
  'reason.unverifiable':
    'Removal: the source line named no URL or document key the verifier could check.',
  'reason.digest_line_not_citable':
    "Removal: the line cited the conversation's read index (a digest line), not a retrieved passage.",
  'reason.duplicate': 'Removal: the citation repeated one already present in the same answer.',
  'confidence.ungrounded': 'Capped to low: no verified citation, and nothing was measured.',
  'confidence.quote_unverified': 'Capped to low: a quoted span matched no retrieved passage.',
  'confidence.law_unsettled':
    "Confidence capped to medium: the answer cites building law the turn's knowledge records do not settle (no curated coverage at the site).",
  'confidence.open_point': 'Capped by the answer: an open point it names (medium) or its own lower level.',
  'confidence.normative_claim_uncited':
    'Confidence capped: the answer was grounded in a measurement but also made a legal claim without a verified citation.',
  'confidence.measurement_only':
    'Confidence reduced from high to medium: grounded in a measurement only and purely descriptive.',
  'confidence.citation_fallback':
    'Confidence capped: the only grounding is the single source attached automatically by the citation fallback.',
}
