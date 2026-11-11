# Bring a country in the way an operator thinks

Status: design, for the owner's decision. Nothing here is built. Read at `origin/develop` `7f771068` (2026-11-11).
Prototype: <https://claude.ai/artifact/3Jq5xxCQBH7uvs6Mf22h9x> (Austria's real bindings from `configs/knowledge-packs/at.json`, the synthetic country XA as the empty state, phone and desktop, light and dark).
Builds on [`country-as-data.md`](country-as-data.md) (the target and its section 3.7 on governance) and [`design.md`](design.md) (the primitives). It changes how a country is brought in and reviewed, not what a record means to the resolver.

## Why

The owner's verdict on the review today: unusable, "I have no idea what it wants me to do", a country or a Land "represented like a law and linking to Wikipedia", and a process laid out the way the data is stored rather than the way a person would create it.

The numbers say the same. Austria's pack is 213 records. Every one goes through the same change request, must cite a capture with a quote (KC-6, `platform/validate.ts`), and is reviewed field by field (`claimsOf` in `platform/records.ts`: one claim per stated field). That is about 1,150 field verdicts for Austria, and about 3,000 for the dev draft. The legally meaningful content is much smaller:

| What the pack holds | Records | What a person actually has to decide |
|---|---|---|
| Territories (AT, nine Länder) | 10 | Nothing. They are ISO 3166-2:AT. Today each cites a note, "ISO 3166-2:AT", and AT cites the accession treaty as prose |
| Relations | 136 | **17 statements.** The 135 `makes_binding` rows, grouped by Land, adopting act and start date, are 17 acts saying "these editions bind here from this day". 3 of the 17 cite the Landesgesetzblatt in RIS; 14 cite only the OIB's overview page of adoption dates; 6 (all of them the 2019-era predecessors) do not name the act's provision at all. The one `deviates_from` row belongs to Tirol's statement (§ 43 TBV 2026), and its only citation is an internal note that says to re-check it |
| Works | 27 | 9 building codes (one question each: is this the law in RIS?). The 9 adopting ordinances and the 9 OIB guideline series need no question of their own: they are named by the statements and documents that use them |
| Editions + manifestations | 20 + 20 | **20 documents**, one question each: is this file the text of this edition? |
| Scopes (`at-scopes.json`), citation style, building class, setup facts | 6 + 1 + 3 seeds | **Rules**, each checked by its examples |
| Golden cases | 28 | 28 questions with their expected answers |

So Austria is 17 statements + 9 building codes + 20 documents + 10 rules (6 scopes, the citation style, building class, the two setup records) + 28 golden cases = **84 decisions**, not 1,150. The territories are not among them. The decisions are not equal: a statement with deviations and a transitional rule is an hour's reading for an expert, a document's title page is ten seconds. The design below makes those 84 the only things a person is asked, each in the form the expert already thinks in.

---

## A. The north star

### Bringing a new country in

Lena runs the platform. She opens Countries, presses "New country" and types Slovenia. The page that opens is empty but not blank: six jobs in order, each with one sentence, and a box that says "or hand it to your agent". She hands it over: "Bring Slovenia in to core. Confirm nothing; leave every statement for me."

By the time she has had coffee, Structure is green. The agent imported SI and its municipalities from ISO 3166-2:SI, checked them against the national register, and took the boundaries from the surveying authority's open dataset. Nobody reviewed a name or a code: one import, logged with the file's hash, the same way a dependency is upgraded. Project setup now offers those regions; nothing else had to be typed twice.

The law map has filled in, greyed. Rows are the levels that make building law (the state, and below it whatever the country delegates to), columns are the topics an architect checks: the building act, then each technical regulation or guideline series. Every cell says which edition binds, since when, and by which act, and every row was proposed by the agent from the official gazette, with the adopting clause captured and highlighted. Marko, the building-law expert Lena works with, opens the map. He does not read records. He opens a row, sees "Pravilnik … Uradni list RS, št. …/2022 makes these four regulations binding from 1 January 2023", reads the highlighted adopting clause, the transitional clause and the list of deviations the agent found, and confirms the statement. The next one opens by itself. One he sends back: the agent had read the publisher's summary page instead of the act. That row stays striped until the act is captured.

