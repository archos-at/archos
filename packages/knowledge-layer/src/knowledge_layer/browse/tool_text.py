from .tree import TREE_PARAGRAPH

_LIST_FILES_DESCRIPTION = (
    "Lists the reader's OWN files the way the Files pane shows them: folder, Dokumentart, upload date. "
    "Deterministic, paged, not capped by the prompt inventory. "
    "It says which files exist, not what they say: reading or searching the documents does.\n"
    "Inputs, all optional: with none, every file on Projektwissen, Büroablage and Private Sitzung, ordered by "
    "folder, after an overview of the top-level folders with file counts. `folder=` one folder and everything "
    "below it. `name_contains=` words that must all appear in the file name or title (case and umlauts "
    "ignored). `doc_class=` a Dokumentart key. `added_since=` YYYY-MM-DD. `sort=newest`. `topic=` a Thema "
    "recognised in the documents (Attika, Holzrahmenbau). `shelf=` project | office_shelf | session | base (base, the "
    "platform OIB corpus, is listed only when asked). `offset=` the next page, as the result says.\n"
    + TREE_PARAGRAPH
    + "`revisions_of=` a file name returns that document's chain of Fassungen, newest first, each with "
    "Index/Datum, upload date and what changed against the one before; other filters are ignored. Add "
    '`compare_to=` another Fassung\'s file name, "previous", or any other file of the reader („vergleiche die '
    "Raumliste mit dem Raumprogramm“) for what changed, first → second: page by page in the printed text and "
    "the drawing reading, tables and lists row by row.\n"
    "Returns: a count, the subfolders, then one line per file: exact file name, title, folder, Dokumentart, page "
    "count, topics, the date a photo was taken, a Fassung mark (read from the name, or a replacement a person "
    "confirmed, with what changed), upload date, a one-line summary. An index, not a source: it is never cited, "
    "and a summary does not say what a file contains. File names are written exactly as returned; each becomes "
    "a link the reader can open."
)
