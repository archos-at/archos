from typing import Annotated

from pydantic import AfterValidator
from pydantic import Field


def _known_document_type(value: str) -> str:
    from agent.knowledge.document_classification import DOCUMENT_TYPE_TAGS

    if value not in DOCUMENT_TYPE_TAGS:
        raise ValueError(f"document_type must be one of {', '.join(DOCUMENT_TYPE_TAGS)}")
    return value


DocumentTypeTag = Annotated[str, AfterValidator(_known_document_type)]

DOCUMENT_TYPE_DESCRIPTION = (
    "The document type a person chose for this file when it was filed: one of the controlled "
    "document-type tags (`DOCUMENT_TYPE_TAGS`). The ingest job stores it as the person's type "
    "tag, beside the discipline tags the classifier reads, so neither this read nor a later one "
    "replaces it; a person's later edit of the tags still does. Anything outside the vocabulary "
    "is a 422. Omit to let the classifier decide, as for every upload before this field existed."
)

DocumentTypeField = Annotated[DocumentTypeTag | None, Field(description=DOCUMENT_TYPE_DESCRIPTION)]
