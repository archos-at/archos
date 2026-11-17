from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from release_notes_rules import PRODUCT_NAME
from release_notes_rules import SITE_DOMAIN

TRANSLATION_MODEL = os.environ.get("RELEASE_NOTES_TRANSLATION_MODEL", "openai/gpt-6-luna")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

TRANSLATION_SYSTEM_PROMPT = (
    f"You translate product release notes for {PRODUCT_NAME}, the workspace for Austrian "
    "architecture and planning offices, from English into German.\n"
    "Rules:\n"
    "- Austrian business German, formal address (Sie), present tense.\n"
    "- Translate meaning, not words. Keep it as short as the English.\n"
    f"- Keep product names ({PRODUCT_NAME}, and any former name a note uses), standards and legal "
    "terms (OIB-Richtlinien, Landesbauordnung) exactly as they are.\n"
    "- Keep the English loanwords Austrian professionals actually use — Changelog, "
    "Login, Update, Upload, Dashboard — instead of inventing a German equivalent.\n"
    "- Add nothing, explain nothing, drop nothing.\n"
    "- Answer with the German sentence only — no quotes, no preamble."
)


def text_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def load_translations(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    entries = json.loads(path.read_text(encoding="utf-8"))
    return {text_key(entry["en"]): entry for entry in entries if entry.get("en")}


def save_translations(path: Path, translations: dict[str, dict[str, str]]) -> None:
    entries = sorted(
        ({"en": entry["en"], "de": entry["de"]} for entry in translations.values()),
        key=lambda entry: entry["en"],
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def translate(text: str, api_key: str, model: str = TRANSLATION_MODEL, attempts: int = 3) -> str:
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": TRANSLATION_SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
    }
    request = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": f"https://{SITE_DOMAIN}",
            "X-Title": f"{PRODUCT_NAME} release notes",
        },
        method="POST",
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
            with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - constant https URL
                raw = response.read().decode("utf-8")
            german = json.loads(raw)["choices"][0]["message"]["content"].strip()
            if not german:
                raise ValueError("empty translation")
            return german
        except (urllib.error.URLError, KeyError, IndexError, ValueError, TimeoutError) as exc:
            last_error = exc
            if attempt < attempts - 1:
                time.sleep(2**attempt)
    raise RuntimeError(f"translation failed after {attempts} attempts: {last_error}")


def resolve_translations(
    strings: list[str],
    translations: dict[str, dict[str, str]],
    *,
    enabled: bool,
    require: bool,
) -> tuple[dict[str, str], list[str]]:
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    mapping: dict[str, str] = {}
    untranslated: list[str] = []
    for text in strings:
        key = text_key(text)
        cached = translations.get(key)
        if cached and cached.get("de"):
            mapping[text] = cached["de"]
            continue
        if not (enabled and api_key):
            mapping[text] = text
            untranslated.append(text)
            continue
        german = translate(text, api_key)
        translations[key] = {"en": text, "de": german}
        mapping[text] = german
    if untranslated and require:
        raise SystemExit(
            f"{len(untranslated)} note(s) have no German translation and "
            "--require-translations was given. Is OPENROUTER_API_KEY set?"
        )
    return mapping, untranslated


def prune_translations(translations: dict[str, dict[str, str]], strings: list[str]) -> dict[str, dict[str, str]]:
    live = {text_key(text) for text in strings}
    return {key: value for key, value in translations.items() if key in live}
