from __future__ import annotations

from pydantic import BaseModel
from pydantic import Field

from . import client

MAX_QUOTE_CHARS = 300


class NeedsInput(BaseModel):
    start: int = Field(
        default=0, ge=0, description="Skip this many needs: the answer names the next start when bounded."
    )


class RecordedValue(BaseModel):
    key: str = Field(
        description=(
            "The profile key exactly as intake_needs lists it, with its @bldgN (Bauwerk) or @bldgN@use (Nutzungszone) "
            "suffix. A key not listed yet is taken when a wizard question writes it (dwelling_units@bldg1@residential "
            "before the Nutzungen are recorded)."
        )
    )
    value: bool | int | float | str | list[str] = Field(
        description=(
            "The value the document states for THIS project. Select: the option token exactly (multi_select: a "
            "list of tokens). Number: a number in the question's unit, no unit text. Boolean: true or false. "
            "Text: the words as written."
        )
    )
    citation: str | None = Field(
        default=None,
        description=(
            "Where the quote stands, as the reading tool printed it: `Baubeschreibung.pdf, p.3` from a search hit, "
            "or `Baubeschreibung.pdf, S. 3`. Give this or file_name."
        ),
    )
    file_name: str | None = Field(
        default=None, description="The file the quote stands in, exactly as the reading tool named it."
    )
    page: int | None = Field(default=None, description="The page from the [Seite N] marker or the hit; null if none.")
    quote: str = Field(
        description=(
            f"The document's own words that state the value, copied verbatim from text a tool showed you in this "
            f"run, at most {MAX_QUOTE_CHARS} characters. Never paraphrased, never assembled from two places."
        )
    )


class RecordValuesInput(BaseModel):
    values: list[RecordedValue] = Field(
        description=f"1 to {client.MAX_RECORD_VALUES} values, each with its evidence. Several keys in one call."
    )


class WithdrawInput(BaseModel):
    keys: list[str] = Field(
        description=f"1 to {client.MAX_RECORD_VALUES} keys, each one you recorded in this run, exactly as recorded."
    )


class FinishInput(BaseModel):
    summary: str = Field(
        description=(
            "Two to four German sentences for the person who checks the reading: what you read, what you found, "
            f"what stays open and which document would answer it. At most {client.MAX_SUMMARY_CHARS} characters."
        )
    )
