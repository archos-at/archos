# Citations an architect can rely on

Status: designed 2026-11-11; slice 1 is built, slice 2's record and interpreter are built (the line's form is a style record), the others follow in the order below.
The gap table was measured at `develop` `ac5936621` (2026-11-11); its file and line references are of that commit.
Marks: **V** verified by reading the code, **L** observed in a live answer on dev (test office, read-only), **I** inferred, not verified.

## The rule above every slice: a country is data

No country's identifier, host, file-name pattern, designation, legal-database name or phrase is written in
code (ADR-0162, ADR-0168, ADR-0169, ADR-0173, ADR-0174). Everything country-specific comes from the knowledge
records, the source records and the turn's knowledge context. For citations that means:

- **A citation finds its record by id.** A retrieved passage carries the work and edition id of the record it
  was read as. A corpus point is marked with its edition at ingest (`knowledge_edition_id`); a live source's
  producer finds the work by the identifier the work's record carries. Role, route, edition label and dates
  are read off the knowledge context by that id. Nothing is decided by matching a URL, a host or a file name.
- **An identifier scheme is a word in the records, never a list in code.** A work's `identifiers` are an open
  map `{<scheme>: <value>}` (scheme `^[a-z][a-z0-9_]{0,39}$`, value up to 300 characters, at most eight); a
  source record declares how its addresses state each scheme (`identifiers: {<scheme>: {query: <param>}}`),
  and a scheme means something exactly where a source record names it. Only `eli` is checked further (a URL
  ending with `/`), because ELI is a European standard, not a country's. A work may name a scheme before its
  source is onboarded: it finds nothing until one is (`platform/wire.ts`, `chain/source-refs.ts`).
  `designation` is never a scheme (`wire/source.ts`): the work's own designation is stored beside its
  identifiers. Only an `eli` value names a host the web screen trusts as the work's own
  (`web_sources.own_source_hosts`). Known debt: a passage is matched by a value read from a query parameter
  and compared whole, so no source record reads an ELI off a path yet, and a value's shape per scheme (a law
  number's digits) is checked nowhere; both belong on the source record's `identifiers`, as data.
- **The public address is display.** It is offered to a reader and printed in an exported document. It
  decides no role.
- **The form of a citation is a style per country, work kind and language, held in records.** Section 3 is
  the content of Austria's first style records and of three others as examples, not a table in code. One
  formatter interprets a style; no formatter knows a country.
- **Tests of code use an invented country** (`XA`). A real country's fixture tests that country's data.

## Decided by the owner (2026-11-11)

1. **"Abs." with dots** in the Austrian style, as Austrian legistics writes "§ 5 Abs. 2 Z 3 lit. a". It is a
   field of the Austrian style record, not a product-wide constant: another country's style decides its own.
2. **A normative value without a Fundstelle is shown, marked "ohne Fundstelle".** It is not withheld.
3. **Exported documents carry the public address** (the RIS ELI, oib.or.at) beside the designation.
4. **Model values carry a source**: model file and Stand, element, method, tolerance.

---

## 1. North star

Anna leads the Einreichung for a timber residential building in 1070 Wien. She asks how long the escape route to the stair may be.

The answer says 40 m. Beside the number stands one line, in the words she would write herself:
**OIB-Richtlinie 2, Ausgabe Mai 2023, Pkt. 5.1.1 · verbindlich in Wien über die WBTV 2023 · zuletzt geprüft am 30.10.2026**.

She clicks it. The Richtlinie opens at that Punkt, the sentence is marked, and the edition in the header is the one the line names. It took four seconds, and she did not have to trust anything.

The answer also rests on her own Brandschutzkonzept. That citation names the document, its Fassung and date, and the page; had she cited a superseded Fassung the line would say so. A value the agent measured in the model names the model's Stand, the element and the tolerance, and a click selects the element. A § of the Bauordnung opens in the RIS wording with its Fassung date, and reads "§ 63 Abs. 1 BO für Wien".

She copies the paragraph into the Brandschutzkonzept. The citation arrives as text an authority accepts, with the public link to oib.or.at or the RIS, never a file name or a link into her chat. The same line stands in the Word export, in the Aktenvermerk the agent drafts, in the Tiefenrecherche report, and in what her own Claude gets through the door.

Her project was filed on 01.06.2023. The line then says the 2019 edition bound on that day, and names the route.

Where the records do not yet say what binds, no chip claims it, no card claims it, no sentence claims it. Where the agent could not back a value, the value is marked as without Fundstelle; it does not stand there looking backed. A commentary is labelled as interpretation and never carries a requirement. A web page is labelled as information. When a newer edition is known, the line says that too.

Six months later a colleague opens the thread. Every citation still opens, shows the status it had on the day of the answer, and says if the base has changed since.

Everything citations should do, if anything were buildable:
1. Every claim resolves to the exact passage, element or record, in one click, for every kind of source.
2. The line reads the way the profession writes it, per kind, with edition and date.
3. Binding status, route, since-when and last check come from the records, for the project's reference date.
4. The same citation object renders on every surface, and leaves the product as text an authority accepts.
5. What cannot be backed is visibly unbacked.
6. Each of these is measured per answer and visible in Langfuse.

---

## 2. What architects actually said (the hypothesis, tested)

The hypothesis: a citation serves (a) trust, (b) checking in seconds, (c) reuse in a document for an authority, (d) knowing whether it binds here and now.

