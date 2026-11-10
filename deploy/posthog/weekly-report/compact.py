"""Print one query of this directory as the single-line JSON the PostHog MCP takes."""

import json
import re
import sys

text = open(sys.argv[1], encoding="utf-8").read()
text = "\n".join(line for line in text.split("\n") if not line.startswith("--"))
print(json.dumps(re.sub(r"\s+", " ", text).strip(), ensure_ascii=False))
