"""Release notes: the German side, translated once per English sentence and cached.

The notes are written in English; the German a reader of the app and of the
public changelog sees is generated from it here and kept in
``releasenotes/translations/de.json``, one ``{"en": …, "de": …}`` pair per
sentence, so an unchanged sentence is never paid for twice. Both artifacts
(``release_notes_build``) draw on the same cache. Split out of
``release_notes.py``, which is the command line around it.
"""

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
    "You translate product release notes for Piloti, an AI platform for Austrian "
    "architecture and planning offices, from English into German.\n"
    "Rules:\n"
    "- Austrian business German, formal address (Sie), present tense.\n"
    "- Translate meaning, not words. Keep it as short as the English.\n"
    "- Keep product names (Piloti), standards and legal terms (OIB-Richtlinien, "
    "Landesbauordnung) exactly as they are.\n"
    "- Keep the English loanwords Austrian professionals actually use — Changelog, "
    "Login, Update, Upload, Dashboard — instead of inventing a German equivalent.\n"
    "- Add nothing, explain nothing, drop nothing.\n"
    "- Answer with the German sentence only — no quotes, no preamble."
)


def text_key(text: str) -> str:
    """In-memory cache key for one English string: content-addressed and cheap.

    Never written to disk. The file stores `{"en": …, "de": …}` pairs and this is
    recomputed on load — a 16-hex-character digest sitting in a JSON file reads
    as a credential to every secret scanner that looks at it, and there is no way
    to mark a false positive inline in JSON. Deriving it removes the question
    instead of answering it, and the file is more readable for the human who has
    to correct a translation.
    """
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def load_translations(path: Path) -> dict[str, dict[str, str]]:
    """The on-disk pairs, keyed for lookup by the English text they translate."""
    if not path.exists():
        return {}
    entries = json.loads(path.read_text(encoding="utf-8"))
    return {text_key(entry["en"]): entry for entry in entries if entry.get("en")}


def save_translations(path: Path, translations: dict[str, dict[str, str]]) -> None:
    """Write the pairs back, sorted by the English text so diffs stay stable."""
    entries = sorted(
        ({"en": entry["en"], "de": entry["de"]} for entry in translations.values()),
        key=lambda entry: entry["en"],
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")



def translate(text: str, api_key: str, model: str = TRANSLATION_MODEL, attempts: int = 3) -> str:
    """One English string to German via OpenRouter, or raise after `attempts`.

    stdlib only, on purpose: this runs in a throwaway CI environment that has
    reno and nothing else, and the call is a single JSON POST. urllib also reads
    HTTPS_PROXY, which `http.client` does not — the tooling has to work from a
    dev container and a corporate laptop as well as from a runner.
    """
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
            # OpenRouter attributes traffic by these; they are not credentials.
            "HTTP-Referer": "https://piloti.at",
            "X-Title": "Piloti release notes",
        },
        method="POST",
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            # The scanners ask the same question about urllib — it will open
            # `file://` if handed a URL that something else chose. Nothing does:
            # OPENROUTER_URL is a module constant, and the only value that varies
            # is the note text, which travels in the body. Swapping this for
            # `http.client.HTTPSConnection` answers it in the type system but
            # trades the finding for `httpsconnection-detected` (unconditional,
            # even with an explicit verified SSL context) and loses proxy support.
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
    """Map every English string to German, filling the cache with what is missing.

    Returns the mapping plus the strings that stayed English. A missing
    translation is a warning rather than a failure by default: the changelog
    showing an English sentence to a German reader is worse than nothing only if
    it is permanent, and the next run with a key in the environment fixes it.
    `require` turns it into a failure for the publish workflow, which does have
    the key and should not silently ship English.
    """
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
    """Drop cache entries no note refers to any more, so the file stays readable."""
    live = {text_key(text) for text in strings}
    return {key: value for key, value in translations.items() if key in live}

