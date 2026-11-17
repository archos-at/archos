"""The names, limits and extension sets the estate tools share: the tool names the agent sees, the read caps, and
which files are images or models.
"""

from __future__ import annotations

import re

READ_FILE_TOOL = "read_file"

LS_TOOL = "ls"

GLOB_TOOL = "glob"

GREP_TOOL = "grep"

MAX_READ_CHARS = 24_000

MAX_READ_PAGES = 30

DEFAULT_LINE_LIMIT = 100

MAX_SUGGESTIONS = 3

SUGGESTION_CUTOFF = 0.6

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif")

MODEL_EXTENSIONS = (".ifc",)

_PAGES_ITEM = re.compile(r"^\s*(\d+)\s*(?:[-–—]\s*(\d+))?\s*$")
