import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

import jinja2

from agent.common.brand import PRODUCT_NAME

logger = logging.getLogger(__name__)


@lru_cache(maxsize=256)
def _compile_template(template: str) -> jinja2.Template:
    return jinja2.Template(template, undefined=jinja2.StrictUndefined)


class PromptError(Exception):

    pass


def load_prompt(path: Path, name: str) -> str:
    prompt_path = path / name
    if not prompt_path.exists() and not name.endswith(".j2"):
        prompt_path = path / f"{name}.j2"

    if not prompt_path.exists():
        raise PromptError(f"Prompt file not found: {name} in {path}")

    try:
        return prompt_path.read_text(encoding="utf-8")
    except Exception as e:
        raise PromptError(f"Failed to load prompt {name}: {e}") from e


def render_prompt_template(template: str, **kwargs: Any) -> str:
    if "document_inventory" not in kwargs:
        from agent.knowledge.inventory import get_listing_shelf
        from agent.knowledge.inventory import in_scope_shelves_from_context
        from agent.knowledge.inventory import render_inventory_block

        docs = kwargs.get("available_documents") or []
        scoped = in_scope_shelves_from_context()
        kwargs["document_inventory"] = render_inventory_block(
            docs,
            in_scope_shelves=scoped or None,
            focus_shelf=get_listing_shelf(),
            in_flight=kwargs.get("in_flight_documents"),
        )
    if "answer_envelope_schema" not in kwargs:
        from agent.common.answer_envelope import render_envelope_schema

        kwargs["answer_envelope_schema"] = render_envelope_schema()
    kwargs.setdefault("product_name", PRODUCT_NAME)
    try:
        return _compile_template(template).render(**kwargs)
    except jinja2.TemplateError as e:
        raise PromptError(f"Failed to render template: {e}") from e
