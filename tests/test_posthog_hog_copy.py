import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUPPORT = ROOT / "deploy" / "posthog" / "support"
DESTINATION_DIRS = [SUPPORT, ROOT / "deploy" / "posthog" / "website"]
GERMAN_LETTERS = re.compile(r"[äöüÄÖÜß]")
COPY_KEY = re.compile(r"\bcopy\.([a-z_]+)")


def _code_lines(path: Path) -> list[tuple[int, str]]:
    return [
        (number, line)
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1)
        if not line.lstrip().startswith("//")
    ]


def _hog_files(directory: Path | None = None) -> list[Path]:
    files = sorted(f for d in ([directory] if directory else DESTINATION_DIRS) for f in d.glob("*.hog"))
    assert files, f"no .hog files under {directory or DESTINATION_DIRS}"
    return files


def test_no_destination_code_carries_german_words():
    offending = [
        f"{path.relative_to(ROOT)}:{number}: {line.strip()}"
        for path in _hog_files()
        for number, line in _code_lines(path)
        if GERMAN_LETTERS.search(line)
    ]
    assert not offending, "German belongs in copy.de.json, not in the code:\n" + "\n".join(offending)


def test_every_copy_key_the_code_reads_is_in_the_dictionary():
    for directory in DESTINATION_DIRS:
        dictionary = json.loads((directory / "copy.de.json").read_text(encoding="utf-8"))
        used = {
            key for path in _hog_files(directory) for _, line in _code_lines(path) for key in COPY_KEY.findall(line)
        }
        assert used, f"no destination under {directory} reads its copy input"
        missing = sorted(used - set(dictionary))
        assert not missing, f"keys missing from {directory / 'copy.de.json'}: {missing}"
