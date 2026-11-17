import importlib.util
import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = REPO_ROOT / "skills"
VALIDATOR = REPO_ROOT / "scripts" / "validate_skills.py"


def _load_validator():
    spec = importlib.util.spec_from_file_location("validate_skills", VALIDATOR)
    if spec is None:
        raise RuntimeError(f"failed to create import spec for {VALIDATOR}")
    if spec.loader is None:
        raise RuntimeError(f"import spec loader missing for {VALIDATOR}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_agent_skills_are_valid():
    validator = _load_validator()
    report = validator.validate_roots([SKILLS_ROOT])
    assert report.errors == [], "skill validation errors:\n" + "\n".join(report.errors)


def _make_bundle(root: Path, name: str, *, body: str = "", newline: str = "\n") -> Path:
    bundle = root / name
    bundle.mkdir(parents=True)
    skill_md = (
        f"---{newline}"
        f"name: {name}{newline}"
        f"description: Temporary skill bundle for validator tests.{newline}"
        f"---{newline}{newline}"
        f"{body}{newline}"
    )
    (bundle / "SKILL.md").write_text(skill_md, encoding="utf-8", newline="")
    return bundle


def test_validator_flags_bundle_link_escape(tmp_path):
    validator = _load_validator()
    root = tmp_path / "skills"
    _make_bundle(root, "escape-skill", body="See [oops](references/../../secret.md).")
    report = validator.validate_roots([root])
    assert any("escapes the" in e for e in report.errors), report.errors


def test_validator_flags_unreadable_skill_md(tmp_path):
    validator = _load_validator()
    root = tmp_path / "skills"
    skill_md = _make_bundle(root, "unreadable-skill") / "SKILL.md"
    skill_md.chmod(0o000)
    if os.access(skill_md, os.R_OK):  # e.g. running as root, where chmod can't block reads
        skill_md.chmod(0o644)
        pytest.skip("cannot make file unreadable as the current user")
    try:
        report = validator.validate_roots([root])
    finally:
        skill_md.chmod(0o644)
    assert any("Unable to read SKILL.md" in e for e in report.errors), report.errors


def test_validator_accepts_crlf_frontmatter(tmp_path):
    validator = _load_validator()
    root = tmp_path / "skills"
    _make_bundle(root, "crlf-skill", body="# body", newline="\r\n")
    report = validator.validate_roots([root])
    assert report.errors == [], report.errors
