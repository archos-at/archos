import argparse
import json
import os
from collections.abc import Sequence
from pathlib import Path
from typing import get_args

from pydantic import BaseModel

OUT_PATH = Path(__file__).resolve().parent.parent / "apps" / "workspace" / "bff" / "agent-host-contract.generated.ts"

DEPLOY_OVERRIDES = ("CHAT_TURN_DEADLINE_SECONDS",)

REQUESTS = "`apps/agent-host/src/agent_host/models/requests.py`"
MAIL_FACTS = "`apps/agent-host/src/agent_host/models/mail_facts.py`"
TURN_RECORD = "`apps/agent-host/src/agent_host/turn_record.py`"


def _forbids_extra(annotation: object) -> bool:
    return (
        isinstance(annotation, type)
        and issubclass(annotation, BaseModel)
        and annotation.model_config.get("extra") == "forbid"
    )


def _strict_records(model: type[BaseModel]) -> dict[str, list[str]]:
    return {
        name: list(member.model_fields)
        for name, field in model.model_fields.items()
        for member in (field.annotation, *get_args(field.annotation))
        if _forbids_extra(member)
    }


def _request_contract() -> tuple[tuple[str, object, str], ...]:
    from agent_host.chat_turn import TURN_DEADLINE_SECONDS
    from agent_host.models.mail_facts import MailLocale
    from agent_host.models.mail_facts import SenderTrust
    from agent_host.models.requests import IngestRequest
    from agent_host.routes.documents_jobs import BATCH_STATUS_MAX_IDS

    return (
        (
            "CHAT_TURN_DEADLINE_SECONDS",
            TURN_DEADLINE_SECONDS,
            "The seconds a chat turn runs before the socket ends it, where the deploy sets no "
            "`CHAT_TURN_DEADLINE_SECONDS`: `TURN_DEADLINE_SECONDS` in `apps/agent-host/src/agent_host/chat_turn.py`.",
        ),
        (
            "BATCH_STATUS_MAX_IDS",
            BATCH_STATUS_MAX_IDS,
            "The most job ids one batch status read accepts: `BATCH_STATUS_MAX_IDS` in "
            "`apps/agent-host/src/agent_host/routes/documents_jobs.py`.",
        ),
        (
            "INGEST_REQUEST_FIELDS",
            list(IngestRequest.model_fields),
            f"The keys `POST /v1/ingest` reads: the fields of `IngestRequest` in {REQUESTS}.",
        ),
        (
            "INGEST_PRIORITIES",
            list(get_args(IngestRequest.model_fields["priority"].annotation)),
            f"The priorities `POST /v1/ingest` accepts: `IngestRequest.priority` in {REQUESTS}.",
        ),
        (
            "INGEST_STRICT_RECORDS",
            _strict_records(IngestRequest),
            "The records of an ingest request that refuse a key they do not declare, by the key they are sent "
            f'under, with the keys they declare: the `extra="forbid"` models of `IngestRequest` in {REQUESTS}.',
        ),
        (
            "SENDER_TRUSTS",
            list(get_args(SenderTrust)),
            f"The sender trusts a mail origin may carry: `SenderTrust` in {MAIL_FACTS}.",
        ),
        (
            "MAIL_LOCALES",
            list(get_args(MailLocale)),
            f"The locales a mail record may carry: `MailLocale` in {MAIL_FACTS}.",
        ),
    )


def _turn_contract() -> tuple[tuple[str, object, str], ...]:
    from agent_host.turn_record import MAX_STEP_FRAMES
    from agent_host.turn_record import MAX_STEP_ROWS
    from agent_host.turn_record import STEP_CUSTOM_NAMES
    from agent_host.turn_record import STEP_FRAME_TYPES

    return (
        (
            "STEP_FRAME_TYPES",
            sorted(STEP_FRAME_TYPES),
            f"The frame types the agent host hands over as a turn's steps: `STEP_FRAME_TYPES` in {TURN_RECORD}.",
        ),
        (
            "STEP_CUSTOM_NAMES",
            sorted(STEP_CUSTOM_NAMES),
            f"The `CUSTOM` frame names it hands over as steps too: `STEP_CUSTOM_NAMES` in {TURN_RECORD}.",
        ),
        (
            "MAX_STEP_ROWS",
            MAX_STEP_ROWS,
            f"The most step rows the agent host keeps of one turn: `MAX_STEP_ROWS` in {TURN_RECORD}.",
        ),
        (
            "MAX_STEP_FRAMES",
            MAX_STEP_FRAMES,
            f"The most step frames it hands over for one turn: `MAX_STEP_FRAMES` in {TURN_RECORD}.",
        ),
    )


def contract() -> tuple[tuple[str, object, str], ...]:
    return _request_contract() + _turn_contract()


def render(entries: tuple[tuple[str, object, str], ...]) -> str:
    blocks = [
        "// AUTO-GENERATED from the Python sources named below — do not edit; "
        "run `uv run python scripts/generate_agent_host_contract.py`"
    ]
    for name, value, doc in entries:
        blocks.append(f"/** {doc} */\nexport const {name} = {json.dumps(value, ensure_ascii=False)} as const")
    return "\n\n".join(blocks) + "\n"


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=f"Regenerate {OUT_PATH.relative_to(OUT_PATH.parents[4])} from the agent host's Python sources."
    )
    parser.parse_args(argv)
    for name in DEPLOY_OVERRIDES:
        os.environ.pop(name, None)
    OUT_PATH.write_text(render(contract()), encoding="utf-8", newline="\n")
    print(f"Wrote the agent host contract to {OUT_PATH}")


if __name__ == "__main__":
    main()