Documents is a list of twenty files, each with its title page. One question per file: is this the text of this edition? Rules shows the building-class table not as a decision table but as six example buildings with their expected class, all green. The citation style shows three lines as an office would write them. Quality bar holds twenty questions Marko wrote over an afternoon, with the answers a right reply must give; the last run passed nineteen, and the one that failed was a real gap in the map, which he fixed.

On dev, Lena releases it herself. On prod, the release arrives as a file from dev; the platform re-fetches every source and checks every fingerprint. Jana, who confirmed nothing of it, reads one page: what offices in Slovenia will notice, the golden run on the staged release, any source she wants to open. She releases. An office in Ljubljana that buys the country sees its regions in setup the same hour.

### Styria adopts OIB 2023 from 1 July

On a Tuesday at six, the monitor on the Steiermark Landesgesetzblatt sees a new act amending the Steiermärkische Bautechnikverordnung. The agent reads it: it names the OIB-Richtlinien, Ausgabe Mai 2023, and a date, 1 July 2027. It captures the page, finds the clause, and drafts the change on the law map: the Steiermark row, nine cells, from 2019 to 2023 on that date. It also drafts what the act says about pending procedures (its Übergangsbestimmung: a procedure filed before 1 July keeps 2019), with that clause highlighted too, and the deviations it found in the act's Anlagen, or the sentence "the act lists none" with the paragraphs it read. Nothing is released.

At nine, Keeping current shows one finding with one button, "Open the draft in the law map". The map opens at 1.7.2027 with the Steiermark row outlined. Marko reads the adopting clause, the transitional clause and the Anlagen beside the row, confirms the statement, and writes two golden questions, one filed on 30 June and one on 1 July. The release page shows him the one sentence offices will notice and both questions passing on the staged release. No document is new: the May 2023 texts are already released for six other Länder.

On prod Jana opens Release, reads that sentence, opens the gazette link because she likes to, and releases. From that moment an architect in Graz asking about escape routes for a filing in August 2027 gets the 2023 values and the 2023 citation, and a thread from last month still shows what bound on its day.

---

## B. Information architecture

### Navigation: the country is a folder

The owner found a sidebar of jobs and tabs hard to navigate, so the navigation is a tree, as in a file browser. There is one column, with no sidebar and no tabs. A path bar at the top (`Countries / Österreich / Steiermark / StBTV-Novelle 2027`) says where you are.

- **Countries** holds one folder per country.
- **A country** holds one folder per law-making region, then the shelves: the publisher's texts (`OIB-Richtlinien / OIB-RL 2 / Ausgabe Mai 2023`), the rules, the test questions, the imported regions and municipalities, and the watched sources.
- **A region's folder** opens on a timeline: one bar per guideline, one segment per edition, and a line for today. Below it are its building law and the acts that adopt guidelines, one item per act.
- **An item** (an act, a text, a rule, a question) is the decision itself, on one page: what it says, the source, and "Yes, confirm".

Status rolls up the tree the way unread counts do in a mail client. A folder says "2 need you" or "3 with the agent", so the operator follows the numbers and never has to know the order. The country's row of Länder shows each Land's fingerprint: one small square per guideline, with the edition year in force today. That replaces the grid as the at-a-glance view. One button in the path bar, **Next for you**, walks to the next item that needs this person, and confirming an item opens the next one. A change that is not yet released shows as a banner on the country folder, with the release page behind it.

The six jobs below are still the content. They are now places in the tree, not tabs.

A country has six jobs and a release. The navigation is those jobs in the order a person does them; each screen opens with one sentence saying what to do there. The prototype implements every screen below.

| Screen | What you do here (the sentence on the screen) | The unit you decide | Who proposes / who decides |
|---|---|---|---|
| **Overview** | Bring the country's building law in and keep it right. Each card is one job; the dot says whether it needs you. | nothing | — |
| **Structure** | Import the regions and municipalities from the published lists. This is reference data: imported and logged, never reviewed claim by claim. | one import of a pinned dataset version | the agent or operator imports; the operator applies it; no second person |
| **Law map** | Check, region by region, which edition of each guideline binds and since when. Open a cell to see the act that adopts it, what it says about pending procedures and its deviations; confirm the statement, and the next one opens. | an **adoption statement** (one act, one region, one start date, the editions it adopts, its deviations) | the agent drafts with the clause captured; the expert confirms |
| **Documents** | Answer one question per document: is this the right text for this edition? The edition's name and date are read from the document. | a **document** (file, fetched URL, sha256) | the agent attaches; the expert confirms |
| **Rules** | Check each rule the product reads by its examples: if every example is right, the rule is right. | a **rule** with its examples | the agent drafts the table and examples; the expert confirms the examples |
| **Quality bar** | Write the questions a right answer must pass, and see whether it does. | a **golden case** | the expert writes or confirms; generated cases come from the map |
| **Keeping current** | Act on what changed at a source. A finding becomes a proposed row in the law map, never a release. | a finding (open it or dismiss it) | the monitor and agent propose; the expert confirms the resulting statement |
| **Release** | Read what offices will notice, open any source you doubt, then release or send it back. | the **release** (a diff in office terms) | on prod, a second person who confirmed none of it |

