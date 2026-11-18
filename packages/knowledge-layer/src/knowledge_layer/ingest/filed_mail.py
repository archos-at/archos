from __future__ import annotations


def source_format_from_config(config: dict) -> str | None:
    from agent.common.source_kinds import MAIL_SOURCE_FORMAT

    return MAIL_SOURCE_FORMAT if config.get("source_format") == MAIL_SOURCE_FORMAT else None


def store_mail_facts(collection_name: str, file_name: str, config: dict, *, replaced: bool) -> None:
    from agent.knowledge import set_document_mail_origin
    from agent.knowledge import set_document_mail_thread

    thread, origin = config.get("mail_thread"), config.get("mail_origin")
    if thread or replaced:
        set_document_mail_thread(collection_name, file_name, thread if isinstance(thread, dict) else None)
    if origin or replaced:
        set_document_mail_origin(collection_name, file_name, origin if isinstance(origin, dict) else None)
