SEARCH_DESCRIPTION = (
    "Search the official Austrian legal information system RIS — the authoritative, always-current\n"
    "source for Austrian federal law, state law, and court decisions.\n"
    "\n"
    "WHEN TO USE THIS TOOL:\n"
    "- The question turns on what an Austrian law, regulation, or court actually SAYS: exact\n"
    "  wording, scope, thresholds, obligations, penalties, validity, or applicable version.\n"
    "- You need the precise legal anchor behind a requirement (law name, paragraph, Bundesland,\n"
    "  version). OIB-Richtlinien become binding via the state building laws found here.\n"
    "- Building law: Bauordnungen, Bautechnikgesetze, and Garagengesetze are STATE law — search\n"
    '  application "LrKons" and always set the federal_state.\n'
    "- Case law: how courts interpreted a provision (Vfgh, Vwgh, Justiz, Bvwg, Lvwg).\n"
    "\n"
    "WHEN NOT TO USE:\n"
    "- Content of the OIB-Richtlinien themselves or user-uploaded documents → knowledge_search.\n"
    "- Non-Austrian law, news, products, or general facts → web search.\n"
    "\n"
    "This returns document REFERENCES — title, application, document number, citation URL —\n"
    "and never the wording of a provision. Nothing here is quotable: a reference is an address,\n"
    "and a legal answer is grounded in the document that address names.\n"
    "\n"
    "Args:\n"
    '    query (str): German legal search terms, e.g. "Stellplatzverpflichtung Garage". Use\n'
    "        statutory terminology, not colloquial phrasing.\n"
    '    application (str): RIS application: "BrKons" consolidated federal law (default),\n'
    '        "LrKons" consolidated state law, "BgblAuth" authentic federal gazette, "Begut"\n'
    '        draft bills, "RegV" government bills, "Vfgh"/"Vwgh"/"Justiz"/"Bvwg"/"Lvwg" case\n'
    '        law, "Dsk" data protection decisions, "Erlaesse" ministry decrees.\n'
    '    title (str): Optional title filter when a specific law is named, e.g. "Bauordnung für Wien".\n'
    '    federal_state (str): State filter for state-law searches ("Wien", "Tirol", ...). Required\n'
    "        practice for Bauordnung questions.\n"
    '    date_from (str): Optional YYYY-MM-DD. Case law: earliest decision date. "BrKons": the\n'
    "        version in force at this date.\n"
    "    date_to (str): Optional YYYY-MM-DD. Case law: latest decision date.\n"
    "    page (int): 1-based result page.\n"
    "\n"
    "Returns:\n"
    "    str: Numbered document references with citation URLs and fetch instructions."
)

CATALOG_LOOKUP_DESCRIPTION = (
    "Look up an Austrian building-law topic in the curated RIS catalog of verified norms.\n"
    "\n"
    "WHEN TO USE THIS TOOL:\n"
    "- Any question about Austrian building law: Bauordnungen,\n"
    "  Bautechnikgesetze/-verordnungen, and the adjacent federal acts. The catalog\n"
    "  maps topics to VERIFIED RIS pointers (application, document number, citation\n"
    "  URL, 'entire consolidated law' URL) - no keyword guessing, no wrong silo.\n"
    "- What it returns is an ADDRESS per norm, never the text at it and never a\n"
    "  requirement: a pointer is not a provision and cannot be cited as one.\n"
    "\n"
    "WHEN NOT TO USE:\n"
    "- The catalog covers only the core building-relevant norms. For case law,\n"
    "  draft bills, gazettes, or anything beyond it, use ris_search (live RIS search).\n"
    "\n"
    "Args:\n"
    "    topic (str): German building-law topic. ALWAYS name the Bundesland for\n"
    '        state-law topics (e.g. "Bauordnung Tirol", "Stellplatz Wien") — the\n'
    "        nine state building codes differ, and the lookup returns the named\n"
    "        state's law (plus federal law) instead of all nine.\n"
    "\n"
    "Returns:\n"
    "    str: Verified pointer blocks (application, document number, citation URL,\n"
    "        entire-law URL) or guidance to use ris_search when nothing matches."
)

FETCH_DOCUMENT_DESCRIPTION = (
    "Fetch the ENTIRE text of an Austrian law or court decision from RIS on demand.\n"
    "\n"
    "WHEN TO USE THIS TOOL:\n"
    "- You hold a RIS ADDRESS — a document number or a ris.bka.gv.at URL — and need the text\n"
    "  at it. A reference is not quotable; this is what turns one into a document.\n"
    "- To load a complete consolidated law (every paragraph) from its 'Entire consolidated law'\n"
    "  URL, e.g. for a question spanning several sections.\n"
    "- To re-read a document the user or an earlier step referenced.\n"
    "\n"
    "WHEN NOT TO USE:\n"
    "- For documents not hosted on ris.bka.gv.at (this tool only fetches RIS).\n"
    "- When the relevant text is already fully present in this conversation.\n"
    "\n"
    "The fetched document is also added to the session knowledge base (full text, not truncated),\n"
    "so knowledge_search can retrieve and cite specific sections in later steps.\n"
    "\n"
    "Args:\n"
    '    reference (str): RIS document number from ris_search (e.g. "NOR40217157",\n'
    '        "JWT_2020130074_20210415J00") or any https://www.ris.bka.gv.at/... URL from\n'
    "        ris_search results (document URL or 'Entire consolidated law' URL).\n"
    "    application (str): Only needed with a document number whose application cannot be\n"
    '        inferred: "BrKons", "LrKons", "Vfgh", "Vwgh", "Justiz", "Bvwg", "Lvwg", ...\n'
    "\n"
    "Returns:\n"
    "    str: The document's full text (truncated if very long) with its citation URL,\n"
    "        retrieval date, and legal-status note."
)


SEARCH_PLAN_DESCRIPTION = (
    "Structured RIS search plan.\n"
    "\n"
    "Requested from the planner LLM with ``response_format: json_schema`` +\n"
    "``strict: true`` (OpenRouter structured outputs). Not every OpenRouter-served\n"
    "model honors strict schema mode, so a garbled JSON payload can still reach the\n"
    "parser and raise ``ValidationError``; ``_make_planner`` guards that with a\n"
    "bounded corrective retry. The enum constraints reject an invalid application\n"
    "or Bundesland whenever the payload does parse."
)