| | Evidence | Verdict |
|---|---|---|
| (a) trust | GernerGernerPlus, 02.11.: "Veraltete Quellen zerstören das Vertrauen selbst dann, wenn die Analyse an sich gut ist." "Für eine Prüfung fehlt das Sicherheitsgefühl, dass die richtigen Quellen genutzt werden." [Jour fixe GGP](https://app.notion.com/p/40c56a74272681f68359e48c728c1ddd). Zechner&Zechner 05.11.: complex answers only "halbwegs richtig" [Jour fixe Z&Z](https://app.notion.com/p/40f56a74272681e5a8e5c216a60ad640). feld72 30.10.: another paid LLM misread norms; "Human in the Loop. Bei Planungsentscheidungen Quellen über die Referenzierung prüfen, die Interpretation bleibt beim Menschen." [Jour fixe feld72](https://app.notion.com/p/40956a742726814a8e74e3eac3d5139e) | Confirmed, and sharper than assumed: the source being the *right Stand* matters as much as it being real. |
| (b) check in seconds | GGP: "Generell hilft ein Verweis auf die genaue Stelle mehr als eine fertige Antwort." "Bitte die Tür des WCs prüfen, hier ist der OIB-Satz dazu." feld72 23.10.: "Fundstelle in der Datei markieren und hinspringen (wie bei Normen-Treffern)" [Jour fixe feld72](https://app.notion.com/p/40256a7427268118a077eb56523b5155). feld72 30.10.: "in einer Besprechung in drei Minuten die richtige Normstelle in fünf Dokumenten finden". Ticket 94: "Klicke ich in einer Antwort auf eine RIS-Quelle, sehe ich die zitierte Stelle im Wortlaut, so wie bei den OIB-Richtlinien. Ich erkenne, aus welchem Gesetz und welchem Paragraphen sie stammt und welche Fassung gilt." [RIS-Quellen ansehen](https://app.notion.com/p/41356a742726812f8d52ec5033805bef). Routineprozesse: "Nachvollziehbar: Jede Aussage hat eine Fundstelle (Dokument, Seite, Planausschnitt, Norm-Abschnitt)." [Routineprozesse](https://app.notion.com/p/40e56a74272681a59cdbd6068eec3d4c) | Confirmed. It is the strongest signal in the research: the Fundstelle is worth more than the verdict. |
| (c) into a document | GGP: "Der Wert einer Antwort endet nicht im Chat." Export to PDF/Excel wanted [Prüfergebnisse speichern](https://app.notion.com/p/41156a7427268102b268f407d653eaa0). feld72 23.10.: export gave only MD files. feld72 mails "dienen als Nachweis bei Schäden, oft vier Jahre zurück". No interview quotes the exact citation form an authority expects. | Partly confirmed. Offices want results to leave the chat and to hold as Nachweis; the *form* of the citation is our inference from convention (section 3), not a quote. Marked as such in E9. |
| (d) binds here and now | Ticket 30: "Ich kann fragen ‚was galt zum Zeitpunkt unserer Einreichung' und bekomme die Antwort aus der damals geltenden Ausgabe, mit Angabe, welche das ist." "Wo ein Text einen anderen verbindlich macht, verdrängt oder davon abweicht, ist das hinterlegt und wird in der Antwort sichtbar – nicht nur im Fließtext einer Fundstelle." [Grundlagen wissen](https://app.notion.com/p/40756a742726815cb3e2e0dc672fad5a). Ticket 32: "Jede Antwort, die auf einer hinterlegten Grundlage beruht, nennt die genutzte Ausgabe und wann sie zuletzt geprüft wurde"; "Kommentare … mit Fundstelle zitiert – aber nie als Quelle einer Anforderung"; "Eine Grundlage, der wir nicht mehr trauen können, ist schlimmer als keine." [Büroeigene Normen](https://app.notion.com/p/40756a7427268115a698db317e975e7d). BWM 13.10. (Clemens Hörl): "Normen-Aktualitätsprüfung bei jeder Abfrage" [Onboarding BWM](https://app.notion.com/p/3f856a74272681ba802dfc58dd86796d). Z&Z: sees "als Quelle meist nur die OIB, obwohl das RIS angebunden ist" [RIS als sichtbare Quelle](https://app.notion.com/p/41156a742726811f833bd49889a54443) | Confirmed, with two additions the hypothesis lacked: *edition named and last checked on every answer*, and *the kind of source is visible* (norm, commentary as Auslegung, Weisung as Behördenpraxis). |

Two expectations the hypothesis missed, both from the interviews:
- **A hint with a Fundstelle beats a verdict.** A wrong verdict "schadet mehr als keine" ([Prüfungen als Hinweisliste](https://app.notion.com/p/41156a742726816a8246ebd2525d2c6e)).
- **Model values need a source too.** Product decision "Quellenangabe bei Modellwerten", decided yes (decision 4) ([3D-Modell](https://app.notion.com/p/41356a742726814fa6a3c19ed0a783d1)).

The repo's own statements agree: VISION principle 3 ("A claim resolves to a passage a person can open … What it cannot ground, it does not present as fact"); `CONTEXT.md` "Citation" and "Fundstelle"; design §6.7 ("Citations name edition, role, route and last check: 'OIB-RL 2, Ausgabe Mai 2023, verbindlich in Wien über die WBTV 2023, zuletzt geprüft am 30.10.2026'", `docs/design/international/design.md:870`); design §3.5 roles; `dev-acceptance.md` A1 to A8 and its four "every answer fails if" rules; ADR-0125, ADR-0139, ADR-0168, ADR-0175.

---

## 3. How the profession writes a reference

The form differs per country, kind of work and language. Each row below is the content of a `citation_style`
record (pattern, locus vocabulary and order, abbreviation rule, edition phrase, date format), which the one
formatter interprets and the reference parser reads its grammar from. The first table is Austria's; the second
shows why the form cannot be code.

| Source kind | Form | Convention |
|---|---|---|
| Law, ordinance | `§ 63 Abs. 1 Z 2 lit. a BO für Wien, LGBl. Nr. 11/1930 idF LGBl. Nr. 37/2023` | Legistische Richtlinien 1990, Bundeskanzleramt ([PDF](https://www.Bundeskanzleramt.gv.at/dam/jcr:f4301575-c575-403b-9300-a7dc01ec1a51/legrl1990.pdf), [BKA page](https://www.bundeskanzleramt.gv.at/agenda/verfassung/legistik/e-recht-legistische-richtlinien.html)): § then Abs., Z, lit.; first mention with Fundstelle and "in der Fassung". Legal literature follows AZR (Friedl/Loebenstein, Manz) and drops the dots ("Abs 1 Z 2 lit a"). Both are accepted; a document to an authority usually follows the legistic form. **The exact rule numbers were not re-read for this design (I, from knowledge); the PDF is the source to check.** The code writes "Abs 1" today (`ris-adapter/lookup/passages.py`). Decided: with dots, as a field of the Austrian style (decision 1). |
| OIB-Richtlinie | `OIB-Richtlinie 2, Ausgabe Mai 2023, Pkt. 5.1.1` (tables: `Tabelle 1b`); document number `OIB-330.2-…/23` optional | The OIB's own title pages and the Länder ordinances that adopt them ("OIB-Richtlinie 2, Ausgabe Mai 2023"). Punkt, never page, identifies the requirement; the code already says so (`source-citation.ts:52-60`). |
| Norm an OIB-RL refers to | `ÖNORM B 1600:JJJJ-MM-TT, Pkt. 5.3.2`, in the edition the OIB list fixes | OIB document "OIB-Richtlinien – Zitierte Normen und sonstige technische Regelwerke" (OIB-330-004/23, Ausgabe Mai 2023): the cited norms apply "in der … angeführten Fassung" (found via the Tirol and NÖ publications of the OIB texts, [tirol.gv.at](https://www.tirol.gv.at/fileadmin/themen/bauen-wohnen/baupolizei/OIB-2023/aenderungen_oib-rl_1_ausgabe_mai_2023.pdf), [NÖ BTV Anlage 8](https://noel.gv.at/noe/Kontakt-Landesverwaltung/Anlage_8_NOe_Bautechnikverordnung_2014.pdf)). ÖNORM designation with issue date is Austrian Standards' own form (I, from knowledge). |
| EU law | `Verordnung (EU) Nr. 305/2011 …, ABl. L 88 vom 4.4.2011, S. 5`, Art. … Abs. …; CELEX/ELI as the link | Interinstitutional Style Guide of the EU (I, from knowledge). |
| Office or project document | title, Dokumentart, Fassung or Planindex with date, page or sheet | Office practice (GGP, BWM interviews: Plannummer, Index, Stand decide which sheet counts). |
| Model value | model file and Stand, element (name, GlobalId), method, tolerance | `MeasurementFacts` in `citations/model.ts:86-108` already holds this. |
| Web | title, publisher/host, date retrieved | General practice; the retrieval date must be the day the agent read it. |

Per country and language (**I**, to be confirmed by each country's reviewer and stored as records):

| Country, language | Law | Technical rule | Standard |
|---|---|---|---|
| AT, de | § 63 Abs. 1 Z 2 lit. a BO für Wien, LGBl. Nr. 11/1930 idF LGBl. Nr. 37/2023 | OIB-Richtlinie 2, Ausgabe Mai 2023, Pkt. 5.1.1 | ÖNORM B 1600:2023-03-01, Pkt. 5.3.2 |
| DE, de | § 33 Abs. 2 Satz 1 BauO NRW 2018; Art. 31 Abs. 2 BayBO | MVV TB 2025/1, Abschnitt A 2.1.3 | DIN 4109-1:2018-01, Abschnitt 6.2 |
| CH, de / fr / it | Art. 22 Abs. 1 RPG (SR 700) / art. 22 al. 1 LAT (RS 700) / art. 22 cpv. 1 LPT (RS 700) | VKF-Brandschutzrichtlinie 16-15, Ziff. 3.4 | SIA 500:2009, Ziff. 3.2 |
| EU, any | Art. 5 Abs. 1 der Verordnung (EU) Nr. 305/2011, ABl. L 88 vom 4.4.2011, S. 5 | | EN 13501-1:2018 |

---

## 4. Expectations (testable)

Each has an id used in the gap table and the slices.

**Trust**
- **E1** Every normative value and every statement about a document's content carries a citation, or is visibly marked as without Fundstelle. A citation the verifier removes never leaves the sentence looking backed. *(VISION 3; GGP "falsche Bewertung schadet mehr"; ADR-0125)*
- **E2** A citation names only a source the turn read: never a URL lifted from a page's body, never a document recalled from memory. *(CONTEXT "Citation"; feld72 30.10.)*
- **E3** Text in quotation marks is verbatim in the source it is attributed to; otherwise it is not presented as a quote. *(CONTEXT "Citation"; ADR-0067)*
- **E4** A check delivers hint plus Fundstelle; a verdict appears only with evidence from the document checked. *(GGP 02.11.; Z&Z; feld72 06.11.)*

**Check in seconds**
- **E5** One click opens the exact passage, marked, for every source kind: OIB, RIS law, EU law, office and project documents (PDF and Office formats), drawings (region on the sheet), IFC elements, e-mail, web. Where it cannot mark, it says so. *(feld72 23.10.; ticket 94; Routineprozesse)*
- **E6** The locus the sentence writes (Pkt., §, Abs., Z, Tabelle, Seite) is in the passage that opens, and the page that opens is one the turn read. *(CONTEXT "Citation"; Stanford misgrounding, `citation_locus.py:1-9`)*
- **E7** The edition the sentence or card names is the edition of the text that opens. *(ticket 30, 32; design §6.7)*
- **E8** A citation of an office or project document names its Fassung or Stand and says when it is not the current one. *(GGP "Planstand"; feld72 06.11. "Nicht jeder Stand ist eine verlässliche Quelle")*

**Form**
- **E9** The citation line reads as in section 3 for its kind, with edition and date, and is identical on every surface: chip and peek, copy, Word export, the door, documents the agent writes, task and research reports, the model check. *(design §6.7; inference from convention, see section 2 (c))*
- **E10** Nothing machine-made reaches a reader: no corpus file name, no `[KB]`/`[Web]` token, no `p.26`, and no link into a private thread in text meant for outsiders; the public address (oib.or.at, RIS ELI) is offered instead. *(AGENTS.md "German is for people"; dev-acceptance "raw verification marker" rule, by analogy)*
- **E11** Every date on a citation is true: "abgerufen am" is the retrieval day, a RIS text carries its Fassung date, "zuletzt geprüft" is the record's check. *(ticket 32; BWM 13.10.)*

**Binds here and now**
- **E12** Binding status is shown where the records say so and nowhere else, with the route ("über die WBTV 2023") and for the project's reference date. *(design §3.5, §6.7; ticket 30; dev-acceptance A1, A2, A8)*
- **E13** Without published records nothing claims binding: no chip, card, sentence, model check, or web-derived statement. *(dev-acceptance "Fails if"; ADR-0175)*
- **E14** The kind of source is visible (law, guideline, Erläuterung or commentary, authority practice, office document, web), and a commentary never carries a requirement. *(ticket 32; design §3.5)*
- **E15** Law is cited from the law's source (RIS), a norm from the corpus copy, never from a mirror, a vendor copy or the product's own site. *(dev-acceptance last two rules; Z&Z "meist nur die OIB")*
- **E16** The line says when the edition was last checked and whether a newer one is known. *(ticket 32; BWM)*

**Reach**
- **E17** A link opens only what the reader may see; a removed or withheld source says so ("Quelle entfernt"); corpus PDFs are served by entitlement and release state; licensed text is quoted only as far as the licence allows. *(design §6.6; ADR-0164; ADR-0173)*
- **E18** A citation survives reload, sharing and export as it was shown, with its as-of date, and streaming never shows a citation that later disappears without notice. *(ADR-0037, ADR-0066)*
- **E19** Each expectation above has a deterministic test and, where it is a property of an answer, a Langfuse score. *(AGENTS.md obligations; ADR-0089)*
- **E20** Labels are German for people (S., Pkt., Ausgabe) with English equivalents through i18n; every chip has a name a screen reader speaks and is reachable by keyboard. *(AGENTS.md; VISION principle 2)*

---

## 5. What real answers show (dev, 10 to 11 Nov 2026, coverage "before publish")

Read through the door's `conversation-message-list` operation on dev. This is also exactly the text an outside agent gets.

| Conversation | What the answer did | Expectation broken |
|---|---|---|
| "Wie lang darf der Fluchtweg …" `s_410d4eaf…` | "Nach OIB-Richtlinie 2, Ausgabe Mai 2023, … **höchstens 40 m**" with **no `[N]` at all**; the only source listed is the project description. The key value has no Fundstelle and nothing says so. dev-acceptance A1 asks for Punkt 5.1.1 from the corpus copy. | E1, E5 |
| "Was sagt § 50 Wiener Garagengesetz?" `s_787ca7f4…` | Cited `gesetzefinden.at` and `jusline.at` as `[Web]`; the answer itself says the RIS text "konnte hier nicht … geprüft werden". dev-acceptance A5 fails ("no RIS text is quoted"). | E15 |
| "Welcher U-Wert … Außenwand" `s_e7c437f7…` | "Laut OIB gilt dort seit 16. Juli 2026 die Ausgabe 2025 [2]" from `http://www.oib.or.at/de/inkrafttreten-2015`: a binding edition named from a web page, over plain http. dev-acceptance A2 "Fails if". | E13, E15 |
| "Feuerwiderstandsklasse … GK 4" `s_a00e5f69…` | "In Wien beträgt die Anforderung nach OIB-Richtlinie 2 … R 60 [1]" before the records are published; `[1]` is `[KB] oib-rl_2_ausgabe_mai_2023.pdf, p.26`: a file name and a page, no Tabelle 1b, no Punkt. | E9, E10, E13 |
| all | The stored sources section is `- [1] [KB] oib-rl_2_ausgabe_mai_2023.pdf, p.26`. The UI turns it into chips; the door, and any agent reading the thread, get it raw. | E9, E10 |

The ÖNORM and "Punkt 9.4.7" probes of 11 Nov were refused by turn admission ("several answers in progress"), so no observation for licensed norms or a non-existent Punkt.

---

## 6. Gap table

As measured before slice 1. What slice 1 closed is listed under "Slices"; the rows stay as the inventory the
later slices work from.

Severity: **S1** an architect sees a wrong or unusable citation; **S2** degraded; **S3** note.

### 6.1 The citation carries too little (edition, role, route, dates)

| # | Exp. | What the code does | Sev. |
|---|---|---|---|
| G1 | E7, E12, E16 | The BFF resolves per edition `date`, `freshness`, `lastCheckedAt`, `labels`, `designation`, `editionLabel`, `sourceUrl`, `sourceRefs` (`bff/base-knowledge/context/wire.ts:63-91`). Python keeps `designation`, `edition_label`, `source_refs` and drops the rest (`common/knowledge_context.py` `EditionUse`, ≈90-108). The citation wire emits only `role`, `role_qualifier`, `edition_id`, `binding_status` (`citations/wire.py:73-105`, `roles.py:158-162`). The UI model has no field for any of them (`ui/features/chat/lib/citations/model.ts` `CitedDocument`), and persistence stores only `binding_status` (`citations/persistence.ts:89,169`). The design's line (§6.7) cannot be rendered anywhere. **V** | S1 |
| G2 | E12 | The route ("über die WBTV 2023") is not on a use at all: `via` is `territory|relation|none`; the declaring work stands only in the chain text the model reads. **V** | S2 |
| G3 | E12, E5 | **RIS on the chat surface never gets a role and cannot be opened.** Chat's one RIS tool is `ris_lookup` (`configs/config_oib_openrouter.yml:822-832`). Its hits state no URL on purpose (`ris-adapter/src/lookup/render.py` `_hit`, "No URL is stated"), and `_entry_from_hit_fields` leaves `url` unset (`citations/extraction.py:202-245`). `roles._ref_matches` matches a legal-database passage only by `entry.url` (`roles.py:95-105`), so the match never fires. `resolveCitationTarget` needs an http URL or a file name with an extension (`citations/target.ts:302-311`, `wire.py:44-52`), so the chip is an `info` target: "resolved to nothing". The test builds the entry by hand with a URL and tool `ris_fetch_document` (`tests/citations/test_roles.py:187-210`), a shape chat never produces. This is Notion ticket 94 and dev-acceptance A5 ("with the role from the records"). The first review's claim holds on chat, for this reason; on deep research (URL-based RIS tools) roles can match. **V** | S1 |
| G4 | E11 | "abgerufen am" in the copied Fachtext is the day of copying (`source-citation.ts:307`, `accessedDate(now)`), and no retrieval time is carried for a web or RIS source (`SourceEntry` has none, `citations/entries.py:20-100`). A citation copied in March from a November answer claims a March retrieval. **V** | S2 |
| G5 | E7 | The edition in a copied citation is parsed by regex from title and file name (`source-citation.ts:100-113`), never from the record's `editionLabel`. RIS: the Fassung date is inside the citation key only when RIS stated one (`passages.py` `citation_for`). **V** | S2 |
| G6 | E8 | A project or office citation carries no Fassung, Stand or date on the wire (`wire.py` payload); "Ältere Fassung" is computed at view time in the peek only (`CitationPeek.tsx` `OlderRevisionLine`). Copy, export and door know nothing of it. **V** | S2 |

### 6.2 What the sentence says is not held to what opens

| # | Exp. | What the code does | Sev. |
|---|---|---|---|
| G7 | E7 | **Edition drift, confirmed.** Corpus file names for 2015, 2019, 2023 and 2025 are all mapped (`common/oib_file_names.py:36-52`); nothing in `agent/knowledge` or `knowledge-layer/src/search` scopes retrieval by edition (grep: no `corpus_files`/`edition_id` reader). `GroundingHit` has no edition field (`common/grounding_block.py:146-218`). The locus check reads only Punkt and § (`common/citation_locus.py:42-43`). Nothing compares "Ausgabe … 2019" in the prose with the file `[N]` resolves to. **V** | S1 |
| G8 | E7 | Card and verdict `reference {document, section, edition}` is model-written free text (`common/answer_envelope.py:187-192`). The only check is a two-way substring of the document name against the turn's sources (`citations/trailer_values.py:86-93`); `section` and `edition` are unchecked. The footer's "view" calls `resolveCorpusFileName`, which takes the first `oib-rl_<n>_` file whatever its edition (`ui/features/knowledge/lib/resolve-corpus-file.ts:36-44`, used at `ui/features/cards/schematics/kit.tsx:756`) and opens it at page 1 with no mark. The card can print "Ausgabe Mai 2023" and open the 2019 PDF. **V** | S1 |
| G9 | E6 | Locus check: Punkt/Pkt. and § only, the closest one within 80 characters (`citation_locus.py:40-43`); Abs., Z, lit., Art., Tabelle, Seite are not checked; an entry with neither text nor clause passes (`:104-106`). It runs on chat (`answer_pipeline.py:542`) and **not on deep research** (`agents/deep_researcher/finalize.py:432` passes no `check_locus`). **V** | S2 |
| G10 | E6 | A cited page the turn never read resolves to the first retrieved page of that document (`citations/registry.py:305-327`, by design "page numbers are not required to match", `:292-300`). The chip opens a different page and nothing says so. **V** | S1 |
| G11 | E3 | Quote check is whole-registry: a span is verified when *any* passage of the turn holds it (`citations/quote_verification.py:239-301`, `best_coverage` over all chunks). A sentence quoted from the 2019 text and cited to the 2023 `[N]` passes when both were read. **New.** **V** | S1 |
| G12 | E3 | A quote no passage holds stays in quotation marks, with no mark in the text (ADR-0125 amendment 2026-11-10; `answer_pipeline.py:531-551`). The UI stamps quote *lines* `not_found` (`common/quote_stamps.py`), inline quotes get nothing; confidence is capped. Copy, export and door carry the quote unmarked. **V** | S1 |
| G13 | E1 | A citation that fails is removed without trace in the prose (`verify_citations(drop_unresolved=True, check_locus=True)`, `answer_pipeline.py:542`). The value stays and reads as a plain fact. The live "40 m" answer is this shape. Only the confidence judge and the asynchronous `judge-uncited-claims` see it; nothing deterministic marks a normative value with no surviving citation, although `citation_events` already names the reason `normative_claim_uncited`. **New.** **V + L** | S1 |
| G14 | E1, docs | `CONTEXT.md:372-379` still says a failed pointer "is replaced by *Beleg nicht verifiziert*" and a misquote "is marked". The code removes and marks nothing since 2026-11-10. `finalize.py:420-426` docstring says "ships MARKED" above code that does not. Doc and code disagree. **V** | S3 |

### 6.3 The line is not in the profession's form, and differs per surface

| # | Exp. | What the code does | Sev. |
|---|---|---|---|
| G15 | E9 | **Five renderers, five forms.** (1) Fachtext copy `toTechnicalText` (`source-citation.ts:276-310`); (2) quote copy `toQuoteList` (`:322-333`); (3) copy-answer `sourcesMarkdown` (`lib/answer-markdown.ts:≈80-112`); (4) Word export `referencesFromStored` (`bff/answer-export/citations.ts:98-150`); (5) door evidence (`bff/agent-asks/answer-evidence.ts:42-68`); plus the model's own stored `## Quellen` lines. **New.** **V** | S1 |
| G16 | E9, E10 | The prompt orders the machine form: "`- [N] filename.pdf, p.X` with the citation key exactly as the tool returned it" (`prompts/chat_static.md:93`). The stored answer therefore reads `[1] [KB] oib-rl_2_ausgabe_mai_2023.pdf, p.26`. `answerTextForAgent` (`bff/agent-asks/answer-text.ts:36-42`) and `conversation-message-list` hand that to outside agents unchanged. **V + L** | S1 |
| G17 | E9, E10 | Word export labels a source `${citation_key} — ${title}` (`answer-export/citations.ts:98-103`): "oib-rl_2_ausgabe_mai_2023.pdf, p.26 — OIB-Richtlinie 2 …, S. 26". The comment assumes keys look like "OIB-RL 2, Pkt. 3.1"; they never do. No Punkt (`clause` unused), no role; the `note` reads `binding_note`, which the wire stopped sending. **New.** **V** | S1 |
| G18 | E9 | The per-source copy button uses the quote form whenever a snippet exists (`CopyCitation.tsx:147-153`), which is nearly always. That form is "„<up to 1,200 characters of the retrieved chunk>" — Titel, S. x" (`source-citation.ts:322-333`, `wire.py:205-220`): the chunk, not the quoted sentence, in quotation marks, cut at a word; no Punkt, no §. **New.** **V** | S1 |
| G19 | E9 | Law form: "Titel, § 63 Abs 1, in: Rechtsinformationssystem des Bundes (RIS), abgerufen am …" (`source-citation.ts:298-300`). No "idF", no LGBl./BGBl. number, § after the title. Not how a Stellungnahme cites (section 3). **V** | S2 |
| G20 | E9 | Door evidence is `{documentId, name, page, url}` (`answer-evidence.ts:59-64`): no Punkt, edition, role or quote, and `url` for a document is the asker's private thread. The architect's own agent cannot write a proper reference. **New.** **V** | S2 |
| G21 | E9, E12 | The model check cites "OIB 2 3 — Titel" (`bff/bim/rules.ts:1371`). Rules hold `richtlinie: 'OIB 4', clause: '2.2'` and thresholds from the 2023 texts with no edition in the data (`rules.ts:384-390`, comment at `:298`), and "every OIB-Richtlinie binds in Austria" (`:387`). Prüfbuch, BCF and the checks export state pass or fail against one edition whatever binds at the site and date. **New.** **V** (click-through from a rule to its passage not checked, **I**) | S1 |
| G22 | E9, E2 | Documents the agent writes are free Markdown through the draft tools; `verify_citations` has two callers only, chat and deep research (grep over `packages/agent/src/agent`). An Aktenvermerk or Stellungnahme draft carries whatever references the model typed, unverified and unformatted. **New.** **V** (by absence) | S1 |
| G23 | E9 | A measurement copies as a document title: `toCslItem` has no branch for kind `measurement` (`source-citation.ts:196-258`), so model, element, method and tolerance are lost outside the chip. Decided: a model value carries a source (decision 4). **New.** **V** | S2 |
| G24 | E20 | Citation keys use the English "p." in German answers (prompt, `:93`); the UI localises, stored text does not. Chips have `aria-label` (`ris-preview-chip.tsx`, `citation-face.tsx`). Keyboard order, inline `[N]` naming and the dialog's focus handling were not audited. **V / I** | S3 |

### 6.4 Where a source comes from

| # | Exp. | What the code does | Sev. |
|---|---|---|---|
| G25 | E15 | The web screen withholds only a `.pdf` whose name or title matches an OIB pattern, and the product's own domains (`common/web_sources.py:66-78`). Mirrors of law (jusline.at, gesetzefinden.at), HTML pages of the OIB, Länder copies of OIB PDFs under other names, and copies of any ÖNORM pass. Observed live. **V + L** | S1 |
| G26 | E2 | For a tool without a parser the extractor registers **every URL in the output** as a citable source (`citations/extraction.py:311-332`), including links inside a page's body that the turn never fetched. **V** | S1 |
| G27 | E13 | "No binding claim before publication" is held by prompt alone (`chat_static.md:19-20`, `knowledge_context.gate_note`). The chip is fail-closed (`roles.py`, good), prose and cards are not. Observed live twice. **V + L** | S1 |
| G28 | E17 | URL vetting on source lines: drops IPv4 literals, shorteners, non-http schemes (`citations/sanitize.py:245-265`). Plain `http`, IPv6 literals, `localhost` and internal names pass; nothing checks that a web source still resolves. Observed: an `http://` OIB link. **V + L** | S2 |
| G29 | E17 | `GET /api/knowledge-base/documents/[fileName]` is `sessionOnly` (`app/api/knowledge-base/documents/[fileName]/route.ts:17-22`) and forwards to `/v1/oib/documents/{name}`, which serves any file the corpus lists (`agent-host/routes/oib.py:225-245`). No entitlement, country or release check. That it reaches unreleased (`ZZ`), other-country and draft uploads is the first review's claim; the missing check is **V**, the specific file classes **I**. | S2 |
| G30 | E5 | Links are document level. The in-app link is `?cite=` on the asker's thread (`citations/deep-link.ts`); there is no public `#page=` or ELI-paragraph address on any citation, although the use carries `sourceUrl`. EU law has records (`configs/knowledge-packs/eu.json`) and no text source in the repo (no EUR-Lex/CELEX reader), so an EU citation can open nothing. **V** | S2 |

### 6.5 Observability and tests

| # | Exp. | What the code does | Sev. |
|---|---|---|---|
| G31 | E19 | Scores that exist: `citation-health`, `answer-grounded`, `sources-empty`, `citations-removed`, `quotes-unverified`, `retrieval-precision`, `answer-confidence`, `confidence-capped`, `quotes-verbatim-rate`, judge `judge-uncited-claims` (`observability/langfuse_scores.py:400-435`, `langfuse_catalog.py:96`). The design's `edition_named`, `claim_citation_resolves`, `route_complete`, `jurisdiction_consistent` (design `:449,:553`) do not exist in code. No score sees G3, G7, G8, G10, G11, G25, G27. **V** | S2 |
| G32 | E19 | What fails open, by design and unscored: locus check on entries without text; quote check when no source has text; shelf qualifier narrowing (`registry.py:262-276`); page mismatch (G10); title-head match (`references.py:287-327`); URL resolution by prefix, child path and query subset (`registry.py:171-246`), which rewrites a model-typed URL to a registry URL it merely resembles. **V** | S2 |
| G33 | E19 | Checks that exist but do not run on a surface: `check_locus` on deep research (G9); `drop_ungrounded_trailer_values` covers verdict, takeaways and callout but not the reference's section or edition (G8); `role_fields` is emitted and read by no client (G1). Markers `UNVERIFIED_QUOTE_MARKER`/`DROPPED_CITATION_MARKER` are defined and no longer written (ADR-0125 amendment), kept only for old stored answers. **V** | S3 |

### 6.6 Not measured here (say so rather than guess)

Streaming settle (`settle_streamed_citations`), e-mail citations (one mail as a section of the E-Mail-Verlauf), drawing regions on DXF, licensed-norm excerpts in chips (ADR-0164 `quotable`), task-run reports, and the full keyboard and screen-reader pass were read at the level of file and docstring only. Treat every statement about them as **I**. Each slice below names the surface it must check before it claims done.

---

## 7. Slices

Order is dependency order. **None needs a migration**: citations persist in `messages.metadata` (a `jsonb`
column with no constraint on its shape, `docs/database/schema.md` "messages"; the stored payload's fields are
optional, `citations/persistence.ts`), and the knowledge context is a wire. Confirmed for slice 1.

Each slice that changes what shapes an answer runs `task be:eval:answer-suite` before and after (AGENTS.md)
and adds its dev-acceptance rows. New scores are declared in `SCORE_DEFINITIONS` and documented in
`docs/observability/langfuse.md`.

### Slice 1. A citation carries its edition, role, route and dates (built)

**Goal.** One citation object holds everything the line of design §6.7 needs, from the records, on every hop:
agent, wire, store, UI. A passage read at a legal database gets its role and can be opened.

**The mechanism.** A hit states the record it was read as, and the role is resolved by that id.

| Hop | What it carries now | Where |
|---|---|---|
| Records to the turn | Each use of the knowledge context adds `route` (the declaring instrument: work id, designation, edition label, provision), `roleSince`, `language`, `textStatus` beside `date`, `freshness`, `lastCheckedAt`, `labels`, `sourceUrl` | `bff/base-knowledge/context/resolve.ts`, `context/wire.ts` |
| The agent's copy of the turn | `EditionUse` keeps all of them; only `connectsBy` is dropped, with its reason, and a parity test fails a field that is neither read nor on the drop list | `common/knowledge_context.py`, `tests/common/test_knowledge_context_parity.py` |
| A retrieved passage | `GroundingHit.work_id`, `edition_id`, `public_url`, `revision` as record fields the model never reads. A corpus point's edition is its `knowledge_edition_id`; a legal-database passage's work is the one whose record carries the identifier the source's own record reads off the document (`identifiers` in the source record, `use_for_source_ref`); an office or project document states the index and day its name carries | `common/grounding_block.py`, `knowledge-layer/src/search/grounding_hits.py`, `ris-adapter/src/lookup/render.py`, `public-sources/src/source.py` |
| The registry | `SourceEntry` keeps them, through the session cache too, and stamps `retrieved_at` once on a source read live | `citations/entries.py`, `registry.py`, `session.py` |
| Role | By id against the turn's uses. URL and host matching is deleted. One bridge stays for a corpus point indexed before the mark: its file name, compared whole with the names the edition's records list | `citations/roles.py` |
| The wire | `role`, `role_qualifier`, `work_id`, `edition_id`, `designation`, `edition_label`, `route`, `role_since`, `as_of`, `last_checked_at`, `freshness`, `role_labels`, `language`, `text_status`, `public_url`, `retrieved_at`, `revision` | `citations/wire.py` |
| Store and UI | One schema for the live wire, the browser's stored payload and the BFF's (`shared/citation-line.ts`); `CitationSource.line` and `CitedDocument.line` carry it; a passage cited by its key opens at its public address | `ui/features/chat/lib/wire-citation.ts`, `citations/persistence.ts`, `citations/target.ts`, `bff/conversations/agent-answer-metadata.ts` |
| The record of an answer | `message_edition_uses` is chosen by the cited sources' record ids, so a law read live is recorded too | `bff/base-knowledge/context/edition-uses.ts` |

**Closes.** G1, G2, G3, G6 (the Fassung a document's name states), the data half of G4 and G5, the public
address of G30. E7, E11, E12 and E16 as data; E5 for a law read at its source; E18 for the stored line.

**Langfuse.** `citation-role-resolved` and `edition-named` (`docs/observability/langfuse.md`).

**Not in slice 1, and why.**
- **`common/oib_file_names.py` stays.** `citations/roles.py` no longer reads it, so no role depends on a
  file's spelling. Its three other readers in `norm_registry.py` decide a corpus file's lane, document class,
  display title and family from the Austrian file-name convention; they are answer-shaping and need a
  replacement from the records and the answer suite. That is the slice "readers read released records".
- **Deep research's two URL tools state no record**, so their passages of a law carry no role any more
  (they matched by URL before). They get one when the single law lookup below replaces them.
- **Whether an older Fassung of an office document is the current one** is still resolved at view time
  (`CitationPeek`). The wire carries what the name states, not the person-confirmed replacement.
- **An ELI as an address identifier**: a source record reads an identifier from a query parameter only.
- **No surface words the line yet.** The peek, copy, export and the door read the fields in slice 2.

### Slice 2. One citation line, interpreted from a style record

**Goal.** A single pure formatter turns the citation object into the line its country's style gives, per kind
and language, plus the status line. Every surface calls it. Nothing else formats a citation.
**Closes.** E9, E10, E11, E20. Gaps G4, G15 to G20, G23, G24.
**Change.**
- A `citation_style` record per work kind and language: the pattern, the locus vocabulary and order, the
  abbreviation rule ("Abs." with dots is a field of the Austrian style, decision 1), the edition phrase, the
  date and number format. Section 3 is the content of the first records. Until styles are published records,
  ship them as a fixture the formatter reads through the same loader, so no second formatter appears.
- The formatter is an interpreter under `apps/workspace/shared/`, with one fixture of citation objects and
  expected lines per country and language. It knows no country.
- Replace: `ui/features/chat/lib/source-citation.ts` (`toTechnicalText`, `toQuoteList`: the quote is the
  answer's verified quote from `quoteStamps`, not the chunk), `lib/answer-markdown.ts` (`sourcesMarkdown`),
  `bff/answer-export/citations.ts` (`labelFor`, `referencesFromStored`), `bff/agent-asks/answer-evidence.ts`
  (adds `citation`, `clause`, `edition`, `role`, `publicUrl`, `quote`), `bff/agent-asks/answer-text.ts`
  (rewrite the stored `## Quellen` lines from the stored citations, so no outside reader sees
  `[KB] file.pdf, p.26`), the chip peek (`CitationPeek.tsx` shows the line and status).
- Exported documents print the public address beside the designation (decision 3). A model value copies as a
  source with model, Stand, element, method and tolerance (decision 4).
- The chip's accessible name is the line.
- Catalog: the `conversations` operations' output schema, `exposure.json`.
- Fix `CONTEXT.md` "Citation" (G14) here.
**Tests.** The fixture, consumed by the formatter's spec and by a spec per surface (copy, docx, door, peek);
an import-graph spec that fails a second formatter. `answer-text.spec.ts`: no file name, `[KB]` or `p.` in
door text. i18n key coverage.
**Langfuse.** None of its own; `edition-named` from slice 1 is its measure. Release note, captures of chip,
peek and the Word page.

**Built (the record and its interpreter).** The form is a ruleset of purpose `citation_style`
(`citation_style.v1`, migration 0234): a ruleset rather than a record type, because a ruleset already carries
territories, validity, review and release and needs no body table of its own. Per language it holds which
sources are a standard or a law (`kinds`, matched by authority, tint, lane prefix or origin), who publishes a
standard and where a law is read, one template per kind of line, the bare-locus and page labels, the quote
form, the edition phrase and the date form. `bff/base-knowledge/wire/citation-style.ts` is its schema and
`apps/workspace/shared/citation-style.ts` the interpreter, which names no country; `ui/features/chat/lib/source-citation.ts` only maps the citation model onto
it. Austria's form is its record, `configs/knowledge-packs/at-citation-styles.json`, a change request of its
own. Readers: the chip's copy and the document dialog's quote (`useCitationStyles`, from
`GET /api/citations/style`, the operation `citation-style-get`), the copy-all export (Fachtext, quotes,
CSL-JSON and the APA, BibTeX and RIS it feeds), and an outside agent's ask evidence (`AskSource.citation`).
The gate is `shared/citation-lines.fixture.spec.ts` over `apps/workspace/tests/fixtures/citation-lines/`:
the same citations, Austria in German from its record (byte for byte the lines the code wrote before), and
the synthetic country XA in English and French, on all three surfaces.

*Buy, not build.* citation-js was already the CSL renderer here (APA, BibTeX, RIS on the BFF). A CSL style
does not fit the line: the chip formats in the browser, synchronously, and citation-js cannot be bundled for
the browser at all (`bff/citations/render.ts`); CSL has no variable for a country's locus grammar or edition
phrase, which only the CSL-M extensions of Juris-M add (**I**, from knowledge; citeproc-js was not measured).
The interpreter fills templates, each a list of segments printed only when all their fields have a value; CSL-JSON stays its output. The formatter went from 193 lines of code to 164, the record's schema (`bff/base-knowledge/wire/citation-style.ts`) beside it.

*Fallback, delete after rollover.* Until a style is released on an environment, lines are written in
`shared/citation-style.fallback.json`, which a spec holds equal to a pack's record. Delete it, with
`FALLBACK_CITATION_STYLES` (`shared/citation-style-fallback.ts`) and the `null` answer of `bff/citations/style.ts`, once Austria's record is
published on prod.

*Not yet, and why.* The Word export (`bff/answer-export/citations.ts`), the copy-answer Markdown
(`lib/answer-markdown.ts`) and the peek still label a source from i18n ("S. {page}") rather than the line:
moving them changes what they print today, so each is its own change against this fixture. The style chosen
is the office's home country's, not the source's: an EU or a foreign source is written in the office's form
until a citation carries its work's country. "Abs." with dots (decision 1) and the law's Fundstelle with
"idF" are revisions of Austria's record, not code, once a law's locus arrives as units rather than text (the
RIS adapter writes "Abs 1"); the locus vocabulary and the "ohne Fundstelle" mark (decision 2) join the
record with slice 3, which is their first reader. Two edges are not as before: an edition word that is not
German ("Ausgabe Février 2023") is now read as one, where the old pattern took only a-z and umlauts; and a
segment with an empty field drops whole, so a template cannot yet say "(publisher[, place])" (the guide
says to write a kind of its own). Terminology and the answer register did not fall out of
this record: they are the prompt's, and stay the next slice of plan row 6.

### Slice 3. What the sentence says is what opens

**Goal.** The verifier holds edition, locus, page and quote to the passage `[N]` resolves to, on chat and
deep research; a card's reference is taken from a citation, not typed; an unbacked value shows as unbacked.
**Closes.** E1, E3, E6, E7, E4 (verdict only with a cited passage). Gaps G7 to G13, G33.
**Change.**
- `common/citation_locus.py`: edition agreement compares edition ids, and reads an edition written in prose
  with the style record's edition phrase, never a pattern of one country. The locus units (Abs., Z, lit.,
  Art., Tabelle, or another country's) come from the style record. "Cannot check" is reported apart from
  "agrees".
- `citations/registry.py`: a cited page the turn did not read resolves with `page_unread` on the wire; the
  viewer opens the document and says the page was not read.
- `citations/quote_verification.py`, `common/quote_stamps.py`: a quote is `verbatim` only in a passage its
  own `[N]` names; found elsewhere is its own status, shown and scored.
- `common/answer_envelope.py`, `citations/trailer_values.py`, `cards/`: `reference` carries the citation
  number; document, section and edition are filled from that entry. The card opens the cited entry through
  the normal target; delete `resolve-corpus-file.ts`.
- The chat answer pipeline (`answer_pipeline.py`): a normative value left without a surviving citation in its sentence is
  recorded per sentence and rendered "ohne Fundstelle" (decision 2); the door and export carry the mark.
- `agents/deep_researcher/finalize.py`: pass `check_locus=True`.
**Tests.** `test_citation_verification.py`, `test_quote_stamps.py`, `test_citation_trailer_gates.py`, a new
`test_edition_agreement.py`; a card spec that a reference without a citation number renders no "view" link;
answer-suite cases A1 and A8.
**Langfuse.** `claim-citation-resolves`, `edition-agrees`, `locus-agrees`, `quote-source-agrees`,
`normative-value-uncited` (count), `page-unread` (count).

### Slice 4. Law from the law's own source

**Goal.** A statement of law is cited from its source or the corpus; the web is information and cannot carry
a requirement or a binding edition.
**Closes.** E2, E13, E15, E17 (URL safety). Gaps G25 to G28.
**Change.**
- `common/web_sources.py`: withhold or label any hit that is a copy of a work the records hold, by the works'
  designations and the hosts of the released source records, never by a file-name pattern of one publisher.
- `citations/extraction.py`: a web tool's sources are its result records, never every URL in the text.
- With a gate that may not bind, or a web-only source, a sentence that states a requirement or names a
  binding edition caps confidence and is recorded; deterministic patterns first, the judge second.
- `citations/sanitize.py`: URL vetting through a library, https only for sources.
- Find out why the live § 50 lookup did not read the legal database before fixing anything around it.
**Tests.** `test_web_sources.py` with the live cases; an extraction test that a body URL is not a source;
dev-acceptance A2, A5 and the two "every answer" rules as answer-suite cases.
**Langfuse.** `law-cited-from-web`, `binding-claim-without-records`, `web-sources-withheld`.

### Slice 5. A corpus PDF is served to whom it is released

**Goal.** The viewer route answers by entitlement, country and release state.
**Closes.** E17. Gap G29.
**Change.** `app/api/knowledge-base/documents/[fileName]/route.ts`, `bff/knowledge/service.ts`: resolve the
file against the organisation's entitled, released corpus before streaming, 404 otherwise; the route's
catalog entry and `exposure.config.ts` reason. First establish which files the route reaches today with a
failing test.
**Tests.** Route spec per file class; `agent-reachability.spec.ts`; `task db:test:rls` if the check reads a
tenant table.

### Slice 6. Documents and checks cite like answers

**Goal.** What leaves the product as a document or a check carries verified citations in the one form.
**Closes.** E9 for written documents and the model check. Gaps G21, G22.
**Change.** Run `verify_citations` and the formatter when a draft is filed, storing the draft's citations as
structured references; a check rule names the edition it encodes and renders through the formatter; the
Prüfbuch shows the edition and, from the knowledge context, whether it binds at the site.
**Tests.** A filed draft with a fabricated reference loses it and says so; a rule catalogue spec that every
rule has an edition id present in a released pack.
**Langfuse.** `document-citations-verified`.

### What these slices rest on, outside citations

- **One law lookup with no country in it.** The legal-database tool becomes a generic tool over the source
  records; it finds the text through the work's record, so every live hit carries its work and edition. The
  adapter package, and the deep-research URL tools with it, go.
- **Readers read released records.** Lane, document class and title of a corpus file come from its
  manifestation's record, and `common/oib_file_names.py` is deleted with its last three readers.
- **Retrieval that prefers the binding edition**, as a boost and a fallback, not a filter. Without it the
  verifier of slice 3 catches edition drift after the answer is written and the reader gets a value "ohne
  Fundstelle".
- **Check rules per binding edition**, before slice 6: a check that fails a building against an edition
  that does not bind at its site is the worst outcome on this list.

### Deferred, and why

- **EU law text**: no reader exists; one source record once the lookup is generic. Until then an EU
  citation opens nothing.
- **Link liveness for web sources**: the source monitors of ADR-0174 are the place.
- **CSL formats (APA, BibTeX)**: keep working off slice 1's fields; no architect asked for them.
- **Hint instead of verdict** (E4 in full): where the gate is not settled or an edition's scope is open, a
  card renders as a hint with its Fundstelle. Prompt and card work, separate from citation plumbing.
- **Full accessibility pass** of chip, peek and viewer: after slice 2 settles the markup.