The empty state of a new country (the prototype's XA) is the same six jobs, all open, the first one with a button, and the instruction an agent needs, ready to copy.

### The law map

Rows are the bodies that make building law, not the ISO subdivisions: a row is a territory with a legislating authority (Austria: the nine Länder, and a federal row when federal records exist; a Swiss intercantonal concordat or an Italian autonomous province would be rows too). Municipal plans (Flächenwidmungs- and Bebauungspläne, Wien's Plandokument) are not rows: every Gemeinde has them, most are not in a gazette, and they belong to a project's site as documents an office supplies or the platform fetches per site. Columns are topics in groups, proposed by the agent from the works the statements name and confirmed with them: the building act (read live, at the Fassung of the chosen date); the model-code series (OIB-RL 1 to 6 with 2.1 to 2.3, the Begriffsbestimmungen, and what an edition makes binding by reference, such as the Leitfaden Energietechnisches Verhalten through RL 6); other Land law that an architect checks (Raumordnung, Garagen- und Stellplatzrecht); and federal law (Arbeitsstättenverordnung, Barrierefreiheit). Interpretive texts such as the OIB's Erläuternde Bemerkungen hang on their edition, marked not binding, never in a cell. A cell shows the edition that binds, since when, and its state.

Two dates drive the map, because an expert asks two questions: **as of** (what is in force on a day) and **filed on** (which edition applies to a procedure filed on that day and still pending). The second reads the statement's transitional rule. Where they differ, the cell shows both.

Cell states, and only these: **confirmed** by a person; **ready to confirm** (the statement cites a capture fetched from a gazette or legal-database source and its adopting quote passed KC-6 in those bytes); **needs the act** (it cites a pointer, such as the OIB overview page, or its quote was not found); **nothing binds** on that date.

Opening a cell opens its statement, not the cell: "Sbg. BTV, LGBl. 83/2026 makes OIB-Richtlinien 1, 2, 2.1, 2.2, 2.3, 3, 4 and 5 in Ausgabe Mai 2023 and OIB-Richtlinie 6 in Ausgabe März 2015 binding in Salzburg from 1.9.2026", with the clause highlighted on the captured gazette page, the act's Anlagen listed, and the cell's history beneath. The statement is the only thing confirmed. A guideline adopted with deviations, or brought into force on another date, is its own statement, so there is no cell-level confirm to contradict it. There is no bulk confirm either: a quote found in the bytes proves the words are there, not what they mean. Instead, confirming one statement opens the next, so seventeen statements are seventeen drawers read in a row.

What Austria's data looks like on the map today, from the pack: Steiermark and Vorarlberg are still on 2019 everywhere; Kärnten, Niederösterreich, Oberösterreich, Tirol and Wien are on 2023 with RL 6 varying (Oberösterreich 2019, Tirol and Wien 2025); Salzburg from 1.9.2026 on 2023 except RL 6, where § 1 of its BTV keeps March 2015; Burgenland on 2019 except RL 6, which moved to September 2025 on 5.11.2026. A Baurechts-expert reads that in ten seconds; nobody can read it from 136 relation records.

---

## C. The data and process changes

### C1. Three kinds of data, three treatments

| Kind | What it is | Examples | Citation | Review | Four eyes on prod |
|---|---|---|---|---|---|
| **Reference data** | Facts a standard or an official register publishes, which are not law | Territories and their codes, names per language, parents, validity; municipalities; boundaries; time zone; union membership | The dataset: URL, version, sha256, once per import. No per-row quote | None per row. A dry run shows the diff ("+9 Länder, +2,093 Gemeinden"; a re-import "1 renamed, 2 merged"), the operator applies it, the import is audited | Additions: no, one person. Removals, merges and renames (Steiermark merged municipalities in 2015): yes, a second person, because they move projects' sites and codes. An import that would orphan a binding or a project's site is refused until that is resolved |
| **Claims** | Legally meaningful assertions a person must check against a source | Adoption statements, a building code's identity, a document's identity, a rule, a golden case | The primary source with a pinpoint and a quote: for a statement the gazette act, never a summary or an encyclopedia | One verdict per claim, in the form of the claim (a row, a title page, examples, sample lines) | Yes |
| **Derived and default fields** | Everything computed from a claim or set by a default | A relation per edition (from the statement), an edition's label and date (from its document), a work's territory (from the statement that names it), `mode: declared`, `language: de`, `licenceClass` (from the source's terms), keys and ids | None | None. They are shown, never asked | — |

An empty field is never a claim (`claimsOf` already skips unstated fields). A derived field is never a claim either, and that is the larger saving: once a statement is confirmed, its nine `makes_binding` relations, their `validFrom`, and the closing `validTo` of the editions they replace are consequences, not nine more questions.

### C2. What a claim is

Six kinds, each with its one question:

| Claim | Question the reviewer answers | Source it must cite | Review view |
|---|---|---|---|
| `adoption` | Does this act make these editions binding in this region from this date; what does it say about pending procedures; which deviations does it make? | The act's publication in the official gazette, identified by its gazette number or ELI, with the adopting provision and a quote found in the captured text; the in-force provision, which may sit in another act (Wien's RL 6 2025: in force with the W-EGUG 2026, the Verordnung itself does not state it); the transitional provision, or "the act is silent" with the region's default rule; the deviations as a positive list with their Punkte, or "none" with the paragraphs and Anlagen read | Law map row with the clauses beside it |
| `statute` | Is this the region's building law, at this identifier in the legal database? | The legal database's page (the identifier resolves); the Fassung shown is the one in force on the map's dates, and an amendment's own Übergangsbestimmungen are a statement on the statute's column | A link and the law's title as the database prints it |
| `document` | Is this file the text of this edition? | The publisher's URL the file was fetched from, and its sha256 | Title page beside the edition's name |
| `rule` | Are these examples right? | The provision the rule encodes (`provision` on each row, as today) | The examples as a table: inputs, expected, the rule's output |
| `citation_style` | Are these the lines an office would write? | The publisher's own citation guidance, where there is one | Rendered sample lines per kind |
| `golden_case` | Is this the answer a right reply must give? | Its grounding, as today (`records`, `text`, `unconfirmed`) | The question, the expected values, the last run |

An `adoption` statement is keyed by the act's structured identifier (its gazette number or ELI) and its in-force date, never by parsing a provision's text. A replacement act (TBV 2026, K-BTV 2024) is a new statement; Kundmachung and Inkrafttreten are separate dates, and the map uses Inkrafttreten.

A **pointer** is not a source. The OIB's page of adoption dates, a Wikipedia article, a commentary: the agent may read them to find the act, and the record may keep them as `seeAlso`, but a statement whose only citation is a pointer shows as "needs the act" and cannot be confirmed. This is the rule the owner asked for ("the source of binds is that adoption act"), made checkable: the confirm action is disabled until the statement cites a capture from a host of a source whose role is `gazette` or `legal_database`.

### C3. What the machine checks, and what a person checks

The machine already checks more than the review shows. The division becomes explicit:

- **The machine**: the quote is in the captured bytes (KC-6, unchanged); the bytes were fetched by the platform from the source's host, or pasted (then a person compares, as today with `sourceChecked`); a document's sha256 is the one named (KC-1); intervals are half-open and do not overlap within one region and topic (KC-3, extended to the statement); every example of a rule evaluates to its expected output (new, uses the one evaluator); on prod, every source of an imported release is re-fetched and its fingerprint compared.
- **A person**: what the words mean. That an act adopts an edition, that a file is the edition, that an example is the law's answer, that an expected answer is right.

There is no bulk confirm for claims. The machine's checks decide which statements are offered ("ready to confirm") and in what order; a person opens each one.

### C4. Who decides what

| Step | Agent on the platform door | Operator | Expert | Second person (prod) |
|---|---|---|---|---|
| Import structure | dry run, apply on dev | apply (one person, prod too) | — | — |
| Capture sources, attach texts | yes | yes | — | — |
| Propose statements, documents, rules, cases | yes | yes | yes | — |
| Confirm a claim | never | on dev, if single-operator | yes | — |
| Release | never | on dev | on dev | on prod: anyone who confirmed none of the release's claims |
| Dismiss a monitor finding | proposes | yes | yes | — |

**Four eyes on prod becomes two rules.** (1) Every claim offices read on prod was confirmed by a person holding the expert role, and released by another person. (2) A confirmation made on dev counts on prod only if it was made with single-operator mode off by someone holding the expert role; the release file carries each claim's decision and who made it, and a claim without such a confirmation is confirmed again on prod before release. The release refuses a releaser who confirmed any claim it carries. On dev, `KNOWLEDGE_SINGLE_OPERATOR` keeps letting one person do everything, and nothing confirmed that way reaches prod unconfirmed.

The releaser checks that the change is what offices should get, with the sources one click away; the expert checks the law. That is a second look, not a second legal review, and the design says so. Where a second legal review matters (a country's first release, a statement with deviations) the release page asks for a second expert when one exists. When only one expert exists, the release is allowed and carries a visible "one expert" mark on the release and in the audit; any later expert can dispute a released statement, which opens a change request against it and, at their choice, rolls it back. That replaces the deferred second-review state machine with an ordinary action on a released claim.

What goes: approve-alone with its deferred second review (`platform:knowledge:approve_alone`, `override`, `approval: single`, the second-review states due/confirmed/disputed/void, ADR-0176), and the preview channel as a separate human step. Their purpose is kept by other means: the "one expert" mark and the dispute action above, and the golden run on the staged release, which the release page shows and which runs without a person. This is the simplification `country-as-data.md` 3.7 already recommended.

An agent's confirmation stays impossible by construction: the confirm and release operations require the person's yes through elicitation, as decide and publish do today.

### C5. Keeping a country current

Monitors stay (`platform/monitor.ts`), with two changes in what a finding becomes:

- A **gazette monitor per region** (the region's gazette in the legal database, filtered to acts that mention a model-code series the map carries or the region's building act, so a replacement act is caught as well as an amendment) produces an `adoption` draft on the law map, with the act captured, the clauses found, and its transitional rule and deviations drafted. Austria needs ten monitors: nine Landesgesetzblätter and the OIB's page, which often announces a date before the gazette prints it and is watched for that, never cited.
- A **publisher monitor** (OIB) produces a `document` draft when a new edition appears, with the PDF fetched. A new edition binds nowhere until an adoption statement says so; the map shows it as a new column value no region uses yet.

A finding is never released by itself. "Nothing to do" dismisses it, as rejecting the monitor's draft does today.

### C5a. The quality bar

Golden cases stay what they are: questions an expert writes with the answer a right reply must give. Every changed statement in a release needs at least one hand-written case, filed on each side of its boundary when it has a transitional rule. Questions generated from the map ("which edition binds in Steiermark on 2.7.2027?") are kept as regression checks of the resolver and the answer path, and shown separately: they are checked against the map they came from, so they are not evidence that the map is right, and they do not count toward the bar.

### C6. How Austria migrates

One migration, run as a change request on dev, then released to prod through the release file:

1. **Territories** (10): re-imported as reference data from ISO 3166-2:AT (the `iso-codes` dataset), plus municipalities from Statistik Austria's Gemeindeverzeichnis and boundaries from the BEV. The note-only citations are dropped. The EU parent comes from the union's member list. Wien is both a Land and a Gemeinde, as the register has it. `at-setup-fact-definitions.json`'s own list of nine Bundesländer (token, territory id, label) is replaced by a read of the structure.
2. **Relations** (136): grouped into 17 adoption statements by region, act and start date; the `deviates_from` row becomes part of Tirol's statement, still to be checked. 3 statements already cite the gazette. 14 cite only the OIB overview and arrive "needs the act": the agent captures the acts from RIS (LGBl.), names the 6 missing provisions, and drafts each statement's transitional rule and deviations, which the pack holds for none of them. The expert then confirms 17 statements. Capturing the acts may move dates: the OIB's table and the gazette do not always agree on Inkrafttreten.
3. **Works** (27): the 9 building codes become 9 `statute` claims (their RIS identifiers and ELI already present). The 9 ordinances and 9 OIB series become derived, named by statements and documents.
4. **Editions and manifestations** (20 + 20): 20 `document` claims. `oib-rl-6-2015`'s missing `issuedOn` is read from its title page.
5. **Rules**: the 6 scopes keep their tables and examples; the building class and setup facts move from `rulesets/seeds/` into records (they ship with the code today, `rulesets/shipped.ts`); the citation style gets its sample lines.
6. **Golden cases** (28): unchanged.

Result: 84 decisions for the expert, of which 17 are statements. Nothing an office reads changes until the release. The migration's release diff is not expected to be empty: each line in it is a correction the gazette made to the OIB's table, and is read as one.

### C7. XA proves nothing is Austrian

The synthetic country XA (fixtures in `bff/base-knowledge/context/route.spec.ts`, `bff/agent-api/synthetic-country-door.integration.spec.ts`) walks the same screens: XA and XA-1 Nordland imported from a test ISO list, a building act per region, a technical ordinance adopting a model code from a date, one region with a deviation. Nothing in the design names a country: "gazette" and "legal database" are source roles on source records, "topic" is a work series, and the map's columns come from the works the statements name.

XA was built in Austria's shape (a region adopts a model code from a date), so it proves the screens are not Austrian, not that the model is. A second synthetic country, XC, is shaped the other way: one national building code amended by dated decrees, no regional adoption, and municipal plans that decide most of what a project may do. Its map has one row, its columns are the code and its decrees, and its plans are site documents. The acceptance test for slice 2 renders both maps from records only.

### C8. What code shrinks or goes

Measured at `7f771068` with `wc -l`. The record kit today is about 12,800 lines outside specs: BFF `base-knowledge/platform/` 6,800 and `wire/vocab.ts` 315, routes 820, UI 1,720 (`countries/` 1,060, `change-request-review.tsx` 494, `change-request-format.ts` 164), door catalog 690, migrations 1,340, Python 1,100.

| Goes or shrinks | Why | About |
|---|---|---|
| Field-by-field review: `change-request-review.tsx`, `change-request-format.ts`, `claimsOf` field paths, `approval-badges.tsx` | Replaced by claim views on the map, documents and rules | −700 UI, −60 BFF |
| Approve-alone and second review: `decide.ts` branches, `SecondReviewState`, `secondReviewRoles`, `voidSecondReview`, `retractPreview`, the `override` path, second-review routes and door wording | One rule: confirmer ≠ releaser | −300 BFF, −80 door, migration drops `knowledge_second_reviews` |
| Preview channel as a human step: `release.ts` preview moves and the "publish to preview first" gate | The golden run on the staged release does its job | −120 |
| Per-row citations for territories, ISO import's per-row quote check (`onboarding.ts`, `wire.ts` territory import) | Reference data cites its dataset once | −150 |
| Universal KC-6 on every record type | KC-6 applies to claims only | −60 |
| Bundesland list in the setup seed | Read from structure | −40 data |
| `release-import` marking every capture operator-supplied | Prod re-fetches and compares fingerprints | −40, and it removes the re-review of every capture on prod |

| Comes | About |
|---|---|
| Law-map read model (statements from relations; one route; one door operation `platform-knowledge-law-map-get`) | +180 BFF |
| Law map, statement drawer, document question, rule examples, release page (built from existing atoms) | +900 UI |
| Statement as a claim: `adoption` proposal shape that expands to relations at publish, claim kinds on review decisions | +250 BFF |
| Reference import from a dataset (CSV/JSON engine already in `public-sources`; a register is a source record) | +150 |
| Rule examples evaluated by the existing evaluator; citation sample lines from `shared/citation-style.ts` | +80 |
| Release rule (confirmer ≠ releaser) and the office-terms diff | +150 |

Besides the rows above, the record-listing sections of `countries/` (about 700 of its 1,060 lines; the add-document dialog stays) are replaced by the new screens. Removed about 2,250, added about 1,700: net about −600, the kit from about 12,800 to about 12,200 lines. The code saving is modest; the saving that matters is the review load, from about 1,150 verdicts for Austria to 84.

### C9. Slices

Each slice ships alone and leaves the system working. Estimates are net lines of non-test code.

| # | Slice | What a person notices | Net |
|---|---|---|---|
| 1 | **Law map, read only.** Statements grouped from today's relations; the map with its date, cell states and drawer on the country page; one door operation | The owner sees Austria as a map, with the 14 pointer-cited statements striped | +500 |
| 2 | **The statement is the claim.** `adoption` proposals that expand to relations; review decisions per claim kind; transitional rule and deviations on the statement; a "filed on" date beside "as of"; pointer-only statements cannot be confirmed; XA map from records in the acceptance test | Reviewing Austria's bindings is 17 rows | +250 |
| 3 | **Structure is reference data.** Dataset import with diff and audit, municipalities and boundaries, no per-row citation; setup reads its region list from it | Territories leave the review entirely | −40 |
| 4 | **Documents and rules as one question each.** Document view with title page; rule examples evaluated and shown; citation style sample lines; delete the field-by-field review, the record-listing sections and universal KC-6 | The review dialog is gone | −1,100 |
| 5 | **One release rule.** Expert confirms, another person releases on prod; dev confirmations count only from an expert outside single-operator mode; a "one expert" mark and a dispute action; release page in office terms with the golden run on the staged release; delete approve-alone, second review, preview as a step; prod re-fetches imported sources | A second person reads one page to release | −160 |
| 6 | **Monitors draft on the map.** Gazette monitor per region produces an `adoption` draft; publisher monitor a `document` draft | "Styria adopts 2023" is one finding and one row | +100 |
| 7 | **Austria migrates.** The 17 statements, 9 statutes, 20 documents, rules out of `rulesets/seeds/`, released to prod through the release file | Austria on prod is confirmed against the gazette | −150 (seeds and shipped loader go) |

Total about −600. Slice 1 is worth shipping first by itself: it makes the 14 pointer-cited bindings visible before anyone reviews anything.

### C10. Open questions for the owner

1. **Pointer-only statements on prod.** 14 of Austria's 17 statements cite the OIB overview, not the act. Block their release until the acts are captured and their transitional rules and deviations drafted (correct; the effort is unmeasured), or release them marked "secondary source" meanwhile?
2. **Who may release on prod.** Any platform person who confirmed none of the release's claims, or only someone holding a release permission? The design assumes a permission, `platform:knowledge:release`, held by more people than the expert role.
3. **Reference imports on prod without a second person.** The design says yes, audited, refused when it would orphan a binding. Acceptable?
4. **Municipalities now or later.** Nothing reads a Gemeinde's law today except site placement. Import them in slice 3, or only the Länder and boundaries until a municipality carries a binding?
5. **Generated questions.** They are resolver regression checks, not the bar. Run them on every release (a model call per changed statement), or only before a country's first release?
7. **The expert role on prod.** Who holds it today, and is a second expert realistic for Austria's first release, or does it ship with the "one expert" mark?
8. **Topics beyond the model code.** Raumordnung, Stellplätze and federal law widen the map and the review. In the first release, or after the OIB columns are confirmed?
6. **The OIB overview page.** Keep it as a monitor (it often changes before the gazette does) while never citing it for a binding?

---

## Closing checklist

- **What was asked:** a design for bringing a country in and keeping it current: north-star scenes (A), a clickable prototype (B), and the data and process changes with slices (C). No product code.
- **Evidence:** Austria's numbers computed from `configs/knowledge-packs/at.json` at `7f771068` (213 records; 136 relations; 17 statements by region, act and start date; 3 citing RIS; 6 without a provision). Line counts by `wc -l` on the paths in C8. The prototype renders the pack's 135 bindings.
- **Not verified:** municipality counts (shown as examples in the prototype), the wording of any gazette clause (illustrative in the prototype), live dev data (not read).
- **Independent critique:** a reviewer playing an Austrian Baurechts-expert and a platform operator read the draft and the prototype. Folded in: transitional rules and a "filed on" date (B, C2); statements keyed by act identifier with their own in-force provision (C2); deviations as a positive list (C2); four eyes that counts only expert confirmations made outside single-operator mode, a "one expert" mark and a dispute action (C4); no bulk confirm and no cell confirm (B, C3); generated questions out of the bar (C5a); topic groups beyond the OIB, municipal plans as site documents (B); a second synthetic country (C7); two-person reference removals and merges (C1); corrected counts and migration claims (Why, C6). Not taken: a column per ÖNORM (an ÖNORM hangs on the edition that references it, as a document).
- **What we learned, and where it went:** the pack's bindings mostly cite the OIB's adoption-date page rather than the adopting act (this document, C1 and C6); the setup seed keeps its own copy of the Länder list (C6.1); Wien's RL 6 2025 takes its in-force date from another act (C2); `claimsOf` already skips unstated fields, so the review's size is stated fields, not empty ones (C1).
