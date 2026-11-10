#!/usr/bin/env python3

"""Render the processor page's tables and the DPA annex from the data-flow register.

The register (``configs/subprocessors/*.yaml``, checked by
``scripts/check_data_flow_register.py``) is the one source. This writes:

- ``apps/workspace/bff/legal/content/subprocessors.generated.ts``: the tables
  and lists of the public page ``/legal/subprocessors`` in German and English,
  which ``de.ts`` and ``en.ts`` place between their hand-written paragraphs;
- ``docs/compliance/dpa-subprocessor-annex.md``: the annex of the DPA (AVV),
  with what the page leaves out: the contract, the data classes and purposes
  in the W3C Data Privacy Vocabulary (DPV), and deletion at contract end.

Run with::

    .venv/bin/python scripts/generate_subprocessor_pages.py

The ``data-flow-register`` pre-commit hook runs it, and
``tests/test_data_flow_register.py`` fails a committed file that differs.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from check_data_flow_register import OPEN_DELETION  # noqa: E402
from check_data_flow_register import REPO_ROOT  # noqa: E402
from check_data_flow_register import Register  # noqa: E402
from check_data_flow_register import load  # noqa: E402
from check_data_flow_register import register_errors  # noqa: E402

TS_PATH = REPO_ROOT / "apps" / "workspace" / "bff" / "legal" / "content" / "subprocessors.generated.ts"
ANNEX_PATH = REPO_ROOT / "docs" / "compliance" / "dpa-subprocessor-annex.md"
LANGS = ("de", "en")

#: The page's column heads, per language.
PROCESSOR_HEADERS = {
    "de": ["Dienst", "Zweck", "Verarbeitete Daten", "Standort", "Übermittlungsgrundlage", "Erforderlich?"],
    "en": ["Service", "Purpose", "Data processed", "Location", "Transfer safeguard", "Required?"],
}
SELF_HOSTED_HEADERS = {"de": ["Komponente", "Zweck", "Gespeicherte Daten"], "en": ["Component", "Purpose", "Data held"]}

#: What each transfer value means, in the words of the privacy policy's section 5.
TRANSFER_TEXT = {
    "eea": {"de": "Keine Drittlandübermittlung (EU/EWR)", "en": "No third-country transfer (EU/EEA)"},
    "eu_storage_us_access": {
        "de": "Speicherung in der EU; Zugriff aus den USA auf Grundlage des EU-US Data Privacy Framework und von "
        "Standardvertragsklauseln",
        "en": "Stored in the EU; access from the USA under the EU-US Data Privacy Framework and standard "
        "contractual clauses",
    },
    "third_country": {
        "de": "Standardvertragsklauseln (Art. 46 DSGVO); EU-US Data Privacy Framework, soweit der Anbieter "
        "zertifiziert ist",
        "en": "Standard contractual clauses (Art. 46 GDPR); EU-US Data Privacy Framework where the provider is "
        "certified",
    },
}
#: DPV (https://w3id.org/dpv) terms for the annex: the standard vocabulary, not ours.
DPV_PURPOSE = {
    "service_provision": "dpv:ServiceProvision",
    "quality_evaluation": "dpv:ImproveExistingProductsAndServices",
    "product_improvement": "dpv:ImproveExistingProductsAndServices",
    "customer_support": "dpv:CustomerCare",
    "security": "dpv:EnforceSecurity",
    "operations": "dpv:ServiceOptimisation",
}
DPV_TRANSFER = {
    "eea": "—",
    "eu_storage_us_access": "eu-gdpr:A45-3, eu-gdpr:A46-2-c",
    "third_country": "eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified)",
}
CONTRACT_TEXT = {"dpa": "DPA signed", "terms": "vendor's terms", "none": "**no contract**", "unknown": "to confirm"}
LISTED = ("active", "conditional")


def _copy(row: dict, name: str, lang: str) -> str:
    return row["copy"][name][lang]


def page_tables(register: Register, lang: str) -> dict:
    """Every generated part of the page in one language."""
    listed = [row for row in register.rows if row["status"] in LISTED]
    latent = [row for row in register.rows if row["status"] == "latent"]
    return {
        "processors": {
            "headers": PROCESSOR_HEADERS[lang],
            "rows": [
                [
                    _copy(row, "name", lang),
                    _copy(row, "purpose", lang),
                    _copy(row, "data", lang),
                    _copy(row, "location", lang),
                    (row["copy"].get("transfer") or TRANSFER_TEXT[row["transfer"]])[lang],
                    _copy(row, "required", lang),
                ]
                for row in listed
            ],
        },
        "selfHosted": {
            "headers": SELF_HOSTED_HEADERS[lang],
            "rows": [
                [c["name"], c["purpose"][lang], c["data"][lang]] for c in register.in_cluster.get("components", [])
            ],
        },
        "latent": [
            f"{_copy(row, 'name', lang)} ({_copy(row, 'location', lang)}) — {_copy(row, 'data', lang)}."
            for row in latent
        ],
        "publicSources": [source["copy"][lang] for source in register.public_sources],
        "build": [service["copy"][lang] for service in register.build],
    }


def render_ts(register: Register) -> str:
    """The TypeScript module: data only, `{productName}` filled in by its readers."""
    data = {lang: page_tables(register, lang) for lang in LANGS}
    body = json.dumps(data, ensure_ascii=False, indent=2)
    return (
        "// AUTO-GENERATED from configs/subprocessors/*.yaml — do not edit; run\n"
        "// `.venv/bin/python scripts/generate_subprocessor_pages.py`. Strings may hold\n"
        "// `{productName}`: read them through `withProductName`.\n"
        "import type { LegalTable } from '../types'\n\n"
        "/** The generated parts of the processor page in one language. */\n"
        "export interface SubprocessorPageParts {\n"
        "  processors: LegalTable\n  selfHosted: LegalTable\n  latent: string[]\n"
        "  publicSources: string[]\n  build: string[]\n}\n\n"
        f"export const SUBPROCESSOR_PAGE: Record<'de' | 'en', SubprocessorPageParts> = {body}\n"
    )


def _cell(text: str) -> str:
    return " ".join(str(text).replace("|", "\\|").split()).replace("{productName}", "the product")


def _transfer_basis(row: dict) -> str:
    """The DPV transfer basis, but only where a contract exists to carry it: SCCs are a contract."""
    if row["transfer"] == "eea" or row["contract"] in {"dpa", "terms"}:
        return DPV_TRANSFER[row["transfer"]]
    return "**basis to confirm** (no contract on record)"


def _annex_rows(register: Register) -> list[str]:
    head = (
        "| Recipient | Status | Entity | Processed in | Data classes | Purposes (DPV) | Transfer (DPV) | Contract "
        "| Deletion at contract end |\n|---|---|---|---|---|---|---|---|---|"
    )
    lines = [head]
    for row in register.rows:
        purposes = ", ".join(sorted({DPV_PURPOSE[p] for p in row["purposes"]}))
        lines.append(
            f"| {_cell(row['name'])} | {row['status']} | {row['entity_country']} "
            f"| {', '.join(row.get('processing_countries') or [])} | {', '.join(row['data_classes'])} | {purposes} "
            f"| {_transfer_basis(row)} | {CONTRACT_TEXT[row['contract']]} "
            f"| **{row['deletion']['status']}**: {_cell(row['deletion']['en'])} |"
        )
    return lines


def _gaps(register: Register) -> list[str]:
    open_rows = [row for row in register.rows if row["deletion"]["status"] in OPEN_DELETION]
    lines = [
        f"- **{_cell(row['name'])}** ({row['deletion']['status']}): {_cell(row['deletion']['en'])}" for row in open_rows
    ]
    lines += [
        f"- **{_cell(c['name'])}** (in the cluster): {_cell(c['deletion']['en'])}"
        for c in register.in_cluster.get("components", [])
        if c.get("holds_tenant_text")
    ]
    return lines


def _flow_rows(register: Register) -> list[str]:
    lines = ["| Recipient | Flow | Data classes | Purposes (DPV) | Processed in |", "|---|---|---|---|---|"]
    for row in register.rows:
        for flow in row.get("flows") or []:
            purposes = ", ".join(sorted({DPV_PURPOSE[p] for p in flow["purposes"]}))
            lines.append(
                f"| {_cell(row['name'])} | {_cell(flow['what']['en'])} | {', '.join(flow['data_classes'])} "
                f"| {purposes} | {', '.join(flow['processing_location'])} |"
            )
    return lines


def render_annex(register: Register) -> str:
    """The DPA annex in Markdown."""
    unconfirmed = [_cell(row["name"]) for row in register.rows if row["status"] in LISTED and row["contract"] != "dpa"]
    parts = [
        "<!-- AUTO-GENERATED from configs/subprocessors/*.yaml by scripts/generate_subprocessor_pages.py. "
        "Do not edit; change the register. -->",
        "# DPA annex: subprocessors and recipients",
        "The processor list of the data processing agreement (AVV, Art. 28 GDPR), generated from the data-flow "
        "register ([how it works](data-flow-register.md)). The public page `/legal/subprocessors` is generated "
        "from the same rows. **Engineering inventory, not legal advice: counsel reviews it before it is signed.**",
        "Statuses: `active` is in use; `conditional` only when an organization or the operator configures it; "
        "`latent` is reachable in code but refused at boot in a deployment people sign in to.",
        "## Recipients",
        "\n".join(_annex_rows(register)),
        "## Flows per recipient",
        "Where one recipient serves several purposes, each flow with the place it is processed (`per_model`: "
        "the upstream follows the model an office chose).",
        "\n".join(_flow_rows(register)),
        "## Contracts still to confirm",
        "Listed recipients whose contract the register does not record as a signed DPA: "
        + (", ".join(unconfirmed) or "none")
        + ".",
        "## Deletion at contract end: where it does not reach yet",
        "No run deletes an organization as a whole today; deletion is per project, conversation and folder. "
        "Every store below holds an office's text after its contract ends: until the bound it names, or without one.",
        "\n".join(_gaps(register)),
        "## Public sources (not processors)",
        "\n".join(f"- {_cell(source['copy']['en'])}" for source in register.public_sources),
    ]
    return "\n\n".join(parts) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    """Validate the register, then write both files."""
    argparse.ArgumentParser(description="Render the processor page and the DPA annex from the register.").parse_args(
        argv
    )
    register = load()
    errors = register_errors(register)
    for error in errors:
        print(f"data-flow register: {error}", file=sys.stderr)
    if errors:
        return 1
    TS_PATH.write_text(render_ts(register), encoding="utf-8", newline="\n")
    ANNEX_PATH.write_text(render_annex(register), encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
