/**
 * Focus ring — the two recipes, written once.
 *
 * A keyboard ring that changes alpha, offset and trigger (`focus:` vs
 * `focus-visible:`) from control to control is not a style choice, it is noise:
 * the reader has to re-learn "where am I?" on every widget, and one of the
 * variants (`focus:`) fires on a MOUSE CLICK, which teaches them the ring means
 * nothing. So there are exactly two, and every interactive primitive in
 * `components/ui` composes one of them rather than hand-rolling a third.
 *
 * The ring is a mid grey of the ink ramp (`--ring`), never blue and never black:
 * 3:1 or more on every step of the ladder (`tokens.css`), so it is the keyboard's
 * indicator without being a second, black frame round the control — see
 * `docs/design/design-language.md` ("Focus ring is a grey of the ink ramp").
 */

/**
 * **Interactive controls** — buttons, chips, toggles, tabs, badges, menu
 * triggers, close buttons, drag handles.
 *
 * A 2px ring held off the control by a 2px background-coloured gap, so it
 * reads on a filled (near-black) button as clearly as on a ghost one. It lies
 * exactly under the page's own keyboard outline (`globals.css`, 2px at 2px), so
 * the two are one band of `--ring`, not two.
 */
export const FOCUS_RING =
  'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background'

/**
 * **Interactive controls that sit inside a clipping container** — list rows in
 * `ItemList`, which is `overflow-hidden`, so an offset ring on the first or last
 * row would be sliced off by the container's own rounded edge and the reader
 * would see three sides of a rectangle. Same ring, drawn inside the row's box.
 */
export const FOCUS_RING_INSET = 'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset'

/**
 * **Fields**: `Input`, `Textarea`, `Select` trigger, the chat composer, every
 * search bar, and anything else that is a typing surface.
 *
 * THE DOCUMENTED EXCEPTION to {@link FOCUS_RING}, and deliberate: a field
 * already carries a visible border at rest, so the pointer takes that border one
 * step toward ink (a field is white so it can be written in: it has no fill to
 * give, V6 of the 2026-11 interaction review) and focus turns it to `--ring`,
 * and nothing more. No halo, and not the app's global keyboard
 * outline either (`globals.css`, unlayered, hence the `!`): a text field shows
 * `:focus-visible` on a mouse click too, so every click into a field drew the
 * ink border, a 2px halo and a 2px outline 2px outside it, three bands where
 * the reader wanted a caret (Notion #38, „Texteingabefelder bekommen beim
 * Anklicken eine zu dicke Markierung"). The border alone, in the ring's grey,
 * is above 3:1 against the paper and against the resting border (4.1:1 and
 * 3.1:1 light), so it is the indicator WCAG 2.4.7 asks for. It was ink at 64%
 * until 2026-11-12: a click into a field jumped from a 12% hairline to a
 * near-black frame. `outline-hidden` rather than `outline-none`: in forced colours
 * the transparent outline is drawn, so a Windows high-contrast reader keeps one.
 *
 * A focus snaps: no field names `border-color` in its transition list
 * (design-language.md, "A focus ring snaps").
 */
export const FIELD_FOCUS_RING = 'hover:border-foreground/30 focus-visible:border-ring focus-visible:outline-hidden!'

/**
 * **A field made of several parts**: `TagInput`, `MultiSelect`, the chat
 * composer, where the typing surface (or the trigger) is a bare control inside
 * a bordered box. The box is the field, so the box takes
 * {@link FIELD_FOCUS_RING}'s treatment, keyed on the focus inside it, and the
 * bare `<input>` / `<textarea>` inside draws no outline of its own (a second
 * box inside the first). `:focus-within` and not `:has(:focus-visible)`: a text
 * input shows focus-visible on a click too, so the two agree, and this one is
 * older.
 */
export const FIELD_FOCUS_WITHIN_RING =
  'hover:border-foreground/30 focus-within:border-ring [&_:is(input,textarea):focus-visible]:outline-hidden!'
